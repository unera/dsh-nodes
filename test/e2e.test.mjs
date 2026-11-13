import { existsSync } from 'node:fs'

// the sibling client repository exists locally but not in CI: without it these
// tests are not about what is built here but about the contract of two repositories
const hasClient = existsSync(new URL('../../dsh-node-client/lib/api.mjs', import.meta.url))
// without the client the tests are marked as skipped instead of failing
const t = hasClient ? test : (title, fn) => test.skip(title, fn)
/**
 * An end-to-end test: a real HTTP server with the plugin handler and a real
 * client loop. Nothing is stubbed — we check what ships to the machines.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import * as adminApi from '../lib/admin-api.mjs'
import { Queue } from '../lib/queue.mjs'
import { createTools, humanUptime, sandboxReport } from '../lib/tools.mjs'
import { createNodesServer } from '../lib/server.mjs'
import { handleAdmin } from '../lib/admin-api.mjs'
import * as api from '../../dsh-node-client/lib/api.mjs'
import { checkArgs } from '../lib/args.mjs'

const CONFIG = { routePrefix: '/dsh-nodes', aliveTimeoutSeconds: 60, maxPendingEnroll: 50, maxBodyBytes: 65536 }
const ADMIN = 'test-admin-token'
let dir
let store
let queue
let server
let base

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  const epoch = store.bumpEpoch()
  queue = new Queue({ epoch, defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const handler = createNodesServer({
    store,
    queue,
    config: { routePrefix: '/dsh-nodes', maxBodyBytes: 65536, aliveTimeoutSeconds: 60, maxPendingEnroll: 50 },
    adminToken: ADMIN,
  })
  server = createServer((req, res) => handler.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
})

after(() => {
  server?.close()
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

// The admin side no longer lives on the public prefix: operations are called through functions.
/** A declaration that is free to be rejected: we catch a rejection as a rejection, not as a crash. */
async function announceExpectingError (token, apis, options) {
  try {
    const ok = await api.announce(base, token, apis, options)
    return { status: ok.status, body: ok.body }
  } catch (error) {
    return { status: error.status, body: { code: error.code, message: error.message } }
  }
}

async function admin (path, options = {}) {
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(options.body) : {}
  const rest = String(path).replace(/^\/v1\/admin/, '')
  return handleAdmin({ store, queue, config: CONFIG, prefix: '/dsh-nodes', origin: 'https://example' }, method, rest, body)
}

t('a node is created by the admin and announces its API', async () => {
  const created = await admin('/v1/admin/nodes', {
    method: 'POST',
    body: JSON.stringify({ name: 'nbw', defaultTimeout: 5 }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.node.aliases[0], 'nbw')
  const token = created.body.token

  const announced = await api.announce(base, token, [api.bashApi()])
  assert.equal(announced.status, 200)
  assert.equal(announced.body.apis.length, 1)
  assert.equal(announced.body.apis[0].name, 'bash')
  assert.equal(typeof announced.body.apis[0].id, 'number')

  const catalog = await api.commands(base, token, { after: 0 })
  assert.equal(catalog.status, 200)
  assert.deepEqual(catalog.body.commands, [])

  const nodes = await admin('/v1/admin/nodes')
  assert.equal(nodes.body.nodes.length, 1)
  assert.deepEqual(nodes.body.nodes[0].apis.map((entry) => entry.id), announced.body.apis.map((entry) => entry.id))
})

t('a command travels to the node and comes back as a result', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const { seq, promise } = queue.enqueue({
    nodeId: node.id,
    api: apiId,
    method: 'exec',
    args: { command: 'echo привет' },
    timeout: 5,
  })
  assert.equal(seq, 1)

  const token = store.reissueToken(node.id)
  const taken = await api.commands(base, token, { after: 0 })
  assert.equal(taken.body.commands.length, 1)
  assert.equal(taken.body.commands[0].seq, 1)
  assert.equal(taken.body.commands[0].method, 'exec')
  // the client gets its own mode vocabulary: ro / rw / full
  assert.equal(taken.body.commands[0].sandbox.mode, 'full')

  const closed = await api.result(base, token, 1, { ok: true, results: [{ type: 'text', text: 'привет\n' }] })
  assert.equal(closed.status, 200)

  const outcome = await promise
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.results[0].text, 'привет\n')
})

t('commands are issued strictly after the cursor and issued ones are not handed out again', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const token = store.reissueToken(node.id)

  const first = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'true' }, timeout: 5 })
  const second = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'false' }, timeout: 5 })
  assert.equal(second.seq, first.seq + 1)

  const batch = await api.commands(base, token, { after: first.seq - 1, limit: 1 })
  assert.equal(batch.body.commands.length, 1)
  assert.equal(batch.body.commands[0].seq, first.seq)

  const again = await api.commands(base, token, { after: batch.body.commands[0].seq })
  assert.equal(again.body.commands[0].seq, second.seq)

  await api.result(base, token, first.seq, { ok: true, results: [] })
  await api.result(base, token, second.seq, { ok: false, code: 'bad_args', message: 'нет' })
  assert.equal((await first.promise).status, 'ok')
  assert.equal((await second.promise).status, 'error')
})

t('a late result is a 409, a foreign number is a 404', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const token = store.reissueToken(node.id)
  const { seq } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'true' }, timeout: 5 })

  await api.commands(base, token, { after: seq - 1 })
  await api.result(base, token, seq, { ok: true, results: [] })
  const late = await api.result(base, token, seq, { ok: true, results: [] })
  assert.equal(late.status, 409)
  assert.equal(late.body.late, true)

  // a foreign (nonexistent) number is an error rather than already closed: swallowing
  // it means silently losing the result and moving the cursor anyway
  await assert.rejects(
    () => api.result(base, token, seq + 100, { ok: true, results: [] }),
    /нет команды|404/,
  )
})

