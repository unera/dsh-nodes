/**
 * The owner's switch: may a device push events at all.
 *
 * `events_enabled` is off by default on purpose — a paired device is not automatically
 * allowed to put words into a session. The switch lives in the panel, so the panel's two
 * sides are tested here too: the flag is read (`nodeView`), changed (`updateNode` and the
 * `events` operation), and a typo in the field name is a 400 rather than a silent no-op.
 *
 * The five event routes are checked one by one: a shared test would pass while one type
 * quietly fell through to a 200.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { handleAdminOp, listNodes, updateNode } from '../lib/admin-api.mjs'
import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'

/** A store in a temp directory, closed and removed when the test ends. */
function tempStore (t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-events-'))
  const file = join(dir, 'nodes.sqlite')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, file }
}

// ── migration ──────────────────────────────────────────────────────────

test('a fresh database has the column and a new node starts with events off', (t) => {
  const { file } = tempStore(t)
  const store = new Store(file)
  t.after(() => store.close())
  const columns = store.db.prepare('PRAGMA table_info(node)').all().map((row) => row.name)
  assert.ok(columns.includes('events_enabled'), `нет колонки events_enabled: ${columns.join(', ')}`)
  const { node } = store.createNode({ name: 'phone' })
  assert.equal(store.node(node.id).events_enabled, 0, 'по умолчанию события выключены')
})

test('a database from before the column gets it, and an existing node keeps working with 0', (t) => {
  const { file } = tempStore(t)
  const first = new Store(file)
  const { node } = first.createNode({ name: 'phone', access: 'workspace-write' })
  const version = first.db.prepare('PRAGMA user_version').get().user_version
  first.close()

  // a 0.3.x database: the column is not there, the step counter is one short of ours
  const raw = new DatabaseSync(file)
  raw.exec('ALTER TABLE node DROP COLUMN events_enabled')
  raw.exec(`PRAGMA user_version = ${version - 1}`)
  raw.close()

  const second = new Store(file)
  t.after(() => second.close())
  const row = second.node(node.id)
  assert.equal(row.events_enabled, 0, 'существующий узел после обновления получает 0')
  assert.equal(row.access, 'workspace-write', 'остальные поля не тронуты')
})

test('a database whose counter already says "applied" still gets the column', (t) => {
  const { file } = tempStore(t)
  const first = new Store(file)
  const { node } = first.createNode({ name: 'phone' })
  first.close()

  // the bug ensureSchema exists for: user_version is at the end, the column is missing
  const raw = new DatabaseSync(file)
  raw.exec('ALTER TABLE node DROP COLUMN events_enabled')
  raw.close()

  const second = new Store(file)
  t.after(() => second.close())
  assert.equal(second.node(node.id).events_enabled, 0)
})

// ── the admin API ──────────────────────────────────────────────────────

/** Dependencies the admin operations need, over a store in a temp directory. */
function admin (t) {
  const { file } = tempStore(t)
  const store = new Store(file)
  const queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  t.after(() => store.close())
  const config = { aliveTimeoutSeconds: 60 }
  const { node } = store.createNode({ name: 'phone' })
  return { store, queue, config, node, deps: { store, queue, config } }
}

test('nodeView tells the panel the flag, off for a node that never had it', (t) => {
  const { deps, node } = admin(t)
  const listed = listNodes(deps).body.nodes.find((row) => row.id === node.id)
  assert.equal(listed.eventsEnabled, false)
})

test('updateNode sets the flag as a boolean and stores 0 or 1', (t) => {
  const { deps, store, node } = admin(t)
  const on = updateNode(deps, node.id, { events_enabled: true })
  assert.equal(on.status, 200)
  assert.equal(on.body.node.eventsEnabled, true)
  assert.equal(store.node(node.id).events_enabled, 1)

  const off = updateNode(deps, node.id, { events_enabled: false })
  assert.equal(off.status, 200)
  assert.equal(off.body.node.eventsEnabled, false)
  assert.equal(store.node(node.id).events_enabled, 0)
})

test('an unknown field in updateNode is a 400, not a silent no-op', (t) => {
  const { deps, store, node } = admin(t)
  // the typo that would otherwise look applied: the panel would show a switch that does nothing
  const answer = updateNode(deps, node.id, { events: true })
  assert.equal(answer.status, 400)
  assert.equal(answer.body.code, 'bad_request')
  assert.match(answer.body.message, /events/)
  assert.equal(store.node(node.id).events_enabled, 0, 'флаг не изменился')
})

