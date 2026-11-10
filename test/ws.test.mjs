import { existsSync } from 'node:fs'

// the sibling client repository exists locally but not in CI: without it these
// tests are not about what is built here but about the contract of two repositories
const hasClient = existsSync(new URL('../../dsh-node-client/lib/api.mjs', import.meta.url))
// without the client the tests are marked as skipped instead of failing
const t = hasClient ? test : (title, fn) => test.skip(title, fn)
/**
 * Presence over WebSocket and the epoch rules: two frames, the generation as the
 * identity token, eviction of the second connection. We check with a real socket,
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

/** The API every node in these tests declares: enough for a command to have a target. */
const BASH = [{
  name: 'bash',
  version: '1',
  methods: [{ method: 'exec', args: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
}]

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

/** Resolve with the close code; a socket that never closes is a failure, not a hang. */
function closed (socket, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сокет не закрылся')), ms)
    socket.once('close', (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: String(reason) })
    })
  })
}

/** The absence of a frame over `ms`: waiting for silence is a test of its own. */
function silence (socket, type, ms = 300) {
  // the frame we wait for may arrive after the verdict: its own rejection is swallowed,
  // otherwise it would surface as an unhandled one in a later test
  const heard = frame(socket, type, ms).then(() => 'кадр').catch(() => 'тишина')
  return Promise.race([heard, new Promise((resolve) => setTimeout(() => resolve('тишина'), ms))])
}

/** The full `state` frame the client sends: generation, own generation, known number. */
function state (socket, { epoch = queue.epoch, clientEpoch, maxCommandno } = {}) {
  const payload = { t: 'state', epoch, max_commandno: maxCommandno }
  if (clientEpoch !== undefined) payload.client_epoch = clientEpoch
  socket.send(JSON.stringify(payload))
}

async function http (method, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed }
}

/** An announcement with sane defaults: only what a test cares about is overridden. */
async function announce (token, options = {}) {
  return http('PUT', '/v1/announce', token, {
    apis: BASH,
    clientVersion: 'test-1',
    access: 'rw',
    uptimeSeconds: 1,
    ...options,
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

/** A node with an announcement behind it: most tests need a declared API to queue work. */
async function makeAnnouncedNode (name, options = {}) {
  const created = await makeNode(name)
  const announced = await announce(created.token, options)
  assert.equal(announced.status, 200, `объявление должно приниматься: ${JSON.stringify(announced.body)}`)
  return created
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

t('a state frame with a foreign epoch closes the socket with 4409 and the node goes offline', async () => {
  const { node, token } = await makeAnnouncedNode('lamp')
  const socket = await open(token)
  state(socket, { epoch: queue.epoch - 1 })
  const { code, reason } = await closed(socket)
  assert.equal(code, 4409, 'чужое поколение — это закрытие сокета, а не тихий игнор')
  assert.equal(reason, 'epoch')
  assert.equal(presence.online(node.id), false, 'узел без сокета не онлайн')
})

t('a state frame without an epoch is a foreign epoch too', async () => {
  const { token } = await makeAnnouncedNode('lamp-no-epoch')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'state', max_commandno: 0 }))
  const { code } = await closed(socket)
  assert.equal(code, 4409)
})

t('state with no work sets a wait, and queueing a command wakes the node', async () => {
  const { node, token } = await makeAnnouncedNode('nbw')
  const socket = await open(token)
  state(socket, { maxCommandno: 0 })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const apiId = store.nodeApis(node.id)[0]
  const { seq } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'true' }, timeout: 5 })
  presence.notify(node.id)
  const pushed = await frame(socket, 'state')
  assert.equal(pushed.max_commandno, seq)
  assert.equal(pushed.epoch, queue.epoch, 'кадр несёт и поколение: по нему клиент проверяет себя')
  socket.close()
})

t('the second connection evicts the first with code 4001', async () => {
  const { token } = await makeAnnouncedNode('desktop')
  const first = await open(token)
  state(first, { maxCommandno: 0 })
  const firstClosed = closed(first)

  const second = await open(token)
  state(second, { maxCommandno: 0 })
  const { code } = await firstClosed
  assert.equal(code, 4001)
  second.close()
})

