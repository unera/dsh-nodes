/**
 * Сквозной тест передачи файла по HTTP: настоящий сервер, настоящий поток.
 *
 * Это тот тест, которого не хватило: обработчик звал несуществующий `send`,
 * и отказ видели только на живом узле.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'

let dir
let store
let queue
let server
let base
let token

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-http-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 30 })
  const nodes = createNodesServer({ store, queue, config: {}, log: () => {} })
  server = createServer((req, res) => { void nodes.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
  const created = store.createNode({ name: 'test-node', access: 'workspace-write' })
  token = created.token
  store.announce(created.node.id, [{ name: 'transfer', version: '1', methods: [{ method: 'files.download', args: { type: 'object' } }] }])
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Выдать команду так, как это делает сервер перед передачей. */
function issue (method, args) {
  const node = store.nodeByAlias('test-node')
  return queue.enqueue({ nodeId: node.id, api: 1, method, args, timeout: 30 })
}

test('download-file отдаёт файл с размером и токеном узла', async () => {
  const path = join(dir, 'payload.bin')
  const body = Buffer.from([1, 2, 3, 250, 251, 13, 10])
  writeFileSync(path, body)
  const { seq } = issue('copyToDevice', { path: '/node/path', hostPath: path })
  const res = await fetch(`${base}/v1/download-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': '0' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), String(body.length))
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), body)
})

test('без команды — 403 с текстом, без токена — 401', async () => {
  const noCommand = await fetch(`${base}/v1/download-file?seq=999`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': '0' },
  })
  assert.equal(noCommand.status, 403)
  const payload = await noCommand.json()
  assert.match(payload.message, /не выдавалась/)

  const noToken = await fetch(`${base}/v1/download-file?seq=1`, { method: 'POST', headers: { 'content-length': '0' } })
  assert.equal(noToken.status, 401)
})

test('upload-file принимает тело и сверяет размер', async () => {
  const path = join(dir, 'incoming.bin')
  const body = Buffer.from('hello world')
  const { seq } = issue('copyFromDevice', { path: '/node/path', hostPath: path, size: body.length })
  const res = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(body.length), 'x-mode': '644' },
    body,
  })
  assert.equal(res.status, 200)
  const answer = await res.json()
  assert.equal(answer.bytes, body.length)
  assert.equal(answer.mode, 0o644)
  assert.deepEqual(readFileSync(path), body)
})

test('панель и сервер сходятся на маршруте операций', async () => {
  // админ-маршруты живут в connection.fetch и в этом сервере не монтируются,
  // поэтому проверяем статически: панель шлёт на /op, и маршрут должен быть
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  assert.match(source, /path: '\/api\/dsh-nodes\/op'/, 'маршрут /op не зарегистрирован — панель получит 404')
})

test('событие устройства: без сессии и текста — 400, с ними — доставлено', async () => {
  const delivered = []
  const services = {
    sessions: { flush: async () => true },
    sessionController: {
      resolveAgent: async (id) => ({
        agent: {
          // заглушка агента: запоминаем, что именно положили в сессию
          session: { id },
          followup: (message) => delivered.push(message),
        },
      }),
    },
  }
  const local = createNodesServer({ store, queue, config: {}, log: () => {}, services })
  const srv = createServer((req, res) => { void local.handle(req, res) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${srv.address().port}/dsh-nodes`
  const post = (body) => fetch(`${origin}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const empty = await post({})
  assert.equal(empty.status, 400)

  const ok = await post({ session: 'session-x', text: 'привет', button: 'reload' })
  assert.equal(ok.status, 200)
  assert.equal(delivered.length, 1, 'сообщение должно уйти агенту ровно один раз')
  const text = delivered[0].content[0].text
  assert.match(text, /кнопка «reload»/, 'в тексте должна быть кнопка')
  assert.match(text, /session-x|привет/, 'и сам текст события')

  await new Promise((resolve) => srv.close(resolve))
})

test('повторный pair с тем же uuid переподключает узел, а не плодит новый', async () => {
  const code1 = store.createPairing('probe-code-1', { ttlSeconds: 600 })
  const first = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'probe-code-1', uuid: 'uuid-same-device', name: 'phone' }),
  })
  assert.equal(first.status, 200)
  const one = await first.json()

  store.createPairing('probe-code-2', { ttlSeconds: 600 })
  const second = await fetch(`${base}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'probe-code-2', uuid: 'uuid-same-device', name: 'phone' }),
  })
  assert.equal(second.status, 200)
  const two = await second.json()

  assert.equal(two.node, one.node, 'тот же uuid — тот же узел')
  assert.equal(two.name, one.name, 'имя сохраняется при переподключении')
  void code1
})