t('a timeout drops the command and gives timeout to the waiter', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const { promise, seq } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'sleep 30' }, timeout: 0.05 })
  // the node took the command into work: only such a one makes sense to cancel
  queue.take(node.id, { limit: 1 })
  const outcome = await promise
  assert.equal(outcome.status, 'timeout')
  // a timeout does not just drop the command: a control cancellation is placed on
  // the node so the process there does not outlive the moment the server stopped waiting
  const queued = queue.take(node.id, { limit: 10 }).commands ?? []
  const cancel = queued.find((command) => command.method === '#INTERNAL.CANCEL')
  assert.ok(cancel, 'должна быть выдана отмена')
  assert.equal(cancel.args.reason, 'timeout')
  assert.equal(cancel.args.seq, seq, 'отмена ссылается на ту самую команду')
})

t('argument validation answers before the command is queued', () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const def = store.api(apiId)

  assert.throws(() => checkArgs(def, 'exec', {}), /command обязателен/)
  assert.throws(() => checkArgs(def, 'exec', { command: 42 }), /должен быть строкой/)
  assert.throws(() => checkArgs(def, 'nope', { command: 'true' }), /unknown method "nope"/)
  assert.equal(checkArgs(def, 'exec', { command: 'echo 1' }).method, 'exec')

  const work = (queue.take(node.id, { limit: 100 }).commands ?? []).filter((command) => command.method !== '#INTERNAL.CANCEL')
  assert.equal(work.length, 0, 'отказ не должен порождать рабочую команду')
})

t('an enrollment request: pending → approve → the token comes once', async () => {
  const uuid = 'aaaa-bbbb-cccc-dddd'
  const first = await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'lamp', clientVersion: 'lamp-1' }),
  })
  assert.equal(first.status, 202)
  assert.equal((await first.json()).status, 'pending')

  const waiting = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(waiting.status, 202)

  const pending = await admin('/v1/admin/pending')
  assert.equal(pending.body.pending.length, 1)
  assert.equal(pending.body.pending[0].short, 'aaaa-bbb')

  const approved = await admin(`/v1/admin/pending/${uuid}/approve`, { method: 'POST', body: JSON.stringify({}) })
  assert.equal(approved.status, 200)
  assert.ok(approved.body.node.aliases[0])

  const handed = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(handed.status, 200)
  const body = await handed.json()
  assert.ok(body.token)

  const second = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(second.status, 409)
})

t('a request from a known device revives its own node, it does not make a twin', async () => {
  // the phone that lost its token comes back with the same uuid: confirming it must give it
  // its node back, with its name, its aliases and its rights — not a second entry in the list
  const uuid = 'eeee-ffff-0000-1111'
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'twin-phone' }) })
  const nodeId = created.body.node.id
  store.db.prepare('UPDATE node SET uuid = ?, access = ? WHERE id = ?').run(uuid, 'read-only', nodeId)
  const firstAliases = store.aliases(nodeId)
  const total = store.db.prepare('SELECT count(*) AS c FROM node').get().c

  await admin(`/nodes/${nodeId}/token`, { method: 'POST', body: '' })
  const requested = await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'twin-phone' }),
  })
  assert.equal(requested.status, 202)

  const approved = await admin(`/pending/${uuid}/approve`, { method: 'POST', body: '{}' })
  assert.equal(approved.status, 200)
  assert.equal(approved.body.node.id, nodeId, 'устройство должно получить свой прежний узел')
  assert.equal(store.db.prepare('SELECT count(*) AS c FROM node').get().c, total, 'узла-двойника быть не должно')
  assert.deepEqual(store.aliases(nodeId), firstAliases, 'имя и алиасы не меняются')
  assert.equal(store.node(nodeId).access, 'read-only', 'права не сбрасываются в none')

  const handed = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(handed.status, 200)
  assert.ok((await handed.json()).token)
})

t('no token is a 401, a bad token is a 401', async () => {
  const noToken = await fetch(`${base}/v1/commands?after=0`)
  assert.equal(noToken.status, 401)
  const bad = await fetch(`${base}/v1/commands?after=0`, { headers: { authorization: 'Bearer nope' } })
  assert.equal(bad.status, 401)
})

t('the old admin link leads under DSH authorisation', async () => {
  const response = await fetch(`${base}/admin`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/api/dsh-nodes/admin')
})

t('the admin page carries no secrets and goes through the owner gate', async () => {
  const { renderAdmin } = await import('../lib/admin.mjs')
  const html = renderAdmin()
  assert.match(html, /dsh-nodes/)
  assert.match(html, /\/api\/dsh-nodes/)
  assert.doesNotMatch(html, /localStorage/, 'токена в странице больше нет')
  assert.match(html, /data-save=/, 'правка алиасов должна быть в странице')
})

t('pairing: the admin issues a link, the client exchanges the code for a token, a second time is a 409', async () => {
  const created = await admin('/v1/admin/pairing', { method: 'POST', body: JSON.stringify({ ttlSeconds: 600 }) })
  assert.equal(created.status, 201)
  assert.match(created.body.url, /\/dsh-nodes\/pair\?v=/)
  assert.ok(created.body.code)

  const paired = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, uuid: 'pair-uuid-1', name: 'pair-node', clientVersion: 'pair-1' }),
  })
  assert.equal(paired.status, 200)
  const body = await paired.json()
  assert.ok(body.token)
  assert.equal(body.alias, 'pair-node')
  assert.ok(store.nodeByToken(body.token), 'токен должен работать')

  const again = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, name: 'x' }),
  })
  assert.equal(again.status, 409)
})

t('pairing: an expired code is rejected', async () => {
  const created = await admin('/v1/admin/pairing', { method: 'POST', body: JSON.stringify({ ttlSeconds: 0.05 }) })
  await new Promise((resolve) => setTimeout(resolve, 80))
  const response = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code }),
  })
  assert.equal(response.status, 410)
})