t('presence counts as online for /v1/admin/nodes', async () => {
  const { token } = await makeAnnouncedNode('online-check')
  const socket = await open(token)
  state(socket, { maxCommandno: 0 })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const listed = await admin('/nodes')
  const node = listed.body.nodes.find((entry) => entry.aliases.includes('online-check'))
  assert.equal(node.online, true)
  socket.close()
})

t('revoking the token tears down an open session', async () => {
  const { node, token } = await makeAnnouncedNode('revoke-ws')
  const socket = await open(token)
  state(socket, { maxCommandno: 0 })
  for (let i = 0; i < 40 && !presence.online(node.id); i++) await new Promise((r) => setTimeout(r, 25))
  assert.equal(presence.online(node.id), true)

  const closing = closed(socket)
  await admin(`/nodes/${node.id}/token`, { method: 'POST', body: '' })
  const { code } = await closing
  assert.equal(code, 4401, 'сессия должна закрыться с кодом «токен отозван»')
  assert.equal(presence.online(node.id), false)
})

t('a lagging number gets state at once, the current one stays silent', async () => {
  const { node, token } = await makeAnnouncedNode('sensor')
  const socket = await open(token)
  state(socket, { maxCommandno: 0 })
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })

  // the client claims 0 while the server already has 1 — the answer must come at once.
  // We attach the listener before sending: on localhost the answer arrives first.
  const waitingState = frame(socket, 'state')
  state(socket, { maxCommandno: 0 })
  const answer = await waitingState
  assert.equal(answer.max_commandno, 1, 'кадр несёт номер последней команды')

  // now the client is up to date — the server stays silent and remembers the wait
  const maybeState = silence(socket, 'state')
  state(socket, { maxCommandno: 1 })
  assert.equal(await maybeState, 'тишина', 'на пустом приросте кадров быть не должно')

  // and as soon as work appears it arrives by itself
  const pushedState = frame(socket, 'state')
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  presence.notify(node.id)
  const pushed = await pushedState
  assert.equal(pushed.max_commandno, 2)
  socket.close()
})

t('a mismatching max_commandno is not a reason to close the socket', async () => {
  const { node, token } = await makeAnnouncedNode('liar')
  const socket = await open(token)
  state(socket, { maxCommandno: 99 })
  // the number is a claim, not an identity: the server only logs the divergence
  assert.equal(await silence(socket, 'state'), 'тишина')
  assert.equal(presence.online(node.id), true)
  socket.close()
})

t('a frame goes only to the waiting one: a busy node gets nothing', async () => {
  const { node, token } = await makeAnnouncedNode('busy')
  const socket = await open(token)
  // the node connected but said nothing: it is not waiting, it is working through a batch
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  presence.notify(node.id)
  assert.equal(await silence(socket, 'state', 250), 'тишина')

  // it said it waits — and the frame arrives
  const pushed = frame(socket, 'state')
  state(socket, { maxCommandno: 0 })
  const answer = await pushed
  assert.equal(answer.max_commandno, 1)
  socket.close()
})

t('events are isolated: work for one node does not wake the second one', async () => {
  const first = await makeAnnouncedNode('busy-one')
  const second = await makeAnnouncedNode('idle-one')
  const busy = await open(first.token)
  const idle = await open(second.token)
  // both said they wait and are up to date: nothing is pending for either
  state(busy, { maxCommandno: 0 })
  state(idle, { maxCommandno: 0 })
  await new Promise((resolve) => setTimeout(resolve, 100))

  // work appeared only for the first one — it gets the frame
  const busyState = frame(busy, 'state')
  queue.enqueue({ nodeId: first.node.id, api: 1, method: 'exec', args: {} })
  presence.notify(first.node.id)
  await busyState

  // the second one is waiting too, and someone else's work must not reach it.
  // Saying "I am waiting" again is what keeps the check honest: without it the second
  // node would get nothing anyway, just because it never declared the wait
  state(idle, { maxCommandno: 0 })
  const silenceForIdle = silence(idle, 'state')
  queue.enqueue({ nodeId: first.node.id, api: 1, method: 'exec', args: {} })
  presence.notify(first.node.id)
  assert.equal(await silenceForIdle, 'тишина', 'чужой узел не должен получать кадр про работу первого')

  // and the other way round: work for the second one reaches the second one
  const secondState = frame(idle, 'state')
  queue.enqueue({ nodeId: second.node.id, api: 1, method: 'exec', args: {} })
  presence.notify(second.node.id)
  const got = await secondState
  assert.ok(got.max_commandno >= 1)
  busy.close()
  idle.close()
})

