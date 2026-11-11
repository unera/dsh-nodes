/**
 * Live counters of the current connection: what the panel shows and what resets them.
 *
 * The unit part checks the module alone (it is pure and has no I/O); the integration part
 * checks that the numbers really appear where they are produced — frames over a socket,
 * `GET /v1/commands`, and the admin JSON the panel reads.
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
import { createPresence } from '../lib/ws.mjs'
import { createConnStats } from '../lib/conn-stats.mjs'
import { handleAdmin } from '../lib/admin-api.mjs'
import { renderAdmin } from '../lib/admin.mjs'

const CONFIG = { routePrefix: '/dsh-nodes', aliveTimeoutSeconds: 60, maxPendingEnroll: 50, maxBodyBytes: 65536 }

const BASH = [{
  name: 'bash',
  version: '1',
  methods: [{ method: 'exec', args: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
}]

// ── the module alone: no socket, no store ──────────────────────────────────

test('the counters count frames and commands per node', () => {
  const stats = createConnStats()
  stats.bumpIn(1, 'state')
  stats.bumpIn(1, 'state')
  stats.bumpIn(1, 'ping')
  stats.bumpOut(1, 'state')
  stats.bumpOut(1, 'pong')
  stats.bumpCommands(1)
  stats.bumpCommands(1)
  stats.bumpCommands(1)

  const snap = stats.snapshot(1)
  assert.equal(snap.commands, 3)
  assert.deepEqual({ ...snap.in }, { state: 2, ping: 1 })
  assert.deepEqual({ ...snap.out }, { state: 1, pong: 1 })
  assert.ok(snap.since > 0, 'у счётчиков есть момент, с которого они считают')
})

test('nodes do not share counters, and a node that never spoke has zeros', () => {
  const stats = createConnStats()
  stats.bumpIn(1, 'state')
  assert.deepEqual({ ...stats.snapshot(2).in }, {}, 'чужой узел не должен получать кадры первого')
  assert.equal(stats.snapshot(2).commands, 0)
  assert.equal(stats.snapshot(1).in.state, 1)
})

test('an unknown frame type is counted under its own t', () => {
  const stats = createConnStats()
  stats.bumpIn(1, 'hello')
  stats.bumpIn(1, 'hello')
  assert.equal(stats.snapshot(1).in.hello, 2, 'чужой кадр — это ровно то, что ищут на этой странице')
})

test('reset zeroes one node and leaves the others alone', () => {
  const stats = createConnStats()
  stats.bumpIn(1, 'state')
  stats.bumpIn(2, 'state')
  stats.reset(1)
  assert.deepEqual({ ...stats.snapshot(1).in }, {})
  assert.equal(stats.snapshot(2).in.state, 1)
})

test('a new server generation wipes every counter', () => {
  const stats = createConnStats()
  stats.syncGeneration(5)
  stats.bumpIn(1, 'state')
  stats.bumpCommands(1)
  assert.equal(stats.syncGeneration(5), false, 'то же поколение — ничего не сбрасывается')
  assert.equal(stats.snapshot(1).in.state, 1)
  assert.equal(stats.syncGeneration(6), true)
  assert.deepEqual({ ...stats.snapshot(1).in }, {})
  assert.equal(stats.snapshot(1).commands, 0)
})

// ── the same numbers through the real socket and the real HTTP surface ──────

let dir
let store
let queue
let presence
let connStats
let server
let base
let wsBase

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-conn-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  connStats = createConnStats()
  presence = createPresence({ WebSocketServer, prefix: '/dsh-nodes', store, queue, connStats })
  const handler = createNodesServer({ store, queue, config: CONFIG, presence, connStats })
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

/** The admin side exactly as the panel calls it: same deps, same routes. */
function admin (path, method = 'GET', body = {}) {
  return handleAdmin({ store, queue, config: CONFIG, prefix: '/dsh-nodes', origin: 'https://example', presence, connStats }, method, path, body)
}