t('admin API: the node list with APIs, alias editing, requests', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'lamp-test' }) })
  assert.equal(created.status, 201)
  const id = created.body.node.id
  const token = created.body.token
  const ownAlias = created.body.node.aliases[0]

  // let us announce an API on behalf of the node
  await api.announce(base, token, [{ name: 'lamp', version: '3', methods: [{ method: 'set', args: { type: 'object' } }] }])

  const listed = await admin('/nodes')
  const node = listed.body.nodes.find((entry) => entry.id === id)
  assert.deepEqual(node.apis.map((a) => [a.name, a.version]), [['lamp', '3']])

  // alias editing: the extra one is dropped, the new one is added, the name stays
  const updated = await admin(`/nodes/${id}/update`, {
    method: 'POST',
    body: JSON.stringify({ aliases: ['лампа', 'lamp-kitchen'] }),
  })
  assert.equal(updated.status, 200)
  assert.deepEqual(
    updated.body.node.aliases.sort(),
    [ownAlias, 'lamp-kitchen', 'лампа'].sort(),
    'имя узла остаётся алиасом, добавленные появляются',
  )
})

t('admin API: the approve and reject requests through functions', async () => {
  const uuid = 'deadbeef-0000-1111-2222-333344445555'
  await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'sensor', clientVersion: 'sensor-1' }),
  })
  const pending = await admin('/pending')
  assert.ok(pending.body.pending.some((row) => row.uuid === uuid))

  const approved = await admin(`/pending/${uuid}/approve`, { method: 'POST', body: '{}' })
  assert.equal(approved.status, 200)
  assert.ok(approved.body.node.aliases.includes('sensor'))

  const uuid2 = 'deadbeef-0000-1111-2222-666677778888'
  await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid: uuid2, name: 'camera' }),
  })
  const rejected = await admin(`/pending/${uuid2}/reject`, { method: 'POST', body: '{}' })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.body.status, 'rejected')
})

t('admin API: renaming changes the name instead of adding an alias', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'rename-me' }) })
  const id = created.body.node.id
  const updated = await admin(`/nodes/${id}/update`, {
    method: 'POST',
    body: JSON.stringify({ name: 'renamed', aliases: ['renamed', 'второе имя'] }),
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.node.name, 'renamed')
  assert.deepEqual(updated.body.node.aliases.sort(), ['renamed', 'второе имя'].sort())
  assert.equal(await admin(`/nodes/${id}/update`, { method: 'POST', body: JSON.stringify({ name: 'nbw' }) }).then((r) => r.status), 409)
})

t('revoking the token reopens the enrollment request', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'revoke-me' }) })
  const id = created.body.node.id
  const token = created.body.token

  // the node is alive: an empty queue is the cheapest authenticated call
  const alive = await api.commands(base, token, { limit: 1 })
  assert.equal(alive.status, 200)

  const revoked = await admin(`/nodes/${id}/token`, { method: 'POST', body: '' })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.body.revoked, true)

  // the old token is no longer accepted: the client gets an authorisation error
  await assert.rejects(() => api.commands(base, token, { limit: 1 }), /token|unauthorized|токен/i)
})

t('the command frame carries the session id', () => {
  
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 10 })
  const node = { id: 99 }
  queue.info(node.id)
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {}, session: 'session-abc' })
  const taken = queue.take(node.id, { after: 0 })
  assert.equal(taken.commands[0].session, 'session-abc')
})

t('only the one who knows the nonce gets the token for a request', async () => {
  const uuid = 'deadbeef-1111-2222-3333-444455556666'
  const nonce = 'client-secret-1'
  await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'nonce-node', clientVersion: 'nonce-1', nonce }),
  })
  const approved = await admin(`/pending/${uuid}/approve`, { method: 'POST', body: '{}' })
  assert.equal(approved.status, 200)

  // a stranger without the nonce gets no token
  const stolen = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(stolen.status, 403, 'без nonce токен отдавать нельзя')

  // but with its own nonce it does
  const own = await fetch(`${base}/v1/enroll/${uuid}?nonce=${encodeURIComponent(nonce)}`)
  assert.equal(own.status, 200)
  const body = await own.json()
  assert.ok(body.token)
})

t('sandbox denial: with approvals off nobody goes asking', async () => {
  // a node whose owner forbade approvals
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'no-ask' }) })
  const nodeId = created.body.node.id
  store.updateNode(nodeId, { allow_escalation: 0, access: 'read-only' })
  // the node needs its own API, otherwise the tool would refuse before the sandbox
  const announced = store.announce(nodeId, [{ name: 'bash', version: '9', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const apiId = announced.apis[0]
  const tools = createTools({
    store,
    queue,
    config: CONFIG,
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'read-only', root: '/tmp' }),
    approval: { request: async () => 'allowed-once' },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')

  // the client answer with a sandbox denial
  const running = call.execute({ node: nodeId, api: apiId, method: 'exec', data: { command: 'touch /etc/x' } }, { agent: null })
  // wait until the tool queues its command
  let taken = { commands: [] }
  for (let i = 0; i < 50 && !taken.commands.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    taken = queue.take(nodeId, { after: 0 })
  }
  await fetch(`${base}/v1/commands/${taken.commands[0].seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'ro', denied: true, failed: true, signature: 'read-only file system' } }) }],
    }),
  })
  const outcome = await running
  assert.equal(outcome.code, 'sandbox_denied')
  assert.match(outcome.message, /Потолок узла — ro/)
})


t('sandbox denial: approvals are off, so the denial is final', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'ask-off' }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [{ name: 'bash', version: '8', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const apiId = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 0, access: 'workspace-write' })
  let asked = 0
  const tools = createTools({
    store,
    queue,
    config: CONFIG,
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'read-only', root: '/tmp' }),
    approval: { request: async () => { asked += 1; return 'allowed-once' } },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const running = call.execute({ node: nodeId, api: apiId, method: 'exec', data: { command: 'touch /etc/x' } }, { agent: null })
  let taken = { commands: [] }
  for (let i = 0; i < 50 && !taken.commands.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    taken = queue.take(nodeId, { after: 0 })
  }
  await fetch(`${base}/v1/commands/${taken.commands[0].seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'ro', denied: true, failed: true, signature: 'read-only file system' } }) }],
    }),
  })
  const outcome = await running
  assert.equal(outcome.code, 'sandbox_denied')
  assert.match(outcome.message, /запрещены владельцем/)
  assert.equal(asked, 0, 'при выключенных апрувах человека не спрашивают')
})