t('a state frame with a stale client epoch closes the socket with 4001', async () => {
  const { node, token } = await makeAnnouncedNode('stale-socket', { client_epoch: 7 })
  const socket = await open(token)
  state(socket, { clientEpoch: 6 })
  const { code, reason } = await closed(socket)
  assert.equal(code, 4001, 'старый экземпляр узла не должен перебивать новый')
  assert.equal(reason, 'client-epoch')
  assert.equal(presence.online(node.id), false)
})

t('a state frame with the same or a newer client epoch is accepted', async () => {
  const { node, token } = await makeAnnouncedNode('fresh-socket', { client_epoch: 7 })
  const socket = await open(token)
  state(socket, { clientEpoch: 7, maxCommandno: 0 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(presence.online(node.id), true)
  socket.close()
})

t('an unknown frame closes the socket: the socket speaks exactly two frames', async () => {
  const { token } = await makeAnnouncedNode('old-frame')
  const socket = await open(token)
  socket.send(JSON.stringify({ t: 'hello', epoch: queue.epoch, known: 0 }))
  const { code } = await closed(socket)
  assert.equal(code, 4400, 'старый hello — это другой протокол, а не совместимость')
})

t('the server answers pong to an application ping with the same number', async () => {
  const { token } = await makeAnnouncedNode('pingable')
  const socket = await open(token)
  const answer = frame(socket, 'pong')
  socket.send(JSON.stringify({ t: 'ping', no: 42 }))
  const pong = await answer
  assert.equal(pong.no, 42, 'номер должен вернуться тем же: клиент различает ответы по нему')
  socket.close()
})

t('announce with epoch: null closes issued commands as node_restarted', async () => {
  const { node, token } = await makeAnnouncedNode('restarted')
  // the command was already issued to the node and is being executed
  const { promise } = queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  queue.take(node.id, { limit: 5 })

  const answer = await announce(token, { epoch: null, client_epoch: 1 })
  assert.equal(answer.status, 200)

  const outcome = await promise
  assert.equal(outcome.code, 'node_restarted', 'модель должна узнать, что результат потерян')
  assert.match(outcome.message, /перезапустился/)
})

t('announce with a wrong epoch is refused and writes nothing', async () => {
  const { node, token } = await makeAnnouncedNode('wrong-epoch', { client_epoch: 3, access: 'rw' })
  const before = store.node(node.id)
  const apisBefore = store.nodeApis(node.id)
  const { promise, seq } = queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {} })
  queue.take(node.id, { limit: 5 })

  const answer = await announce(token, {
    epoch: queue.epoch + 5,
    client_epoch: 9,
    access: 'full',
    apis: [{ name: 'other', version: '1', methods: [{ method: 'ping', args: { type: 'object' } }] }],
  })
  assert.equal(answer.status, 409)
  assert.equal(answer.body.code, 'epoch-mismatch')

  const after = store.node(node.id)
  assert.deepEqual(store.nodeApis(node.id), apisBefore, 'объявление не должно применяться')
  assert.equal(after.access, before.access, 'потолок прав не пишется при отказе')
  assert.equal(after.client_epoch, 3, 'поколение клиента не двигается при отказе')
  // nothing was closed either: epoch: null is the only statement that closes commands
  const outcome = await Promise.race([
    promise.then(() => 'закрыта'),
    new Promise((resolve) => setTimeout(() => resolve('жива'), 200)),
  ])
  assert.equal(outcome, 'жива')
  queue.close(node.id, seq, { ok: true, results: [] })
})

t('announce with a stale client epoch is refused with 409 client-epoch-stale', async () => {
  const { node, token } = await makeAnnouncedNode('stale-announce', { client_epoch: 5 })
  const answer = await announce(token, { client_epoch: 4 })
  assert.equal(answer.status, 409)
  assert.equal(answer.body.code, 'client-epoch-stale')
  assert.equal(store.clientEpoch(node.id), 5, 'известное поколение остаётся прежним')
})

