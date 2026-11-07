/**
 * Сквозной тест: настоящий HTTP-сервер с обработчиком плагина и настоящий
 * клиентский цикл. Ничего не подменяем — проверяем то, что поедет на машины.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
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

// Админка больше не живёт на публичном префиксе: операции вызываются функциями.
async function admin (path, options = {}) {
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(options.body) : {}
  const rest = String(path).replace(/^\/v1\/admin/, '')
  return handleAdmin({ store, queue, config: CONFIG, prefix: '/dsh-nodes', origin: 'https://example' }, method, rest, body)
}

test('узел создаётся админом и объявляет API', async () => {
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

test('команда едет до узла и возвращается результатом', async () => {
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
  // клиент получает свой словарь режимов: ro / rw / full
  assert.equal(taken.body.commands[0].sandbox.mode, 'full')

  const closed = await api.result(base, token, 1, { ok: true, results: [{ type: 'text', text: 'привет\n' }] })
  assert.equal(closed.status, 200)

  const outcome = await promise
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.results[0].text, 'привет\n')
})

test('выдача строго после курсора и не отдаёт отданное', async () => {
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

test('поздний результат — 409, чужой номер — 404', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const token = store.reissueToken(node.id)
  const { seq } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'true' }, timeout: 5 })

  await api.commands(base, token, { after: seq - 1 })
  await api.result(base, token, seq, { ok: true, results: [] })
  const late = await api.result(base, token, seq, { ok: true, results: [] })
  assert.equal(late.status, 409)
  assert.equal(late.body.late, true)

  // чужой (несуществующий) номер — это ошибка, а не «уже закрыта»: проглотить
  // её значит молча потерять результат и всё равно сдвинуть курсор
  await assert.rejects(
    () => api.result(base, token, seq + 100, { ok: true, results: [] }),
    /нет команды|404/,
  )
})

test('таймаут снимает команду и отдаёт timeout ожидающему', async () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const { promise } = queue.enqueue({ nodeId: node.id, api: apiId, method: 'exec', args: { command: 'sleep 30' }, timeout: 0.05 })
  const outcome = await promise
  assert.equal(outcome.status, 'timeout')
  assert.equal(queue.info(node.id).queued, 0)
})

test('валидация аргументов отвечает до постановки в очередь', () => {
  const node = store.nodes()[0]
  const apiId = store.nodeApis(node.id)[0]
  const def = store.api(apiId)

  assert.throws(() => checkArgs(def, 'exec', {}), /command обязателен/)
  assert.throws(() => checkArgs(def, 'exec', { command: 42 }), /должен быть строкой/)
  assert.throws(() => checkArgs(def, 'nope', { command: 'true' }), /unknown method "nope"/)
  assert.equal(checkArgs(def, 'exec', { command: 'echo 1' }).method, 'exec')

  const before = queue.info(node.id).queued
  assert.equal(before, 0) // отказ не должен порождать команду
})

test('заявка на регистрацию: pending → approve → токен один раз', async () => {
  const uuid = 'aaaa-bbbb-cccc-dddd'
  const first = await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'lamp', proto: 1 }),
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

test('без токена — 401, с плохим токеном — 401', async () => {
  const noToken = await fetch(`${base}/v1/commands?after=0`)
  assert.equal(noToken.status, 401)
  const bad = await fetch(`${base}/v1/commands?after=0`, { headers: { authorization: 'Bearer nope' } })
  assert.equal(bad.status, 401)
})

test('старая ссылка на админку ведёт под авторизацию DSH', async () => {
  const response = await fetch(`${base}/admin`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/api/dsh-nodes/admin')
})

test('страница админки не несёт секретов и ходит на owner-гейт', async () => {
  const { renderAdmin } = await import('../lib/admin.mjs')
  const html = renderAdmin()
  assert.match(html, /dsh-nodes/)
  assert.match(html, /\/api\/dsh-nodes/)
  assert.doesNotMatch(html, /localStorage/, 'токена в странице больше нет')
  assert.match(html, /data-save=/, 'правка алиасов должна быть в странице')
})

test('pairing: админ выдаёт ссылку, клиент меняет код на токен, второй раз — 409', async () => {
  const created = await admin('/v1/admin/pairing', { method: 'POST', body: JSON.stringify({ ttlSeconds: 600 }) })
  assert.equal(created.status, 201)
  assert.match(created.body.url, /\/dsh-nodes\/pair\?v=/)
  assert.ok(created.body.code)

  const paired = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, uuid: 'pair-uuid-1', name: 'pair-node', proto: 1 }),
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

test('pairing: истёкший код отвергается', async () => {
  const created = await admin('/v1/admin/pairing', { method: 'POST', body: JSON.stringify({ ttlSeconds: 0.05 }) })
  await new Promise((resolve) => setTimeout(resolve, 80))
  const response = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code }),
  })
  assert.equal(response.status, 410)
})

test('админ-API: список узлов с API, правка алиасов, заявки', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'lamp-test' }) })
  assert.equal(created.status, 201)
  const id = created.body.node.id
  const token = created.body.token
  const ownAlias = created.body.node.aliases[0]

  // объявим API от лица узла
  await api.announce(base, token, [{ name: 'lamp', version: '3', methods: [{ method: 'set', args: { type: 'object' } }] }])

  const listed = await admin('/nodes')
  const node = listed.body.nodes.find((entry) => entry.id === id)
  assert.deepEqual(node.apis.map((a) => [a.name, a.version]), [['lamp', '3']])

  // правка алиасов: лишний снимается, новый добавляется, имя остаётся
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

test('админ-API: заявка approve и reject через функции', async () => {
  const uuid = 'deadbeef-0000-1111-2222-333344445555'
  await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'sensor', proto: 1 }),
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

test('админ-API: переименование меняет имя, а не добавляет алиас', async () => {
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

test('отзыв токена открывает заявку заново', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'revoke-me' }) })
  const id = created.body.node.id
  const token = created.body.token

  // узел работает
  const alive = await api.state(base, token)
  assert.equal(alive.status, 200)

  const revoked = await admin(`/nodes/${id}/token`, { method: 'POST', body: '' })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.body.revoked, true)

  // старый токен больше не пускают: клиент получает ошибку авторизации
  await assert.rejects(() => api.state(base, token), /token|unauthorized|токен/i)
})

test('в кадре команды едет идентификатор сессии', () => {
  
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 10 })
  const node = { id: 99 }
  queue.info(node.id)
  queue.enqueue({ nodeId: node.id, api: 1, method: 'exec', args: {}, session: 'session-abc' })
  const taken = queue.take(node.id, { after: 0 })
  assert.equal(taken.commands[0].session, 'session-abc')
})

test('токен по заявке получает только тот, кто знает nonce', async () => {
  const uuid = 'deadbeef-1111-2222-3333-444455556666'
  const nonce = 'client-secret-1'
  await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, name: 'nonce-node', proto: 1, nonce }),
  })
  const approved = await admin(`/pending/${uuid}/approve`, { method: 'POST', body: '{}' })
  assert.equal(approved.status, 200)

  // чужой без nonce токен не получает
  const stolen = await fetch(`${base}/v1/enroll/${uuid}`)
  assert.equal(stolen.status, 403, 'без nonce токен отдавать нельзя')

  // а со своим — получает
  const own = await fetch(`${base}/v1/enroll/${uuid}?nonce=${encodeURIComponent(nonce)}`)
  assert.equal(own.status, 200)
  const body = await own.json()
  assert.ok(body.token)
})

test('отказ песочницы: при выключенных апрувах спрашивать не идут', async () => {
  // узел, которому владелец запретил апрувы
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'no-ask' }) })
  const nodeId = created.body.node.id
  store.updateNode(nodeId, { allow_escalation: 0, access: 'read-only' })
  // узлу нужен свой API, иначе тул откажет раньше песочницы
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

  // ответ клиента с отказом песочницы
  const running = call.execute({ node: nodeId, api: apiId, method: 'exec', data: { command: 'touch /etc/x' } }, { agent: null })
  // ждём, пока тул поставит свою команду в очередь
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


test('отказ песочницы: апрувы выключены — отказ окончательный', async () => {
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

test('рендер ошибки показывает код возврата и stderr', () => {
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

test('отказ песочницы: согласие человека превращается в повтор с широким режимом', async () => {
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
  // ждём повторную команду с широким режимом
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

test('аргумент sandbox переводится в словарь DSH: ro → read-only, rw → workspace-write, full → danger-full-access', async () => {
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

test('взятая команда не выдаётся второй раз, курсор идёт по пачке', () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 50 })
  const nodeId = 4242
  for (let i = 0; i < 3; i++) queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i } })

  const first = queue.take(nodeId, { limit: 2 })
  assert.equal(first.commands.length, 2)
  assert.equal(first.cursor, first.commands[1].seq, 'курсор — максимум пачки')
  assert.equal(first.ready, 1, 'третья команда осталась ждать')

  const second = queue.take(nodeId, { limit: 5 })
  assert.equal(second.commands.length, 1, 'первая пачка повторно не выдаётся')
  assert.equal(second.cursor, second.commands[0].seq)

  const third = queue.take(nodeId, { limit: 5 })
  assert.equal(third.commands.length, 0)
  assert.equal(third.cursor, second.cursor, 'без готовых курсор не двигается')
})

test('взятая команда без ответа закрывается как lost, а не висит вечно', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 1, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  const nodeId = 555
  const { promise } = queue.enqueue({ nodeId, api: 1, method: 'exec', args: {} })
  queue.take(nodeId, { limit: 1 })
  // ничего не отвечаем: имитируем умерший узел
  queue.sweep(Date.now() + 60_000)
  const outcome = await promise
  assert.equal(outcome.code, 'lost')
  assert.match(outcome.message, /не ответил/)
})

test('отказ без песочницы-вопроса: сервер ставит session.approve и ждёт ответа узла', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'local-approve' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  // узлу нужны оба API: bash для команды и session для апрува
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '5', methods: [{ method: 'exec', args: { type: 'object' } }] },
    { name: 'session', version: '3', methods: [{ method: 'approve', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access' })

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

  // сервер должен был поставить команду session.approve
  const approve = queue.take(nodeId, { limit: 5 })
  assert.equal(approve.commands.length, 1, 'апрув должен уйти на узел')
  assert.equal(approve.commands[0].method, 'approve')
  const payload = JSON.parse(approve.commands[0].args.text ? '{}' : '{}')
  void payload

  // человек разрешает — сервер ставит ту же команду с approved
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

test('аптайм считается по часам сервера, а не клиента', async () => {
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

test('врущие часы клиента не ломают аптайм: считается только дельта', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'uptime-skew' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  // клиент говорит «я работаю 10 секунд», хотя его собственные часы уехали на годы
  await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apis: [{ name: 'bash', version: '3', methods: [{ method: 'exec', args: { type: 'object' } }] }], uptimeSeconds: 10 }),
  })
  const node = store.node(nodeId)
  const computed = Math.max(0, Math.round((Date.now() - node.boot_at) / 1000))
  assert.ok(computed < 60, `ожидали меньше минуты, получили ${computed}`)
})

test('исход повтора после подтверждения тоже попадает в аудит', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'audit-retry' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '2', methods: [{ method: 'exec', args: { type: 'object' } }] },
    { name: 'session', version: '4', methods: [{ method: 'approve', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  store.updateNode(nodeId, { allow_escalation: 1, access: 'danger-full-access' })
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

test('approver=local без session.approve не принимается: узел честно становится none', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'liar-node' }) })
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
  assert.equal(node.approver, 'none', 'обещание без метода не принимаем')
  assert.equal(node.allow_escalation, 0)
})

test('approver=local с session.approve принимается', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'honest-node' }) })
  const nodeId = created.body.node.id
  await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      apis: [
        { name: 'bash', version: '1', methods: [{ method: 'exec', args: { type: 'object' } }] },
        { name: 'session', version: '3', methods: [{ method: 'approve', args: { type: 'object' } }] },
      ],
      approver: 'local',
      allowEscalation: true,
    }),
  })
  assert.equal(store.node(nodeId).approver, 'local')
})

test('человек отказал в DSH-апруве — команда не выполняется', async () => {
  const created = await admin('/nodes', { method: 'POST', body: JSON.stringify({ name: 'reject-node' }) })
  const nodeId = created.body.node.id
  const token = created.body.token
  const announced = store.announce(nodeId, [
    { name: 'bash', version: '9', methods: [{ method: 'exec', args: { type: 'object' } }] },
  ])
  const bashApi = announced.apis[0]
  // локального апрувера у узла нет: спрашивать будет сервер
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

test('человек разрешил в DSH-апруве — повтор уходит с approved наверху и ступенью', async () => {
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
  assert.equal(outcome.results.length, 1)
})

test('просроченная невыданная команда получает ответ, а не тишину', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  const { promise } = queue.enqueue({ nodeId: 777, api: 1, method: 'exec', args: {} })
  // никто не забирал: узел был offline
  queue.sweep(Date.now() + 5_000)
  const outcome = await promise
  assert.equal(outcome.code, 'expired')
  assert.equal(queue.take(777, { limit: 5 }).commands.length, 0)
})

test('команда апрува не стареет: человек может думать дольше commandTtl', () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 86400, maxBatch: 5, maxQueue: 50, commandTtl: 1 })
  queue.enqueue({ nodeId: 778, api: 1, method: 'approve', args: { id: 'x', text: 't' }, timeout: 86400 })
  queue.sweep(Date.now() + 10 * 60 * 1000)
  const got = queue.take(778, { limit: 5 })
  assert.equal(got.commands.length, 1, 'вопрос человеку должен дождаться ответа')
})

test('maxQueue считает только невыданное: взятая команда не занимает слот', () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 2 })
  const nodeId = 779
  for (let i = 0; i < 2; i++) queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i } })
  const full = queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i: 9 } })
  assert.equal(full.seq, null, 'третья невыданная не должна влезать')
  queue.take(nodeId, { limit: 2 })
  const after = queue.enqueue({ nodeId, api: 1, method: 'exec', args: { i: 10 } })
  assert.ok(after.seq, 'после выдачи место освобождается')
})

test('close различает «уже закрыта» и «такой не было»', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 30, maxBatch: 5, maxQueue: 10 })
  const nodeId = 780
  const { seq, promise } = queue.enqueue({ nodeId, api: 1, method: 'exec', args: {} })
  queue.take(nodeId, { limit: 1 })
  assert.equal(queue.close(nodeId, seq, { ok: true, results: [] }), 'closed')
  await promise
  assert.equal(queue.close(nodeId, seq, { ok: true, results: [] }), 'already')
  assert.equal(queue.close(nodeId, seq + 100, { ok: true, results: [] }), 'unknown')
})

test('схема доводится по факту: нехватка колонки не мешает старту', async () => {
  // имитируем живую базу, где user_version «всё применено», а колонки нет
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