t('the error render shows the return code and stderr', () => {
  const tool = createTools({ store, queue, config: CONFIG, epoch: queue.epoch, sandboxFor: () => null })
    .find((entry) => entry.name === 'nodes_call')
  const rendered = tool.output.render({}, {
    status: 'error',
    code: 'sandbox_denied',
    message: 'узел 5: отказ песочницы',
    results: [{ type: 'text', text: '[stderr] bash: /x: Read-only file system' }, { type: 'text', text: '{"code":1}' }],
  })
  const text = rendered.map((block) => block.text).join('\n')
  assert.match(text, /sandbox_denied/)
  assert.match(text, /Read-only file system/)
  assert.match(text, /"code":1/)
})

t('sandbox denial: a human consent turns into a retry with a wider mode', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'ask-on' }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [{ name: 'bash', version: '7', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const apiId = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access' })
  const asked = []
  const tools = createTools({
    store,
    queue,
    config: CONFIG,
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write', root: '/tmp' }),
    approval: { request: async (request) => { asked.push(request); return 'allowed-once' } },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const running = call.execute({ node: nodeId, api: apiId, method: 'exec', data: { command: 'touch /etc/x' } }, { agent: {}, name: 'nodes_call' })
  let taken = { commands: [] }
  for (let i = 0; i < 50 && !taken.commands.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    taken = queue.take(nodeId, { after: 0 })
  }
  const first = taken.commands[0]
  await fetch(`${base}/v1/commands/${first.seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'rw', denied: true, failed: true, signature: 'read-only file system' } }) }],
    }),
  })
  // wait for the retry command with a wide mode
  let retry = { commands: [] }
  for (let i = 0; i < 100 && !retry.commands.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    retry = queue.take(nodeId, { after: first.seq })
  }
  assert.equal(asked.length, 1, 'человека спросили один раз')
  assert.equal(retry.commands[0].sandbox.mode, 'full', 'повтор идёт с полным доступом')
  await fetch(`${base}/v1/commands/${retry.commands[0].seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [{ type: 'text', text: 'готово' }] }),
  })
  const outcome = await running
  assert.equal(outcome.status, 'ok')
})

t('the sandbox argument is translated into the DSH vocabulary: ro → read-only, rw → workspace-write, full → danger-full-access', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'map-sandbox' }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [{ name: 'bash', version: '6', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const apiId = announced.apis[0]
  const tools = createTools({ store, queue, config: CONFIG, epoch: queue.epoch, sandboxFor: () => ({ mode: 'danger-full-access' }) })
  const call = tools.find((tool) => tool.name === 'nodes_call')

  for (const [arg, expected] of [['ro', 'ro'], ['rw', 'rw'], ['full', 'full']]) {
    const running = call.execute({ node: nodeId, api: apiId, method: 'exec', data: {}, sandbox: arg }, {})
    let taken = { commands: [] }
    for (let i = 0; i < 50 && !taken.commands.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      taken = queue.take(nodeId, { after: 0 })
    }
    assert.equal(taken.commands[0].sandbox.mode, expected, `аргумент ${arg} должен дать ${expected}`)
    await fetch(`${base}/v1/commands/${taken.commands[0].seq}/result`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, results: [{ type: 'text', text: 'ok' }] }),
    })
    await running
  }
})

t('a taken command is not issued a second time', () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 50 })
  const nodeId = 4242
  for (let i = 0; i < 3; i++) queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i } })

  const first = queue.take(nodeId, { limit: 2 })
  assert.equal(first.commands.length, 2)
  assert.equal(first.ready, 1, 'третья команда осталась ждать')

  const second = queue.take(nodeId, { limit: 5 })
  assert.equal(second.commands.length, 1, 'первая пачка повторно не выдаётся')

  const third = queue.take(nodeId, { limit: 5 })
  assert.equal(third.commands.length, 0)
  assert.equal(third.ready, 0)
})

t('a taken command without an answer closes as lost instead of hanging forever', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 1, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  const nodeId = 555
  const { promise } = queue.enqueue({ nodeId, api: 1, method: 'exec', args: {} })
  queue.take(nodeId, { limit: 1 })
  // we answer nothing: we imitate a dead node
  queue.sweep(Date.now() + 60_000)
  const outcome = await promise
  assert.equal(outcome.code, 'lost')
  assert.match(outcome.message, /не ответил/)
})