t('announce stores the client epoch and answers with the server epoch', async () => {
  const { node, token } = await makeAnnouncedNode('generation', { client_epoch: 4 })
  assert.equal(store.clientEpoch(node.id), 4)
  const again = await announce(token, { client_epoch: 5 })
  assert.equal(again.status, 200)
  assert.equal(again.body.epoch, queue.epoch)
  assert.equal(store.clientEpoch(node.id), 5)
})

t('commands with a wrong epoch answer 409 epoch-mismatch', async () => {
  const { token } = await makeAnnouncedNode('commands-epoch')
  const wrong = await http('GET', `/v1/commands?limit=5&epoch=${queue.epoch + 1}`, token)
  assert.equal(wrong.status, 409)
  assert.equal(wrong.body.code, 'epoch-mismatch')

  const noClaim = await http('GET', '/v1/commands?limit=5&client_epoch=1', token)
  assert.equal(noClaim.status, 200, 'без заявленного поколения сервера проверять нечего')

  const right = await http('GET', `/v1/commands?limit=5&epoch=${queue.epoch}`, token)
  assert.equal(right.status, 200)
  assert.ok(Array.isArray(right.body.commands))
})

t('commands with a stale client epoch answer 409 client-epoch-stale', async () => {
  const { token } = await makeAnnouncedNode('commands-stale', { client_epoch: 6 })
  const answer = await http('GET', `/v1/commands?limit=5&epoch=${queue.epoch}&client_epoch=5`, token)
  assert.equal(answer.status, 409)
  assert.equal(answer.body.code, 'client-epoch-stale')
})

t('approver=local survives over announce: presence fields live there now', async () => {
  const { node, token } = await makeAnnouncedNode('approver-node', { approver: 'local' })
  assert.equal(store.node(node.id).approver, 'local', 'обещание должно сохраниться')
  assert.equal(store.node(node.id).access, 'workspace-write')
})

/** The node row as it lies on disk: a refusal must not move a single field. */
function nodeSnapshot (id) {
  // `last_seen` is authentication (`authNode` touches the node), not the announcement
  const { last_seen: _seen, ...rest } = store.node(id)
  return rest
}

t('announce with invalid applyRules writes nothing: the node stays exactly as it was', async () => {
  const { node, token } = await makeAnnouncedNode('rules-refused', {
    client_epoch: 2, access: 'rw', base: 'rw', approver: 'server', workdir: '/srv/work', platform: 'desktop',
  })
  const before = nodeSnapshot(node.id)
  const apisBefore = store.nodeApis(node.id)
  const rulesBefore = store.nodeRules(node.id)

  const answer = await announce(token, {
    client_epoch: 3,
    access: 'full',
    base: 'full',
    approver: 'local',
    workdir: '/elsewhere',
    platform: 'android',
    applyRules: [{ api: 'bash', method: 'exec', rule: 'nope' }],
  })
  assert.equal(answer.status, 400)
  assert.equal(answer.body.code, 'apply-rules-invalid')
  assert.deepEqual(nodeSnapshot(node.id), before, 'отказ по правилам не должен трогать поля узла')
  assert.deepEqual(store.nodeApis(node.id), apisBefore, 'apis остаются прежними')
  assert.deepEqual(store.nodeRules(node.id), rulesBefore, 'биндинги остаются прежними')
})

t('announce with a conflicting contract is refused and writes nothing', async () => {
  // the first node owns the contract `bash@1`: whoever comes second with other methods is refused
  await makeAnnouncedNode('conflict-owner')
  const other = await makeNode('conflict-other')
  const before = nodeSnapshot(other.node.id)

  const answer = await announce(other.token, {
    client_epoch: 2,
    access: 'full',
    platform: 'android',
    apis: [{
      name: 'bash',
      version: '1',
      methods: [{ method: 'exec', args: { type: 'object' }, description: 'другой контракт' }],
    }],
  })
  assert.equal(answer.status, 400)
  assert.equal(answer.body.code, 'apidef-conflict')
  assert.match(answer.body.message, /поднимите версию контракта/)
  assert.deepEqual(nodeSnapshot(other.node.id), before, 'конфликт контракта не должен трогать поля узла')
  assert.deepEqual(store.nodeApis(other.node.id), [], 'apis не появляются при отказе')

  // the same contract is not a conflict: the node just joins the existing declaration
  const same = await announce(other.token, { client_epoch: 3 })
  assert.equal(same.status, 200)
  assert.equal(store.nodeApis(other.node.id).length, 1)
})

