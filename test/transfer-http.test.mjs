/**
 * An end-to-end file transfer test over HTTP: a real server, a real stream.
 *
 * This is the test we were missing: the handler called a nonexistent `send`,
 * and the failure was visible only on a live node.
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

/** Issue a command the way the server does before a transfer. */
function issue (method, args) {
  const node = store.nodeByAlias('test-node')
  return queue.enqueue({ nodeId: node.id, api: 1, method, args, timeout: 30 })
}

test('download-file returns the file with its size and the node token', async () => {
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

test('no command gives a 403 with text, no token gives a 401', async () => {
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

test('upload-file accepts the body and verifies the size', async () => {
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

test('the panel and the server agree on the operations route', async () => {
  // admin routes live in connection.fetch and are not mounted in this server,
  // so we check statically: the panel posts to /op and the route must be there
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  assert.match(source, /path: '\/api\/dsh-nodes\/op'/, 'маршрут /op не зарегистрирован — панель получит 404')
})

test('a device event: without a session and text it is a 400, with them it is delivered', async () => {
  const delivered = []
  const services = {
    sessions: { flush: async () => true },
    sessionController: {
      resolveAgent: async (id) => ({
        agent: {
          // an agent stub: we remember exactly what was put into the session
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

test('pairing again with the same uuid reconnects the node instead of making a new one', async () => {
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


test('a button press arrives as a label, not as a machine id', async () => {
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
    // always close the server: an unclosed one held the process and the test hung
    await new Promise((resolve) => srv.close(resolve))
  }
})

test('pipe: a stream without content-length is accepted but waits for the verdict', async () => {
  const { existsSync, readFileSync, rmSync } = await import('node:fs')
  const hostPath = join(dir, 'pipe-test.out')
  rmSync(hostPath, { force: true })
  rmSync(`${hostPath}.inprogress`, { force: true })
  // we issue the command to the same node whose token the request uses
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


test('pipe: a rejection by the verdict removes the temporary file', async () => {
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

test('a forged pendingPath cannot delete a foreign file', async () => {
  const { existsSync, writeFileSync, rmSync } = await import('node:fs')
  const victim = join(dir, 'victim.txt')
  writeFileSync(victim, 'не трогать')
  // the command is an ordinary exec, there was no pipe: the path from the body must be ignored
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