t('denial without a sandbox question: the server places #INTERNAL.APPROVE and waits for the node answer', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'local-approve' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  // the node needs both APIs: bash for the command and session for the approval
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '5', methods: [{ method: 'exec', args: { type: 'object' } }] },
    { name: 'session', version: '3', methods: [{ method: 'approve', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access', approver: 'local' })

  const tools = createTools({
    store,
    queue,
    config: { ...CONFIG, approvalTtlSeconds: 600 },
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write' }),
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')

  const running = call.execute({ node: nodeId, api: bashApi, method: 'exec', data: { command: 'touch /etc/x' } }, {})
  let taken = { commands: [] }
  for (let i = 0; i < 50 && !taken.commands.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    taken = queue.take(nodeId, { limit: 5 })
  }
  const first = taken.commands[0]
  await fetch(`${base}/v1/commands/${first.seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'rw', denied: true, failed: true, signature: 'read-only file system' } }) }] }),
  })
  const outcome = await running
  assert.equal(outcome.code, 'sandbox_denied')
  assert.match(outcome.message, /ждёт подтверждения/)

  // the server must have placed the service question command
  const approve = queue.take(nodeId, { limit: 5 })
  assert.equal(approve.commands.length, 1, 'апрув должен уйти на узел')
  assert.equal(approve.commands[0].method, '#INTERNAL.APPROVE', 'вопрос идёт служебной командой, а не методом API')
  assert.equal(approve.commands[0].api, -1)
  const payload = JSON.parse(approve.commands[0].args.text ? '{}' : '{}')
  void payload

  // the human allows it, so the server places the same command with approved
  await fetch(`${base}/v1/commands/${approve.commands[0].seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, code: 'approved', results: [{ type: 'text', text: JSON.stringify({ approved: true }) }] }),
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const retry = queue.take(nodeId, { limit: 5 })
  assert.equal(retry.commands.length, 1, 'после согласия команда должна уйти повторно')
  assert.ok(retry.commands[0].approved, 'повтор помечен как подтверждённый')
  assert.equal(retry.commands[0].escalation, 1)
})

t('uptime is counted by the server clock, not the client one', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'uptime-node' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apis: [{ name: 'bash', version: '4', methods: [{ method: 'exec', args: { type: 'object' } }] }], uptimeSeconds: 3600 }),
  })
  const node = store.node(nodeId)
  assert.ok(node.boot_at, 'сервер должен запомнить момент старта')
  const computed = Math.round((Date.now() - node.boot_at) / 1000)
  assert.ok(computed >= 3600 && computed < 3700, `аптайм должен быть около часа, а получился ${computed}`)
  assert.equal(humanUptime(3600 * 1000 + 720 * 1000), '1h 12m')
  assert.equal(humanUptime(45 * 1000), '45s')
})

t('a lying client clock does not break uptime: only the delta is counted', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'uptime-skew' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  // the client says it has been up 10 seconds, though its own clock drifted by years
  await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apis: [{ name: 'bash', version: '3', methods: [{ method: 'exec', args: { type: 'object' } }] }], uptimeSeconds: 10 }),
  })
  const node = store.node(nodeId)
  const computed = Math.max(0, Math.round((Date.now() - node.boot_at) / 1000))
  assert.ok(computed < 60, `ожидали меньше минуты, получили ${computed}`)
})

t('the outcome of the retry after approval also reaches the audit', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'audit-retry' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  // versions are unique for the test: the same (name, version) pair with another
  // schema from another node is now a rejection, and that is a separate test
  const announced = store.announce(nodeId, [
    { name: 'bash', version: 'audit-2', methods: [{ method: 'exec', args: { type: 'object' } }] },
    { name: 'session', version: 'audit-4', methods: [{ method: 'approve', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  // the question goes as a service command, so the node declares only a promise
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access', approver: 'local' })
  const before = store.readAudit(50).length

  const tools = createTools({ store, queue, config: { ...CONFIG }, epoch: queue.epoch, sandboxFor: () => ({ mode: 'workspace-write' }) })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const running = call.execute({ node: nodeId, api: bashApi, method: 'exec', data: { command: 'touch /etc/x' } }, {})

  const take = async () => {
    for (let i = 0; i < 60; i++) {
      const got = queue.take(nodeId, { limit: 5 })
      if (got.commands.length) return got.commands[0]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('команда не выдана')
  }
  const answer = (seq, body) => fetch(`${base}/v1/commands/${seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const first = await take()
  await answer(first.seq, { ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'rw', denied: true, failed: true, signature: 'read-only file system' } }) }] })
  await running
  const approve = await take()
  await answer(approve.seq, { ok: true, results: [{ type: 'text', text: JSON.stringify({ approved: true }) }] })
  const retry = await take()
  assert.ok(retry.approved, 'повтор должен быть помечен подтверждённым')
  await answer(retry.seq, { ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 0, sandbox: { mode: 'full', denied: false } }) }] })
  await new Promise((resolve) => setTimeout(resolve, 60))

  const kinds = store.readAudit(50).slice(0, 3).map((row) => row.kind).reverse()
  assert.deepEqual(kinds, ['denied', 'approve', 'exec'], `ожидали отказ, разрешение и исполнение, а получили ${kinds}`)
  assert.ok(store.readAudit(50).length > before)
})

t('approver=local is accepted without declarations: the question goes as a service command', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'promise-node' }) })
  const nodeId = created.body.node.id
  await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      apis: [{ name: 'bash', version: '1', methods: [{ method: 'exec', args: { type: 'object' } }] }],
      approver: 'local',
      allowEscalation: true,
    }),
  })
  const node = store.node(nodeId)
  assert.equal(node.approver, 'local', 'обещание узла принимаем как есть')
  // it did not implement the command, so it answers unknown_method, and that is an honest refusal on the spot
})

t('a human rejected the DSH approval, so the command does not run', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'reject-node' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '9', methods: [{ method: 'exec', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  // the node has no local approver: the server will ask
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access', approver: 'server' })

  const asked = []
  const tools = createTools({
    store,
    queue,
    config: { ...CONFIG },
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write' }),
    approval: { request: async (request) => { asked.push(request); return 'rejected' } },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const running = call.execute({ node: nodeId, api: bashApi, method: 'exec', data: { command: 'touch /etc/x' } }, {})

  const takeOne = async () => {
    for (let i = 0; i < 60; i++) {
      const got = queue.take(nodeId, { limit: 5 })
      if (got.commands.length) return got.commands[0]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('команда не выдана')
  }
  const first = await takeOne()
  await fetch(`${base}/v1/commands/${first.seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'rw', denied: true, failed: true, signature: 'read-only file system' } }) }] }),
  })

  const outcome = await running
  assert.equal(asked.length, 1, 'человека должны были спросить')
  assert.equal(outcome.code, 'sandbox_denied')
  assert.match(outcome.message, /человек отказал/)
  assert.equal(queue.take(nodeId, { limit: 5 }).commands.length, 0, 'после отказа повтор ставиться не должен')
  const last = store.readAudit(1)[0]
  assert.equal(last.kind, 'approve')
  assert.equal(last.outcome, 'rejected', 'отказ человека должен быть в аудите')
})