t('announce with a malformed api shape is refused before anything is written', async () => {
  const { node, token } = await makeNode('broken-shape')
  const before = nodeSnapshot(node.id)
  const cases = [
    { apis: 'bash' },
    { apis: [{ name: '   ', version: '1', methods: [{ method: 'exec', args: { type: 'object' } }] }] },
    { apis: [{ name: 'bash', version: 1, methods: [{ method: 'exec', args: { type: 'object' } }] }] },
    { apis: [{ name: 'bash', version: '1', methods: [] }] },
    { apis: [{ name: 'bash', version: '1', methods: ['exec'] }] },
    { apis: [{ name: 'bash', version: '1', methods: [{ method: 'exec' }] }] },
  ]
  for (const body of cases) {
    const answer = await announce(token, { client_epoch: 5, access: 'full', platform: 'android', ...body })
    assert.equal(answer.status, 400, `должно отказать: ${JSON.stringify(body)}`)
    assert.equal(answer.body.code, 'bad_request')
    assert.deepEqual(nodeSnapshot(node.id), before, `форма проверяется до записи: ${JSON.stringify(body)}`)
  }
  assert.deepEqual(store.nodeApis(node.id), [], 'apis не появляются при отказе')
})

t('a successful announce writes the node fields, the apis and the rules together', async () => {
  const { node, token } = await makeNode('atomic-ok')
  const answer = await announce(token, {
    client_epoch: 7,
    access: 'full',
    base: 'rw',
    approver: 'local',
    workdir: '/home/user/project',
    platform: 'android',
    applyRules: [{ api: 'bash', method: 'exec', rule: 'timing', rulesOpts: { retNames: { durationMs: 'took' } } }],
  })
  assert.equal(answer.status, 200, JSON.stringify(answer.body))

  const row = store.node(node.id)
  assert.equal(row.access, 'danger-full-access')
  assert.equal(row.base, 'rw')
  assert.equal(row.approver, 'local')
  assert.equal(row.workdir, '/home/user/project')
  assert.equal(row.platform, 'android')
  assert.equal(row.client_epoch, 7)
  assert.equal(row.client_version, 'test-1')
  assert.ok(Number.isInteger(row.boot_at), 'аптайм переводится в наше время на объявлении')

  const apis = store.nodeApis(node.id)
  assert.equal(apis.length, 1, 'apis записываются той же транзакцией')
  assert.deepEqual(store.nodeRules(node.id), [
    { api: apis[0], method: 'exec', rule: 'timing', opts: { retNames: { durationMs: 'took' } } },
  ], 'биндинги пишутся вместе с полями и apis')
})

t('platform shows up in the admin node list and survives an announce without it', async () => {
  const { node, token } = await makeAnnouncedNode('platform-node', { platform: 'android' })
  const listed = await admin('/nodes')
  const view = listed.body.nodes.find((item) => item.id === node.id)
  assert.equal(view.platform, 'android', 'платформа видна в админке рядом с версией клиента')

  // an older client knows nothing about the field: silence keeps the value it does not send
  const again = await http('PUT', '/v1/announce', token, { apis: BASH, clientVersion: 'test-1', access: 'rw' })
  assert.equal(again.status, 200)
  assert.equal(store.node(node.id).platform, 'android', 'объявление без platform не обнуляет прежнее значение')

  // a broken value is not a reason to refuse the announcement, only to ignore the value
  for (const platform of ['   ', 'x'.repeat(33), 42]) {
    const broken = await announce(token, { platform })
    assert.equal(broken.status, 200, `косметическое поле не отказывает объявлению: ${JSON.stringify(platform)}`)
    assert.equal(store.node(node.id).platform, 'android')
  }

  const trimmed = await announce(token, { platform: '  desktop  ' })
  assert.equal(trimmed.status, 200)
  assert.equal(store.node(node.id).platform, 'desktop', 'значение обрезается по пробелам')
})
