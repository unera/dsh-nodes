/**
 * Transfer limits: which knob bounds what.
 *
 * A file transfer is a stream: it goes to a file, memory stays bounded by the stream
 * itself, and its only ceiling is `maxTransferBytes`. `maxBodyBytes` is about JSON bodies
 * (announce, results, admin calls) and must not touch a stream — a 5 MiB chunked upload
 * has to pass with `maxBodyBytes` set to 64 KiB, otherwise the two limits are mixed up.
 *
 * A chunked body declares no length, so the transfer limit has to work while the body runs:
 * the stream is cut off at the crossing and the `.inprogress` file is removed. A rogue
 * client must not be able to fill the disk by leaving `content-length` out.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'

const KiB = 1024
const MiB = 1024 * KiB

let dir
let store
let queue
let token
// both servers keep the JSON limit tiny, so any leak of it onto the stream shows up at once
const servers = []

/** Start the handler from this repository on a free port — nothing is stubbed. */
async function startServer (config) {
  const nodes = createNodesServer({ store, queue, config, log: () => {} })
  const server = createServer((req, res) => { void nodes.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}/dsh-nodes`
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-limits-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 30 })
  const created = store.createNode({ name: 'limit-node', access: 'workspace-write' })
  token = created.token
  store.announce(created.node.id, [{
    name: 'transfer',
    version: '1',
    methods: [{ method: 'files.download', args: { type: 'object' } }],
  }])
})

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve))
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Issue a command the way the server does before a transfer. */
function issue (method, args) {
  const node = store.nodeByAlias('limit-node')
  return queue.enqueue({ nodeId: node.id, api: 1, method, args, timeout: 30 })
}

/** A body of exactly `total` bytes, sent chunked: no content-length, as a pipe does. */
async function chunkedUpload (base, seq, total) {
  const chunk = Buffer.alloc(64 * KiB, 0x61)
  let sent = 0
  const res = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: new ReadableStream({
      pull (controller) {
        if (sent >= total) {
          controller.close()
          return
        }
        const piece = chunk.subarray(0, Math.min(chunk.length, total - sent))
        sent += piece.length
        controller.enqueue(piece)
      },
    }),
    duplex: 'half',
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body }
}

test('a 5 MiB chunked stream passes while maxBodyBytes is 64 KiB', async () => {
  const base = await startServer({ maxBodyBytes: 64 * KiB })
  const hostPath = join(dir, 'stream-big.out')
  const total = 5 * MiB
  const { seq } = issue('pipeFromDevice', { command: 'tar', hostPath })

  const answer = await chunkedUpload(base, seq, total)
  assert.equal(answer.status, 200, `поток 5 МиБ отвергнут: ${JSON.stringify(answer.body)}`)
  assert.equal(answer.body.bytes, total)
  assert.equal(answer.body.pending, true, 'до вердикта команды файл остаётся .inprogress')
  assert.equal(statSync(`${hostPath}.inprogress`).size, total)

  // the verdict renames the stream: success is a whole file, as for any other transfer
  const closed = await fetch(`${base}/v1/commands/${seq}/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, results: [] }),
  })
  assert.equal(closed.status, 200)
  assert.equal(statSync(hostPath).size, total, 'после успеха файл на месте и целый')
})

test('a JSON route is still refused above maxBodyBytes', async () => {
  const base = await startServer({ maxBodyBytes: 64 * KiB })
  const res = await fetch(`${base}/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: Buffer.alloc(65 * KiB, 0x20),
  })
  assert.equal(res.status, 413)
  const body = await res.json()
  assert.equal(body.code, 'body_too_large')
})

test('a chunked stream over maxTransferBytes is cut off and writes nothing', async () => {
  const limit = 1 * MiB
  const base = await startServer({ maxBodyBytes: 64 * KiB, maxTransferBytes: limit })
  const hostPath = join(dir, 'stream-over.out')
  rmSync(hostPath, { force: true })
  rmSync(`${hostPath}.inprogress`, { force: true })
  const { seq } = issue('pipeFromDevice', { command: 'tar', hostPath })

  const answer = await chunkedUpload(base, seq, 3 * MiB)
  assert.equal(answer.status, 413, `поток сверх предела не отвергнут: ${JSON.stringify(answer.body)}`)
  assert.equal(answer.body.code, 'too_big')
  assert.ok(!existsSync(`${hostPath}.inprogress`), 'кусок сверх предела не остаётся на диске')
  assert.ok(!existsSync(hostPath), 'целевого файла при обрыве быть не должно')
})

test('a declared length over maxTransferBytes is refused before anything is written', async () => {
  const limit = 1 * MiB
  const base = await startServer({ maxTransferBytes: limit })
  const hostPath = join(dir, 'declared-over.bin')
  rmSync(hostPath, { force: true })
  rmSync(`${hostPath}.inprogress`, { force: true })
  const { seq } = issue('copyFromDevice', { command: 'cat', path: '/node/path', hostPath, size: 2 * MiB })

  const res = await fetch(`${base}/v1/upload-file?seq=${seq}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-length': String(2 * MiB),
      'content-type': 'application/octet-stream',
    },
    body: Buffer.alloc(2 * MiB, 0x61),
  })
  assert.equal(res.status, 413)
  const body = await res.json()
  assert.equal(body.code, 'too_big')
  assert.ok(!existsSync(`${hostPath}.inprogress`), 'до записи ничего не создаётся')
  assert.ok(!existsSync(hostPath))
})
