/**
 * A pipe that never gets a verdict must not leave garbage behind.
 *
 * `pipeFromDevice` writes its output to `<hostPath>.inprogress` and the verdict of the command
 * is what renames or removes it. When the node disappears mid-stream, that verdict never
 * arrives: the queue closes the command as `lost` (or as `expired`, or on a node restart) and
 * only the cleanup keeps the disk and the server's own map from growing. This is the leak the
 * test catches: up to `maxTransferBytes` per lost pipe, and one map entry per pipe for the
 * lifetime of the process.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'
import { receive } from '../lib/transfer.mjs'

let dir
let store
let queue
let nodes
let server
let base
let token
let nodeId
const logs = []

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-pipe-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  // a short TTL keeps the expiry scenario cheap; the grace for a lost command is 30 s
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5, commandTtl: 1 })
  nodes = createNodesServer({
    store,
    queue,
    config: { maxTransferBytes: 1024 * 1024 },
    log: (level, message, extra) => logs.push({ level, message, ...extra }),
  })
  server = createServer((req, res) => { void nodes.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
  const created = store.createNode({ name: 'pipe-node', access: 'workspace-write' })
  token = created.token
  nodeId = created.node.id
  store.announce(nodeId, [{ name: 'shell', version: '1', methods: [{ method: 'pipeFromDevice', args: { type: 'object' } }] }])
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Issue a pipe command; the node will never answer it. */
function issuePipe (name) {
  const hostPath = join(dir, name)
  rmSync(hostPath, { force: true })
  rmSync(`${hostPath}.inprogress`, { force: true })
  const { seq } = queue.enqueue({
    nodeId,
    api: 1,
    method: 'pipeFromDevice',
    args: { command: 'echo', hostPath },
    hostRoots: [dir],
    timeout: 5,
  })
  return { seq, hostPath, part: `${hostPath}.inprogress` }
}

/** Push a chunked body the way a device does: no content-length, so the file stays pending. */
async function pushStream (seq) {
  const answer = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: new ReadableStream({
      start (controller) {
        controller.enqueue(new TextEncoder().encode('часть вывода, которой не будет конца'))
        controller.close()
      },
    }),
    duplex: 'half',
  })
  assert.equal(answer.status, 200)
  const body = await answer.json()
  assert.equal(body.pending, true, 'поток не финализируется до вердикта команды')
}

test('a pipe lost mid-stream leaves no file and no map entry', async () => {
  const { seq, hostPath, part } = issuePipe('lost.out')
  await pushStream(seq)
  assert.ok(existsSync(part), 'пока вердикта нет, данные лежат во временном файле')
  assert.equal(nodes.pendingPipes.size, 1, 'карта помнит незакрытый поток')

  // the node took the command and went away: the batch marks it `processing`
  queue.take(nodeId)
  const removed = queue.sweep(Date.now() + (5 + 30) * 1000 + 1000)
  assert.equal(removed, 1, 'команда должна быть закрыта как потерянная')

  assert.equal(existsSync(part), false, 'временный файл обязан исчезнуть')
  assert.equal(existsSync(hostPath), false, 'целевого файла при потере быть не должно')
  assert.equal(nodes.pendingPipes.size, 0, 'запись в карте обязана исчезнуть')
  assert.ok(logs.some((line) => line.message === 'pipe-abandoned' && line.code === 'lost'),
    'в журнале — строка pipe-abandoned с причиной lost')
})

test('a pipe command that expires unissued is cleaned up too', async () => {
  const { seq, hostPath, part } = issuePipe('expired.out')
  await pushStream(seq)
  assert.equal(nodes.pendingPipes.size, 1)

  // commandTtl is one second: nobody took the command, so it ages out
  const removed = queue.sweep(Date.now() + 2 * 1000)
  assert.equal(removed, 1)

  assert.equal(existsSync(part), false, 'по commandTtl временный файл тоже убирается')
  assert.equal(existsSync(hostPath), false)
  assert.equal(nodes.pendingPipes.size, 0)
  assert.ok(logs.some((line) => line.message === 'pipe-abandoned' && line.code === 'expired'))
})

test('a node restart closes the pending pipe and removes its file', async () => {
  const { seq, hostPath, part } = issuePipe('restarted.out')
  await pushStream(seq)
  queue.take(nodeId)
  assert.equal(nodes.pendingPipes.size, 1)

  const lost = queue.failInFlight(nodeId, 'node_restarted')
  assert.equal(lost, 1)

  assert.equal(existsSync(part), false)
  assert.equal(existsSync(hostPath), false)
  assert.equal(nodes.pendingPipes.size, 0)
  assert.ok(logs.some((line) => line.message === 'pipe-abandoned' && line.code === 'node_restarted'))
})

