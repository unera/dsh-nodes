/**
 * Присутствие по WebSocket: hello со сверкой epoch, кадр state по уведомлению,
 * вытеснение второго соединения. Проверяем настоящим сокетом, не моками.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'
import { handleAdmin } from '../lib/admin-api.mjs'
import { createPresence } from '../lib/ws.mjs'

const CONFIG = { routePrefix: '/dsh-nodes', aliveTimeoutSeconds: 60, maxPendingEnroll: 50, maxBodyBytes: 65536 }
const ADMIN = 'ws-test-admin'
let dir
let store
let queue
let presence
let server
let base
let wsBase

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-ws-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  presence = createPresence({ WebSocketServer, prefix: '/dsh-nodes', store, queue })
  const handler = createNodesServer({
    store,
    queue,
    config: { routePrefix: '/dsh-nodes', maxBodyBytes: 65536, aliveTimeoutSeconds: 60, maxPendingEnroll: 50 },
    adminToken: ADMIN,
    presence,
  })
  server = createServer((req, res) => handler.handle(req, res))
  server.on('upgrade', (req, socket, head) => presence.upgrade(req, socket, head))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  base = `http://127.0.0.1:${port}/dsh-nodes`
  wsBase = `ws://127.0.0.1:${port}/dsh-nodes/v1/ws`
})

after(() => {
  presence?.close()
  server?.close()
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Ждать кадр с нужным `t` (с таймаутом, чтобы тест не висел). */
function frame (socket, type, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`не дождались кадра ${type}`)), ms)
    const onMessage = (raw) => {
      const value = JSON.parse(String(raw))
      if (value.t !== type) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(value)
    }
    socket.on('message', onMessage)
  })
}

function open (token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsBase, [token])
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
}

function closed (socket, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сокет не закрылся')), ms)
    socket.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

// Админка вызывается функциями: публичного админ-API больше нет.
async function admin (path, options = {}) {
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(options.body) : {}
  const rest = String(path).replace(/^\/v1\/admin/, '')
  return handleAdmin({ store, queue, config: CONFIG, prefix: '/dsh-nodes', origin: 'https://example', presence }, method, rest, body)
}

async function makeNode (name) {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name, defaultTimeout: 5 }) })
  return { node: created.body.node, token: created.body.token }
}


test('без токена upgrade отвергается', async () => {
  await assert.rejects(async () => {
    const socket = new WebSocket(wsBase, ['чепуха-не-токен'])
    socket.on('error', () => {})
    await new Promise((resolve, reject) => {
      socket.once('open', () => reject(new Error('пустил без токена')))
      socket.once('unexpected-response', (_req, res) => resolve(res.statusCode))
      socket.once('error', () => resolve(401))
    })
  })
})

test('hello со старым epoch отвечает reconnect', async () => {
  const { node, token } = await makeNode('lamp')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch - 1, known: 42 }))
  const ok = await frame(socket, 'hello-ok')
  assert.equal(ok.epoch, queue.epoch)
  assert.equal(ok.reconnect, true)
  socket.close()
})

test('alive при отсутствии работы ставит ожидание, постановка команды будит узел', async () => {
  const { node, token } = await makeNode('nbw')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')
  socket.send(JSON.stringify({ t: 'alive', known: 0 }))
  await new Promise((resolve) => setTimeout(resolve, 100))

  const apiId = store.nodeApis(node.id)[0] ?? store.announce(node.id, [{
    name: 'bash',
    version: '1',
    methods: [{ method: 'exec', args: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
  }]).apis[0]

  const { seq } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'true' }, timeout: 5 })
  presence.notify(node.id)
  const state = await frame(socket, 'state')
  assert.equal(state.state, seq)
  socket.close()
})

test('второе соединение вытесняет первое кодом 4001', async () => {
  const { token } = await makeNode('desktop')
  const first = await open(token)
  first.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(first, 'hello-ok')
  const firstClosed = closed(first)

  const second = await open(token)
  second.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(second, 'hello-ok')
  assert.equal(await firstClosed, 4001)
  second.close()
})

test('присутствие считается онлайн для /v1/admin/nodes', async () => {
  const { token } = await makeNode('online-check')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')

  const listed = await admin('/nodes')
  const node = listed.body.nodes.find((entry) => entry.aliases.includes('online-check'))
  assert.equal(node.online, true)
  socket.close()
})

test('отзыв токена рвёт открытую сессию', async () => {
  const { node, token } = await makeNode('revoke-ws')
  const socket = new WebSocket(wsBase, [token])
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ t: 'hello', epoch: null, known: null, proto: 1 }))
  for (let i = 0; i < 40 && !presence.online(node.id); i++) await new Promise((r) => setTimeout(r, 25))
  assert.equal(presence.online(node.id), true)

  const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)))
  await admin(`/nodes/${node.id}/token`, { method: 'POST', body: '' })
  const code = await closed
  assert.equal(code, 4401, 'сессия должна закрыться с кодом «токен отозван»')
  assert.equal(presence.online(node.id), false)
})