t('a human approved in DSH, so the retry leaves with approved on top and an escalation step', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'allow-node' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '8', methods: [{ method: 'exec', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access', approver: 'server' })

  const tools = createTools({
    store,
    queue,
    config: { ...CONFIG },
    epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write' }),
    approval: { request: async () => 'allowed-once' },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const running = call.execute({ node: nodeId, api: bashApi, method: 'exec', data: { command: 'touch /etc/x' } }, {})

  const takeOne = async () => {
    for (let i = 0; i < 60; i++) {
      const got = queue.take(nodeId, { limit: 5 })
      if (got.commands.length) return got.commands[0]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('команда не выдана')
  }
  const first = await takeOne()
  await fetch(`${base}/v1/commands/${first.seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 1, sandbox: { mode: 'rw', denied: true, failed: true, signature: 'read-only file system' } }) }] }),
  })

  const retryCommand = await takeOne()
  assert.equal(retryCommand.method, 'exec', 'повтор должен быть той же командой')
  assert.ok(retryCommand.approved, 'approved обязан быть на верхнем уровне: клиент читает только его')
  assert.equal(retryCommand.escalation, 1, 'ступень эскалации должна вырасти')

  await fetch(`${base}/v1/commands/${retryCommand.seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [{ type: 'text', text: JSON.stringify({ code: 0, sandbox: { mode: 'full' } }) }] }),
  })
  const outcome = await running
  assert.equal(outcome.results.length, 1, 'результат — ровно то, что вернул узел')
})

t('an expired unissued command gets an answer instead of silence', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  const { promise } = queue.enqueue({ nodeId: 777, api: 1, method: 'exec', args: {} })
  // nobody picked it up: the node was offline
  queue.sweep(Date.now() + 5_000)
  const outcome = await promise
  assert.equal(outcome.code, 'expired')
  assert.equal(queue.take(777, { limit: 5 }).commands.length, 0)
})

t('an approval is not immortal: the exceptions for it are gone', () => {
  // an unissued question ages like any command: a node the question never reached
  // must not hold it forever
  const queue = new Queue({ epoch: 1, defaultTimeout: 86400, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  queue.enqueue({ nodeId: 778, api: -1, method: '#INTERNAL.APPROVE', args: { id: 'x', text: 't' }, timeout: 86400, priority: 5 })
  queue.sweep(Date.now() + 10 * 60 * 1000)
  assert.equal(queue.take(778, { limit: 5 }).commands.length, 0, 'невыданный вопрос протухает по общему сроку')

  // while an issued one lives on its own timeout: a human may think for a long time
  const second = new Queue({ epoch: 1, defaultTimeout: 86400, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  second.enqueue({ nodeId: 779, api: -1, method: '#INTERNAL.APPROVE', args: { id: 'y', text: 't' }, timeout: 86400, priority: 5 })
  assert.equal(second.take(779, { limit: 5 }).commands.length, 1)
  second.sweep(Date.now() + 10 * 60 * 1000)
  assert.equal(second.info(779).queued, 1, 'выданный вопрос ждёт ответа человека')
})

t('maxQueue counts only unissued commands: a taken one does not hold a slot', () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 2 })
  const nodeId = 779
  for (let i = 0; i < 2; i++) queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i } })
  const full = queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i: 9 } })
  assert.equal(full.seq, null, 'третья невыданная не должна влезать')
  queue.take(nodeId, { limit: 2 })
  const after = queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i: 10 } })
  assert.ok(after.seq, 'после выдачи место освобождается')
})

t('close tells already closed from no such command', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 10 })
  const nodeId = 780
  const { seq, promise } = queue.enqueue({ nodeId, api: 1, method: 'exec', args: {} })
  queue.take(nodeId, { limit: 1 })
  assert.equal(queue.close(nodeId, seq, { ok: true, results: [] }), 'closed')
  await promise
  assert.equal(queue.close(nodeId, seq, { ok: true, results: [] }), 'already')
  assert.equal(queue.close(nodeId, seq + 100, { ok: true, results: [] }), 'unknown')
})

t('the schema heals itself: a missing column does not block startup', async () => {
  // we imitate a live database where user_version says everything is applied but the column is missing
  const dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-heal-'))
  const file = join(dir, 'state.sqlite')
  const raw = new DatabaseSync(file)
  raw.exec("CREATE TABLE node (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, token_sha256 TEXT, access TEXT DEFAULT 'none', allow_escalation INTEGER DEFAULT 1)")
  raw.exec('PRAGMA user_version = 99')
  raw.close()

  const healed = new Store(file)
  const columns = healed.db.prepare('PRAGMA table_info(node)').all().map((row) => row.name)
  assert.ok(columns.includes('approver'), 'колонка должна появиться, даже если счётчик говорит «всё применено»')
  assert.ok(columns.includes('boot_at'))
  healed.close()
  rmSync(dir, { recursive: true, force: true })
})

t('the audit is served on the admin route with a limit parameter', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'audit-route' }) })
  void created
  store.writeAudit({ kind: 'exec', node: 1, mode: 'full', command: 'echo маршрут', at: Date.now() })
  const { status, body } = adminApi.handleAdmin({ store, queue, config: CONFIG }, 'GET', '/audit?limit=5')
  assert.equal(status, 200)
  assert.ok(Array.isArray(body.audit), 'должен быть список событий')
  assert.ok(body.audit.length >= 1)
  assert.ok(body.audit.length <= 5)
})

t('the audit returns the node name, not only the number', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'audit-name' }) })
  const nodeId = created.body.node.id
  store.writeAudit({ kind: 'exec', node: nodeId, mode: 'full', command: 'echo имя', at: Date.now() })
  const { body } = adminApi.handleAdmin({ store, queue, config: CONFIG }, 'GET', '/audit?limit=5')
  const row = body.audit.find((item) => item.node === nodeId)
  assert.ok(row, 'запись должна быть в выдаче')
  assert.equal(row.nodeName, 'audit-name', 'человеку нужен имя, а не номер')
})