test('a non-boolean flag is a 400: "off" must not be guessed from a typo', (t) => {
  const { deps, node } = admin(t)
  for (const value of ['true', 1, null, 'on']) {
    const answer = updateNode(deps, node.id, { events_enabled: value })
    assert.equal(answer.status, 400, `${JSON.stringify(value)} должно быть отказом`)
    assert.equal(answer.body.code, 'bad_request')
  }
})

test('the events operation flips the flag on its own', (t) => {
  const { deps, store, node } = admin(t)
  const answer = handleAdminOp(deps, { op: 'events', id: node.id, body: { enabled: true } })
  assert.equal(answer.status, 200)
  assert.equal(answer.body.node.eventsEnabled, true)
  assert.equal(answer.body.eventsEnabled, true)
  assert.equal(store.node(node.id).events_enabled, 1)

  const back = handleAdminOp(deps, { op: 'events', id: node.id, body: { enabled: false } })
  assert.equal(back.status, 200)
  assert.equal(store.node(node.id).events_enabled, 0)
})

test('the events operation refuses a foreign field and a non-boolean', (t) => {
  const { deps, store, node } = admin(t)
  const foreign = handleAdminOp(deps, { op: 'events', id: node.id, body: { enabled: true, access: 'full' } })
  assert.equal(foreign.status, 400)
  assert.match(foreign.body.message, /access/)
  assert.equal(store.node(node.id).access, 'none', 'чужая правка не применилась')

  const typo = handleAdminOp(deps, { op: 'events', id: node.id, body: { on: true } })
  assert.equal(typo.status, 400)
  assert.match(typo.body.message, /on/)

  const notBoolean = handleAdminOp(deps, { op: 'events', id: node.id, body: { enabled: 1 } })
  assert.equal(notBoolean.status, 400)

  const missing = handleAdminOp(deps, { op: 'events', id: 999, body: { enabled: true } })
  assert.equal(missing.status, 404)
})

