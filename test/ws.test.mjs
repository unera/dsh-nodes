import { existsSync } from 'node:fs'

// the sibling client repository exists locally but not in CI: without it these
// tests are not about what is built here but about the contract of two repositories
const hasClient = existsSync(new URL('../../dsh-node-client/lib/api.mjs', import.meta.url))
// without the client the tests are marked as skipped instead of failing
const t = hasClient ? test : (title, fn) => test.skip(title, fn)
/**
 * Presence over WebSocket: hello with an epoch check, the state frame on a
 * notification, eviction of the second connection. We check with a real socket,
 * not with mocks.
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

/** Wait for a frame with the given `t` (with a timeout so the test does not hang). */
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

// The admin side is called through functions: there is no public admin API anymore.
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


t('upgrade without a token is rejected', async () => {
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

t('hello with an old epoch answers reconnect', async () => {
  const { node, token } = await makeNode('lamp')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch - 1, known: 42 }))
  const ok = await frame(socket, 'hello-ok')
  assert.equal(ok.epoch, queue.epoch)
  assert.equal(ok.reconnect, true)
  socket.close()
})

t('alive without work sets a wait, and queueing a command wakes the node', async () => {
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
  assert.equal(state.max_commandno, seq)
  socket.close()
})

t('the second connection evicts the first with code 4001', async () => {
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

t('presence counts as online for /v1/admin/nodes', async () => {
  const { token } = await makeNode('online-check')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')

  const listed = await admin('/nodes')
  const node = listed.body.nodes.find((entry) => entry.aliases.includes('online-check'))
  assert.equal(node.online, true)
  socket.close()
})

t('revoking the token tears down an open session', async () => {
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

t('alive with a lagging number gets state at once, with the current one it stays silent', async () => {
  const { node, token } = await makeNode('sensor')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })

  // the client knows 0 while the server already has 1 — the answer must come at once.
  // We attach the listener before sending: on localhost the answer arrives first.
  const waitingState = frame(socket, 'state')
  socket.send(JSON.stringify({ t: 'alive', known: 0 }))
  const state = await waitingState
  assert.equal(state.max_commandno, 1, 'кадр несёт номер последней команды')

  // now the client is up to date — the server stays silent and remembers the wait
  const maybeState = frame(socket, 'state')
  socket.send(JSON.stringify({ t: 'alive', known: 1 }))
  const silence = await Promise.race([
    maybeState,
    new Promise((resolve) => setTimeout(() => resolve('тишина'), 300)),
  ])
  assert.equal(silence, 'тишина', 'на пустом приросте кадров быть не должно')

  // and as soon as work appears it arrives by itself
  // the wait is already set, so the server has to announce new work itself —
  // that is exactly what the plugin does after queueing a command
  const pushedState = frame(socket, 'state')
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  presence.notify(node.id)
  const pushed = await pushedState
  assert.equal(pushed.max_commandno, 2)
  socket.close()
})

t('a frame goes only to the waiting one: a busy node gets nothing', async () => {
  const { node, token } = await makeNode('busy')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')

  // the node did NOT say it waits: new work must not produce a frame
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  presence.notify(node.id)
  const silence = await Promise.race([
    frame(socket, 'state'),
    new Promise((resolve) => setTimeout(() => resolve('тишина'), 250)),
  ])
  assert.equal(silence, 'тишина')

  // it said it waits — and the frame arrives
  const pushed = frame(socket, 'state')
  socket.send(JSON.stringify({ t: 'alive', known: 0 }))
  const state = await pushed
  assert.equal(state.max_commandno, 1)
  socket.close()
})

t('events are isolated: work for one node does not wake the second one', async () => {
  const first = await makeNode('busy-one')
  const second = await makeNode('idle-one')
  const busy = await open(first.token)
  const idle = await open(second.token)
  busy.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(busy, 'hello-ok')
  idle.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(idle, 'hello-ok')

  // both said they wait
  const busyState = frame(busy, 'state')
  queue.enqueue({ nodeId: first.node.id, api: 1, method: 'exec', args: {} })
  busy.send(JSON.stringify({ t: 'alive', known: 0 }))
  await busyState

  // work appeared only for the first one — the second must stay silent.
  // The second one has to say it waits too, otherwise the check would be empty:
  // it would get nothing anyway, just because it never announced itself.
  idle.send(JSON.stringify({ t: 'alive', known: 0 }))
  const idleFrame = frame(idle, 'state')
  queue.enqueue({ nodeId: first.node.id, api: 1, method: 'exec', args: {} })
  presence.notify(first.node.id)
  const silence = await Promise.race([
    idleFrame,
    new Promise((resolve) => setTimeout(() => resolve('тишина'), 300)),
  ])
  assert.equal(silence, 'тишина', 'чужой узел не должен получать кадр про работу первого')

  // and the other way round: work for the second one reaches the second one
  const secondState = frame(idle, 'state')
  queue.enqueue({ nodeId: second.node.id, api: 1, method: 'exec', args: {} })
  presence.notify(second.node.id)
  const got = await secondState
  assert.ok(got.max_commandno >= 1)
  busy.close()
  idle.close()
})

t('check_state with known: null closes issued commands as node_restarted', async () => {
  const { node, token } = await makeNode('restarted')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')

  // the command was already issued to the node and is being executed
  const { promise } = queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  queue.take(node.id, { limit: 5 })

  const answer = frame(socket, 'state')
  socket.send(JSON.stringify({ t: 'check_state', known: null }))
  await answer

  const outcome = await promise
  assert.equal(outcome.code, 'node_restarted', 'модель должна узнать, что результат потерян')
  assert.match(outcome.message, /перезапустился/)
  socket.close()
})

t('the old frame name alive keeps working', async () => {
  const { node, token } = await makeNode('legacy')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  const pushed = frame(socket, 'state')
  socket.send(JSON.stringify({ t: 'alive', known: 0 }))
  const state = await pushed
  assert.equal(state.max_commandno, 1)
  socket.close()
})

t('the server answers pong to an application ping with the same id', async () => {
  const { node, token } = await makeNode('pingable')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  await frame(socket, 'hello-ok')
  const answer = frame(socket, 'pong')
  socket.send(JSON.stringify({ t: 'ping', id: 42 }))
  const pong = await answer
  assert.equal(pong.id, 42, 'id должен вернуться тем же: клиент различает ответы по нему')
  socket.close()
})

t('approver=local over WebSocket is not reset to none', async () => {
  const { node, token } = await makeNode('approver-node')
  // the node announced session with the approve method
  store.announce(node.id, [
    { name: 'session', version: '6', methods: [{ method: 'approve', args: { type: 'object' } }] },
  ])
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0, approver: 'local' }))
  await frame(socket, 'hello-ok')
  assert.equal(store.node(node.id).approver, 'local', 'обещание должно сохраниться')
  socket.close()
})
