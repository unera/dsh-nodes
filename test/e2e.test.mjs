/**
 * Сквозной тест: настоящий HTTP-сервер с обработчиком плагина и настоящий
 * клиентский цикл. Ничего не подменяем — проверяем то, что поедет на машины.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'
import * as api from '../../dsh-node-client/lib/api.mjs'
import { checkArgs } from '../lib/args.mjs'

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

async function admin (path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json', ...options.headers },
  })
  return { status: response.status, body: await response.json() }
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
  assert.deepEqual(nodes.body.nodes[0].apis, announced.body.apis.map((entry) => entry.id))
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
  assert.equal(taken.body.commands[0].sandbox.mode, 'danger-full-access')

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

  const unknown = await api.result(base, token, seq + 100, { ok: true, results: [] })
  assert.equal(unknown.status, 404)
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
  assert.ok(approved.body.alias)

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

test('админка отдаётся страницей, без токена', async () => {
  const response = await fetch(`${base}/admin`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const html = await response.text()
  assert.match(html, /dsh-nodes/)
  assert.match(html, /data-api="\/dsh-nodes\/v1\/admin"/)
  assert.match(html, /api\('\/pending'\)/)
  assert.match(html, /localStorage/)
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