test('the operation is named in the documented list of operations', () => {
  const guide = readFileSync(new URL('../docs/guide.ru.md', import.meta.url), 'utf8')
  assert.match(guide, /\{op: "events"/, 'операция events не описана в docs/guide.ru.md')
  assert.match(guide, /events_enabled/, 'поле events_enabled не описано в docs/guide.ru.md')
})

// ── the event routes ───────────────────────────────────────────────────

/**
 * A real server with one node; the session side is a stub that remembers what was delivered.
 *
 * @param options.events - what the owner's switch says for this node.
 */
async function stand (t, { events = false, config = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-events-http-'))
  const store = new Store(join(dir, 'nodes.sqlite'))
  const queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const emitted = []
  const delivered = []
  const services = {
    emit: (name, payload) => emitted.push({ name, payload }),
    sessions: { flush: async () => true },
    sessionController: {
      resolveAgent: async (id) => ({
        agent: { session: { id }, followup: (message) => delivered.push({ id, message }) },
      }),
    },
  }
  const handler = createNodesServer({
    store,
    queue,
    config: {
      routePrefix: '/dsh-nodes',
      maxBodyBytes: 65536,
      maxTransferBytes: 1_000_000,
      aliveTimeoutSeconds: 60,
      voiceCacheDir: join(dir, 'incoming'),
      ...config,
    },
    services,
  })
  const server = createServer((req, res) => handler.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
  const { node, token } = store.createNode({ name: 'phone', token: 'test-node-token' })
  store.updateNode(node.id, { events_enabled: events ? 1 : 0 })
  t.after(() => {
    server.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const post = (body) => fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { base, token, node, store, queue, dir, emitted, delivered, post }
}

/** The switch is off: a 403 with the same code everywhere, and nothing got through. */
async function refused (post, body) {
  const answer = await post(body)
  assert.equal(answer.status, 403, `${JSON.stringify(body)} должно быть 403 при выключенных событиях`)
  const payload = await answer.json()
  assert.equal(payload.code, 'events_disabled')
  assert.match(payload.message, /события выключены/)
}

test('notify-button: 403 when events are off, delivered when they are on', async (t) => {
  const { post, store, node, delivered } = await stand(t, { events: false })
  store.createNotification({ id: 'n-1', node: node.id, session: 'session-x', buttons: [{ id: 'b1', label: 'да' }] })
  await refused(post, { type: 'notify-button', notification: 'n-1', button: 'b1' })
  assert.deepEqual(delivered, [], 'нажатие не должно доходить до сессии')

  const { post: on, store: store2, node: node2, delivered: delivered2 } = await stand(t, { events: true })
  store2.createNotification({ id: 'n-2', node: node2.id, session: 'session-x', buttons: [{ id: 'b1', label: 'да' }] })
  const answer = await on({ type: 'notify-button', notification: 'n-2', button: 'b1' })
  assert.equal(answer.status, 200)
  assert.equal((await answer.json()).delivered, true)
  assert.equal(delivered2.length, 1)
})

test('notify-session: 403 when events are off, delivered when they are on', async (t) => {
  const { post, delivered } = await stand(t, { events: false })
  await refused(post, { type: 'notify-session', session: 'session-x', text: 'привет' })
  assert.deepEqual(delivered, [])

  const { post: on, delivered: delivered2 } = await stand(t, { events: true })
  const answer = await on({ type: 'notify-session', session: 'session-x', text: 'привет' })
  assert.equal(answer.status, 200)
  assert.equal((await answer.json()).delivered, true)
  assert.equal(delivered2.length, 1)
})

test('new-session: 403 when events are off, accepted when they are on', async (t) => {
  const { post, emitted } = await stand(t, { events: false })
  await refused(post, { type: 'new-session' })
  assert.deepEqual(emitted, [], 'событие не должно уходить плагинам')

  const { post: on, emitted: emitted2 } = await stand(t, { events: true })
  const answer = await on({ type: 'new-session' })
  assert.equal(answer.status, 202)
  assert.deepEqual(emitted2.map((event) => event.name), ['dsh-nodes/voice-new-session'])
})

test('voice-warmup: 403 when events are off, accepted when they are on', async (t) => {
  const { post, emitted } = await stand(t, { events: false })
  await refused(post, { type: 'voice-warmup' })
  assert.deepEqual(emitted, [])

  const { post: on, emitted: emitted2 } = await stand(t, { events: true })
  const answer = await on({ type: 'voice-warmup' })
  assert.equal(answer.status, 202)
  assert.deepEqual(emitted2.map((event) => event.name), ['dsh-nodes/voice-warmup'])
})

test('bug-report: 403 when events are off, accepted when they are on', async (t) => {
  const { post, emitted } = await stand(t, { events: false })
  await refused(post, { type: 'bug-report', kind: 'tts-failed', text: 'не сказало' })
  assert.deepEqual(emitted, [])

  const { post: on, emitted: emitted2 } = await stand(t, { events: true })
  const answer = await on({ type: 'bug-report', id: 'ex-1', kind: 'tts-failed', text: 'не сказало' })
  assert.equal(answer.status, 202)
  assert.deepEqual(emitted2.map((event) => event.name), ['dsh-nodes/bug-report'])
})

test('the legacy voice.want: 403 when events are off, accepted when they are on', async (t) => {
  const { post, emitted } = await stand(t, { events: false })
  await refused(post, { voice: { want: 'record', mode: 'ptt' } })
  assert.deepEqual(emitted, [])

  const { post: on, emitted: emitted2 } = await stand(t, { events: true })
  const answer = await on({ voice: { want: 'record', mode: 'ptt' } })
  assert.equal(answer.status, 202)
  assert.deepEqual(emitted2.map((event) => event.name), ['dsh-nodes/voice-want'])
})

test('a recording still arrives while events are off: the microphone is not the switch', async (t) => {
  const { base, token, emitted, store, node } = await stand(t, { events: false })
  const bytes = Buffer.from('RIFF....WAVEfmt ')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=take-1`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202, 'голосовая запись принимается при выключенных событиях')
  const payload = await answer.json()
  assert.equal(payload.accepted, true)
  assert.equal(payload.id, 'take-1')
  assert.deepEqual(emitted.map((event) => event.name), ['dsh-nodes/voice'])
  assert.equal(store.node(node.id).events_enabled, 0, 'запись не включает события обратно')
})

test('commands are untouched by the switch: the node still takes work', async (t) => {
  const { base, token, store, queue, node } = await stand(t, { events: false })
  store.announce(node.id, [{ name: 'files', version: '1', methods: [{ method: 'read', args: { type: 'object' } }] }])
  const api = store.nodeApis(node.id)[0]
  queue.enqueue({ nodeId: node.id, api, method: 'read', args: { path: '/tmp/x' }, timeout: 5 })

  const state = await fetch(`${base}/v1/state`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(state.status, 200, 'узел на связи: /v1/state отвечает')

  const take = await fetch(`${base}/v1/commands?epoch=${queue.epoch}`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(take.status, 200)
  const batch = await take.json()
  assert.equal(batch.commands.length, 1, 'выключенные события не мешают выдавать команды')
  assert.equal(batch.commands[0].method, 'read')
})