t('the timing rule through a real queue: duration and offset in the answer', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'timing-node', defaultTimeout: 5 }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [
    { name: 'session', version: '7', methods: [{ method: 'ping', args: { type: 'object' } }] },
  ])
  const apiId = announced.apis[0]
  store.setNodeRules(nodeId, [{
    apiId,
    method: 'ping',
    rule: 'timing',
    opts: { retNames: { durationMs: 'durationMs', clockSkewMs: 'clockSkewMs' } },
  }])

  const tools = createTools({ store, queue, config: CONFIG, epoch: queue.epoch, sandboxFor: () => ({ mode: 'danger-full-access' }) })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const pending = call.execute({ node: nodeId, api: apiId, method: 'ping', data: {} }, {})

  const take = async () => {
    for (let i = 0; i < 60; i++) {
      const got = queue.take(nodeId, { limit: 5 })
      if (got.commands.length) return got.commands[0]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('команда не выдалась')
  }
  const command = await take()
  const nodeClock = Date.now() + 5000 // the node clock is five seconds ahead
  queue.close(nodeId, command.seq, {
    ok: true,
    now: nodeClock,
    results: [{ type: 'text', text: JSON.stringify({ upSeconds: 10, platform: 'linux' }) }],
  })
  const value = await pending
  const payload = JSON.parse(value.results.at(-1).text)
  assert.equal(typeof payload.durationMs, 'number', 'длительность считает сервер')
  assert.ok(payload.durationMs >= 0)
  assert.ok(payload.clockSkewMs > 4000, `смещение около 5 секунд, а вышло ${payload.clockSkewMs}`)
  assert.equal(payload.upSeconds, 10, 'ответ узла не теряется')
  // the internal timestamps of the rule do not leak out
  for (const key of ['internal', 'ruleState', 'startedAt', 'finishedAt', 'now']) {
    assert.equal(key in payload, false, `${key} не должен попасть в ответ`)
  }
})


t('a ping does not wait more than 15 seconds, an ordinary call does wait', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'ping-timeout', defaultTimeout: 600 }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [
    { name: 'session', version: '5', methods: [{ method: 'ping', args: { type: 'object' } }] },
  ])
  const apiId = announced.apis[0]
  const tools = createTools({ store, queue, config: CONFIG, epoch: queue.epoch, sandboxFor: () => ({ mode: 'danger-full-access' }) })
  const call = tools.find((tool) => tool.name === 'nodes_call')

  void call.execute({ node: nodeId, api: apiId, method: 'ping', data: {} }, {})
  const ping = queue.take(nodeId, { limit: 5 }).commands[0]
  assert.equal(ping.timeout, 15, 'пинг не должен ждать дольше 15 секунд')

  // and if the model asks for less, we take less
  void call.execute({ node: nodeId, api: apiId, method: 'ping', data: {}, timeout: 3 }, {})
  const short = queue.take(nodeId, { limit: 5 }).commands[0]
  assert.equal(short.timeout, 3)
})

t('the admin side tells the socket apart from the last seen time', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'socket-flag' }) })
  const nodeId = created.body.node.id
  store.touch(nodeId)
  const withoutSocket = adminApi.handleAdmin({ store, queue, config: CONFIG, presence: { online: () => false } }, 'GET', '/nodes')
  const first = withoutSocket.body.nodes.find((node) => node.id === nodeId)
  assert.equal(first.socket, false, 'сокета нет — флаг false')
  assert.ok(first.lastSeen, 'время последней связи должно быть')

  const withSocket = adminApi.handleAdmin({ store, queue, config: CONFIG, presence: { online: () => true } }, 'GET', '/nodes')
  const second = withSocket.body.nodes.find((node) => node.id === nodeId)
  assert.equal(second.socket, true, 'сокет есть — флаг true')
})

t('a stopped client immediately stops being attached', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'stopped' }) })
  const nodeId = created.body.node.id
  store.touch(nodeId)  // the link was just now: by time the node still counts as alive

  const attached = adminApi.handleAdmin({ store, queue, config: CONFIG, presence: { online: (id) => id === nodeId } }, 'GET', '/nodes')
  const first = attached.body.nodes.find((node) => node.id === nodeId)
  assert.equal(first.attached, true)

  // the client was stopped: there is no socket, but the timestamp is fresh
  const detached = adminApi.handleAdmin({ store, queue, config: CONFIG, presence: { online: () => false } }, 'GET', '/nodes')
  const second = detached.body.nodes.find((node) => node.id === nodeId)
  assert.equal(second.attached, false, 'присоединения нет сразу, без ожидания таймаута')
  // online now means exactly an open channel: a fresh timestamp does not
  // make a stopped node online (otherwise it blinked between pings)
  assert.equal(second.online, false, 'без сокета узел не онлайн, даже если связь была недавно')
  assert.ok(second.lastSeen, 'время последней связи остаётся отдельным фактом')
})

t('sandboxStrict: a human rejection does not start the command at all', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'strict-deny' }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [
    { name: 'job', version: '2', methods: [{ method: 'start', args: { type: 'object' } }] },
  ])
  const jobApi = announced.apis[0]
  store.updateNode(nodeId, { access: 'danger-full-access', base: 'rw', approver: 'server', allow_escalation: 1 })

  const asked = []
  const tools = createTools({
    store, queue, config: CONFIG, epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write' }),
    approval: { request: async (request) => { asked.push(request); return 'rejected' } },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  const outcome = await call.execute({ node: nodeId, api: jobApi, method: 'start', data: { command: 'sleep 10' }, sandbox: 'full', sandboxStrict: true }, {})

  assert.equal(outcome.code, 'sandbox_denied')
  assert.match(outcome.message, /человек отказал/)
  assert.equal(asked.length, 1, 'спросили до запуска')
  assert.match(asked[0].reason, /без понижения/)
  assert.equal(queue.take(nodeId, { limit: 5 }).commands.length, 0, 'задание не должно попасть в очередь')
})