test('a late verdict for a lost pipe does not resurrect the file', async () => {
  const { seq, hostPath, part } = issuePipe('late.out')
  await pushStream(seq)
  queue.take(nodeId)
  queue.sweep(Date.now() + (5 + 30) * 1000 + 1000)
  assert.equal(existsSync(part), false)

  // the node wakes up after all and reports success: the command is closed, nothing to finish
  const late = await fetch(`${base}/v1/commands/${seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, pendingPath: part, results: [] }),
  })
  assert.equal(late.status, 409, 'закрытая команда принимает только поздний отказ')
  assert.equal(existsSync(hostPath), false)
  assert.equal(existsSync(part), false)
})

test('a pipe with a verdict still finishes: the cleanup must not eat the result', async () => {
  const { seq, hostPath, part } = issuePipe('finished.out')
  await pushStream(seq)
  assert.equal(nodes.pendingPipes.size, 1)

  const closed = await fetch(`${base}/v1/commands/${seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [] }),
  })
  assert.equal(closed.status, 200)
  assert.match(readFileSync(hostPath, 'utf8'), /часть вывода/)
  assert.equal(existsSync(part), false)
  assert.equal(nodes.pendingPipes.size, 0)

  // and a sweep after the fact does not touch a finished file
  queue.sweep(Date.now() + 10 * 60 * 1000)
  assert.ok(existsSync(hostPath), 'готовый файл свип не трогает')
})

/**
 * A request body that can be fed by the test: the timing of the race matters, and a real
 * socket would make it depend on how the client buffers.
 */
function fakeRequest (url, token, chunks, afterFirstChunk) {
  const stream = new Readable({ read () {} })
  stream.url = url
  stream.method = 'POST'
  stream.headers = { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }
  setImmediate(async () => {
    stream.push(Buffer.from(chunks[0]))
    // the pipeline starts reading only after the server opened the file for writing, so the
    // callback below runs with the temporary file already on disk
    await afterFirstChunk()
    setImmediate(() => {
      stream.push(Buffer.from(chunks[1]))
      stream.push(null)
    })
  })
  return stream
}

/** Wait until the server has created the temporary file, or give up after a second. */
async function waitForFile (path) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(path)) return true
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return false
}

/** A response object that only remembers what was written. */
function fakeResponse () {
  const res = { status: 0, headers: {}, text: '' }
  res.writeHead = (status, headers = {}) => { res.status = status; Object.assign(res.headers, headers) }
  res.end = (chunk) => { res.text = chunk ? String(chunk) : '' }
  res.on = () => {}
  return res
}

test('a command closed while the body is on its way stores nothing', async () => {
  const { seq, hostPath, part } = issuePipe('closed-midway.out')
  queue.take(nodeId)
  const res = fakeResponse()
  const req = fakeRequest(`/dsh-nodes/v1/upload-file?seq=${seq}`, token, ['первый кусок', 'второй кусок'], () => {
    // the node answered the command while the body was still arriving: there is no verdict
    // to come for this pipe any more
    assert.equal(queue.close(nodeId, seq, { ok: true, results: [] }), 'closed')
  })
  await nodes.handle(req, res)

  assert.equal(res.status, 409, `ожидался отказ, а не ${res.status}: ${res.text}`)
  assert.equal(JSON.parse(res.text).code, 'command_closed')
  assert.equal(existsSync(part), false, 'принятый файл не остаётся на диске')
  assert.equal(existsSync(hostPath), false)
  assert.equal(nodes.pendingPipes.size, 0, 'в карте ничего не оседает')
})

test('a pipe removed from under the transfer answers 409 pipe_gone, not 500', async () => {
  const { hostPath, part } = issuePipe('vanished.out')
  // the cleanup of a cancelled command removes the file while the stream is open: `receive`
  // must say so, not crash with ENOENT
  const req = fakeRequest(`/dsh-nodes/v1/upload-file?seq=1`, token, ['первый кусок', 'второй кусок'], async () => {
    assert.equal(await waitForFile(part), true, 'сервер должен был создать временный файл')
    rmSync(part, { force: true })
  })
  await assert.rejects(
    () => receive({
      stream: req,
      headers: req.headers,
      command: { method: 'pipeFromDevice', args: { hostPath }, hostRoots: [dir] },
      mode: null,
      config: { maxTransferBytes: 1024 * 1024 },
    }),
    (error) => {
      assert.equal(error.status, 409, `ожидался 409, а не ${error.status}`)
      assert.equal(error.code, 'pipe_gone')
      return true
    },
  )
  assert.equal(existsSync(part), false)
})
