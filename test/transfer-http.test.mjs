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


test('нажатие кнопки приходит подписью, а не машинным номером', async () => {
  const delivered = []
  const services = {
    sessions: { flush: async () => true },
    sessionController: {
      resolveAgent: async (id) => ({
        agent: { session: { id }, followup: (message) => delivered.push(message) },
      }),
    },
  }
  const local = createNodesServer({ store, queue, config: {}, log: () => {}, services })
  const srv = createServer((req, res) => { void local.handle(req, res) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${srv.address().port}/dsh-nodes`

  const node = store.createNode({ name: 'phone-press' }).node
  const api = store.announce(node.id, [{
    name: 'notifications',
    version: 'android-test',
    methods: [{ method: 'post', args: { type: 'object' } }],
  }])
  store.createNotification({
    id: 'n-test',
    node: node.id,
    session: 'session-x',
    purpose: 'проверка кнопок',
    title: 'Перезагрузить?',
    text: 'текст',
    buttons: [{ id: 'b1', label: 'да' }, { id: 'b2', label: 'нет' }],
  })
  void api

  try {
    const answer = await fetch(`${origin}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ notification: 'n-test', button: 'b1', text: 'нажата кнопка' }),
    })
    assert.equal(answer.status, 200)
    const message = delivered[0].content[0].text
    assert.match(message, /кнопка «да»/, 'должна быть подпись кнопки, а не b1')
    assert.match(message, /проверка кнопок/, 'смысл берётся из записи сервера')
    assert.ok(!/b1/.test(message), 'машинный номер человеку не показываем')
  } finally {
    // сервер закрываем всегда: незакрытый держал процесс и тест «висел»
    await new Promise((resolve) => srv.close(resolve))
  }
})

test('пайп: поток без content-length принимается, но ждёт вердикта', async () => {
  const { existsSync, readFileSync, rmSync } = await import('node:fs')
  const hostPath = join(dir, 'pipe-test.out')
  rmSync(hostPath, { force: true })
  rmSync(`${hostPath}.inprogress`, { force: true })
  // команду выдаём тому же узлу, чей токен используется в запросе
  const { seq } = issue('pipeFromDevice', { command: 'echo', hostPath })
  const logs = []
  try {
    const answer = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new ReadableStream({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('строка из скрипта'))
          controller.close()
        },
      }),
      duplex: 'half',
    })
    assert.equal(answer.status, 200)
    const body = await answer.json()
    assert.equal(body.pending, true, 'поток не финализируется до вердикта')
    assert.ok(existsSync(`${hostPath}.inprogress`), 'данные лежат во временном файле')
    assert.ok(!existsSync(hostPath), 'целевой файл ещё не создан')

    const closed = await fetch(`${base}/v1/commands/${seq}/result`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, pendingPath: `${hostPath}.inprogress`, results: [] }),
    })
    assert.equal(closed.status, 200, `закрытие команды: ${closed.status} ${await closed.text()}`)
    assert.ok(existsSync(hostPath), 'после успеха файл на месте')
    assert.match(readFileSync(hostPath, 'utf8'), /строка из скрипта/)
    assert.ok(!existsSync(`${hostPath}.inprogress`), 'временный файл убран')
  } finally {
    rmSync(hostPath, { force: true })
    rmSync(`${hostPath}.inprogress`, { force: true })
  }
})


test('пайп: отказ по вердикту удаляет временный файл', async () => {
  const { existsSync, rmSync, writeFileSync } = await import('node:fs')
  const hostPath = join(dir, 'pipe-fail.out')
  rmSync(hostPath, { force: true })
  const { seq } = issue('pipeFromDevice', { command: 'false', hostPath })
  try {
    const answer = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new ReadableStream({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('частичный вывод'))
          controller.close()
        },
      }),
      duplex: 'half',
    })
    assert.equal(answer.status, 200)
    assert.ok(existsSync(`${hostPath}.inprogress`), 'пока вердикта нет, данные лежат')

    const closed = await fetch(`${base}/v1/commands/${seq}/result`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, code: 'exit_nonzero', pendingPath: `${hostPath}.inprogress`, results: [] }),
    })
    assert.equal(closed.status, 200)
    assert.ok(!existsSync(`${hostPath}.inprogress`), 'при отказе временный файл удалён')
    assert.ok(!existsSync(hostPath), 'целевого файла при отказе быть не должно')
  } finally {
    rmSync(hostPath, { force: true })
    rmSync(`${hostPath}.inprogress`, { force: true })
  }
})

test('поддельный pendingPath не может удалить чужой файл', async () => {
  const { existsSync, writeFileSync, rmSync } = await import('node:fs')
  const victim = join(dir, 'victim.txt')
  writeFileSync(victim, 'не трогать')
  // команда обычная (exec), пайпа не было: путь из тела должен игнорироваться
  const { seq } = issue('exec', { command: 'true' })
  try {
    const closed = await fetch(`${base}/v1/commands/${seq}/result`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, pendingPath: victim, results: [] }),
    })
    assert.equal(closed.status, 200)
    assert.ok(existsSync(victim), 'файл не должен быть удалён по пути из тела')
  } finally {
    rmSync(victim, { force: true })
  }
})