async function http (method, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function open (token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsBase, [token])
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

/** A frame with the given `t`, with a timeout so a missing frame fails instead of hanging. */
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

async function makeNode (name, options = {}) {
  const created = admin('/nodes', 'POST', { name, defaultTimeout: 5 })
  const token = created.body.token
  const announced = await http('PUT', '/v1/announce', token, { apis: BASH, clientVersion: 'test-1', access: 'rw', uptimeSeconds: 1, ...options })
  assert.equal(announced.status, 200, `объявление должно приниматься: ${JSON.stringify(announced.body)}`)
  return { node: created.body.node, token }
}

test('frames really land in the counters the admin JSON reports', async () => {
  const { node, token } = await makeNode('conn-counted', { client_epoch: 3 })
  const socket = await open(token)
  const pong = frame(socket, 'pong')
  // the epoch matches the announced one: nothing is reset here, the frames stay counted
  socket.send(JSON.stringify({ t: 'state', epoch: queue.epoch, client_epoch: 3, max_commandno: 0 }))
  socket.send(JSON.stringify({ t: 'ping', no: 7 }))
  await pong

  // one batch request: exactly one command fetch
  const taken = await http('GET', `/v1/commands?epoch=${queue.epoch}&client_epoch=3`, token)
  assert.equal(taken.status, 200)

  for (let i = 0; i < 40 && !connStats.snapshot(node.id).out.pong; i++) await new Promise((r) => setTimeout(r, 25))
  const listed = admin('/nodes')
  const row = listed.body.nodes.find((entry) => entry.id === node.id)
  assert.equal(row.clientEpoch, 3, 'панель показывает объявленный client_epoch')
  assert.equal(row.online, true)
  assert.equal(row.conn.commands, 1, 'один GET /v1/commands — один счёт')
  assert.equal(row.conn.in.state, 1)
  assert.equal(row.conn.in.ping, 1)
  assert.equal(row.conn.out.pong, 1)

  // a reload of the page is just another read: the numbers are server state
  const again = admin('/nodes').body.nodes.find((entry) => entry.id === node.id)
  assert.deepEqual(again.conn, row.conn, 'перезагрузка страницы не меняет счётчики')
  socket.close()
})

test('an announced client_epoch resets the counters of that node', async () => {
  const { node, token } = await makeNode('conn-restarted', { client_epoch: 4 })
  const socket = await open(token)
  const pong = frame(socket, 'pong')
  socket.send(JSON.stringify({ t: 'state', epoch: queue.epoch, client_epoch: 4, max_commandno: 0 }))
  socket.send(JSON.stringify({ t: 'ping', no: 1 }))
  await pong
  await http('GET', `/v1/commands?epoch=${queue.epoch}&client_epoch=4`, token)
  for (let i = 0; i < 40 && !connStats.snapshot(node.id).out.pong; i++) await new Promise((r) => setTimeout(r, 25))
  assert.equal(connStats.snapshot(node.id).commands, 1)

  // the node came back with a new life: what was counted belongs to the previous one
  const announced = await http('PUT', '/v1/announce', token, { apis: BASH, client_epoch: 5 })
  assert.equal(announced.status, 200)
  const row = admin('/nodes').body.nodes.find((entry) => entry.id === node.id)
  assert.equal(row.clientEpoch, 5)
  assert.equal(row.conn.commands, 0, 'счётчики прошлой жизни ничего не значат')
  assert.deepEqual({ ...row.conn.in }, {})
  assert.deepEqual({ ...row.conn.out }, {})
  socket.close()
})

test('a refused announcement does not touch the counters', async () => {
  const { node, token } = await makeNode('conn-refused', { client_epoch: 8 })
  const socket = await open(token)
  const pong = frame(socket, 'pong')
  socket.send(JSON.stringify({ t: 'ping', no: 2 }))
  await pong
  for (let i = 0; i < 40 && !connStats.snapshot(node.id).out.pong; i++) await new Promise((r) => setTimeout(r, 25))

  const refused = await http('PUT', '/v1/announce', token, { apis: BASH, client_epoch: 2 })
  assert.equal(refused.status, 409, 'старый client_epoch — отказ')
  assert.equal(connStats.snapshot(node.id).in.ping, 1, 'отказ ничего не меняет, счётчики на месте')
  socket.close()
})

test('a frame with an unknown t is counted before the socket is closed', async () => {
  const { node, token } = await makeNode('conn-unknown', { client_epoch: 1 })
  const socket = await open(token)
  const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)))
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch }))
  assert.equal(await closed, 4400, 'неизвестный кадр закрывает сокет')

  const row = admin('/nodes').body.nodes.find((entry) => entry.id === node.id)
  assert.equal(row.conn.in.hello, 1, 'расхождение протокола должно быть видно на панели')
})

test('the panel page carries the tab and reads the counters', () => {
  const page = renderAdmin()
  assert.match(page, /Текущие соединения/, 'таб должен быть в разметке')
  assert.match(page, /data-tab="connections"/)
  assert.match(page, /node\.conn/, 'таблица берёт числа из того же ответа админки')
  assert.match(page, /clientEpoch/, 'поколение узла показывается рядом со счётчиками')
})