t('sandboxStrict: within base we do not ask', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'strict-silent' }) })
  const nodeId = created.body.node.id
  const announced = store.announce(nodeId, [
    { name: 'job', version: '3', methods: [{ method: 'start', args: { type: 'object' } }] },
  ])
  const jobApi = announced.apis[0]
  store.updateNode(nodeId, { access: 'danger-full-access', base: 'rw', approver: 'server', allow_escalation: 1 })

  let asked = 0
  const tools = createTools({
    store, queue, config: CONFIG, epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'workspace-write' }),
    approval: { request: async () => { asked++; return 'rejected' } },
  })
  const call = tools.find((tool) => tool.name === 'nodes_call')
  void call.execute({ node: nodeId, api: jobApi, method: 'start', data: { command: 'echo' }, sandbox: 'rw', sandboxStrict: true }, {})
  let taken = null
  for (let i = 0; i < 60 && !taken; i++) {
    taken = queue.take(nodeId, { limit: 5 }).commands[0] ?? null
    if (!taken) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(taken, 'команда должна уйти на узел сразу')
  assert.equal(asked, 0, 'в пределах base вопросов нет')
})

t('the panel dictionaries are complete in all three languages', async () => {
  const { en, ru, zh } = await import('../src/client/i18n.js')
  const keys = Object.keys(en)
  assert.ok(keys.length > 60, `строк должно быть много, а их ${keys.length}`)
  for (const [name, dict] of [['ru', ru], ['zh', zh]]) {
    const missing = keys.filter((key) => !(key in dict))
    assert.deepEqual(missing, [], `${name}: нет строк ${missing.join(', ')}`)
  }
})

t('applyRules: garbage in a binding rejects the whole declaration', async () => {
  const created = await admin('/v1/admin/nodes', { method: 'POST', body: JSON.stringify({ name: 'rules-bad' }) })
  assert.equal(created.status, 201)
  const token = created.body.token
  const apis = [{ name: 'lampx', version: '1', methods: [{ method: 'set', args: { type: 'object' } }] }]

  // a rule for a method the api does not declare is a typo, not a let us skip it
  const badMethod = await announceExpectingError(token, apis, {
    applyRules: [{ api: 'lampx', method: 'nope', rule: 'timing' }],
  })
  assert.equal(badMethod.status, 400)
  assert.equal(badMethod.body.code, 'apply-rules-invalid')
  assert.match(badMethod.body.message, /не объявляет метод/)

  const badRule = await announceExpectingError(token, apis, {
    applyRules: [{ api: 'lampx', method: 'set', rule: 'timing-ish' }],
  })
  assert.equal(badRule.status, 400)
  assert.match(badRule.body.message, /неизвестно/)
})

t('applyRules: the binding lives with the node, not in the API declaration', async () => {
  const created = await admin('/v1/admin/nodes', { method: 'POST', body: JSON.stringify({ name: 'rules-ok' }) })
  const token = created.body.token
  const nodeId = created.body.node.id
  const apis = [{ name: 'lampy', version: '1', methods: [{ method: 'set', args: { type: 'object' } }] }]

  const announced = await api.announce(base, token, apis, {
    applyRules: [{ api: 'lampy', method: 'set', rule: 'timing', rulesOpts: { retNames: { durationMs: 'took' } } }],
  })
  assert.equal(announced.status, 200)
  const apiId = store.nodeApis(nodeId)[0]
  assert.deepEqual(store.nodeRule(nodeId, apiId, 'set'), { rule: 'timing', opts: { retNames: { durationMs: 'took' } } })
  // and apidef has no service fields: the contract stays clean
  const def = store.api(apiId)
  assert.equal(Object.prototype.hasOwnProperty.call(def.methods[0], 'special'), false)
})

t('the same (name, version) pair with different methods is a rejection of the declaration', async () => {
  const a = await admin('/v1/admin/nodes', { method: 'POST', body: JSON.stringify({ name: 'conflict-a' }) })
  const b = await admin('/v1/admin/nodes', { method: 'POST', body: JSON.stringify({ name: 'conflict-b' }) })
  const first = await api.announce(base, a.body.token, [{
    name: 'sharedapi', version: '1', methods: [{ method: 'a', args: { type: 'object' } }],
  }])
  assert.equal(first.status, 200)

  // a second node with the same pair and other methods: the server would take the
  // first schema while the second executed commands under a foreign contract
  const conflict = await announceExpectingError(b.body.token, [{
    name: 'sharedapi', version: '1', methods: [{ method: 'b', args: { type: 'object' } }],
  }])
  assert.equal(conflict.status, 400)
  assert.equal(conflict.body.code, 'apidef-conflict')
  assert.match(conflict.body.message, /поднимите версию/)

  // a raised version is another contract, and that is legitimate
  const versioned = await api.announce(base, b.body.token, [{
    name: 'sharedapi', version: '2', methods: [{ method: 'b', args: { type: 'object' } }],
  }])
  assert.equal(versioned.status, 200)
})

t('a rules rejection does not leave the declaration half-written', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'atomic-node' }) })
  const token = created.body.token
  const nodeId = created.body.node.id

  const good = [{ name: 'bash', version: 'atomic-1', methods: [{ method: 'exec', args: { type: 'object' } }] }]
  assert.equal((await api.announce(base, token, good)).status, 200)
  const before = store.nodeApis(nodeId)
  assert.equal(before.length, 1)

  // a new declaration with a typo in the rules: another api, a rule for a method
  // that does not exist
  const bad = await announceExpectingError(token, [
    { name: 'shell', version: 'atomic-1', methods: [{ method: 'exec', args: { type: 'object' } }] },
  ], { applyRules: [{ api: 'shell', method: 'no-such', rule: 'timing' }] })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'apply-rules-invalid')

  // the declaration rolled back as a whole: the node apis are the previous ones, no new records
  assert.deepEqual(store.nodeApis(nodeId), before, 'apis не должны измениться при отказе')
  assert.equal(
    store.catalog().some((entry) => entry.name === 'shell' && entry.version === 'atomic-1'),
    false,
    'отказанный api не должен появиться в справочнике',
  )
})
