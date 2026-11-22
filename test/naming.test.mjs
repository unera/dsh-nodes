/**
 * The node's naming over HTTP: downloading and uploading its name and aliases.
 *
 * The phone keeps its own copy of the naming and changes it locally; these two routes are the
 * only way the copies meet, so what is checked here is the contract: the name is always an
 * alias, the list is a full replacement, another node's alias is reported instead of written,
 * and another node's name is a flat refusal.
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

let dir
let store
let queue
let server
let base
let token
let otherToken

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-naming-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 30 })
  const nodes = createNodesServer({ store, queue, config: {}, log: () => {} })
  server = createServer((req, res) => { void nodes.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
  token = store.createNode({ name: 'phone', access: 'danger-full-access' }).token
  otherToken = store.createNode({ name: 'laptop', access: 'danger-full-access' }).token
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

async function read (bearer = token) {
  const res = await fetch(`${base}/v1/naming`, { headers: { authorization: `Bearer ${bearer}` } })
  return { status: res.status, body: await res.json() }
}

async function write (body, bearer = token) {
  const res = await fetch(`${base}/v1/naming`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

test('the naming is read: the name and its aliases, the name included', async () => {
  const answer = await read()
  assert.equal(answer.status, 200)
  assert.equal(answer.body.name, 'phone')
  assert.deepEqual(answer.body.aliases, ['phone'])
  assert.equal(answer.body.node, 1)
})

test('without a token there is no naming', async () => {
  const res = await fetch(`${base}/v1/naming`)
  assert.equal(res.status, 401)
})

test('aliases are a full list: what is not in it goes away', async () => {
  const added = await write({ aliases: ['phone', 'трубка', 'карман'] })
  assert.equal(added.status, 200)
  assert.deepEqual(added.body.aliases.sort(), ['карман', 'трубка', 'phone'].sort())
  assert.deepEqual(added.body.rejected, [])

  const trimmed = await write({ aliases: ['карман'] })
  assert.equal(trimmed.status, 200)
  // the name is added back by the server: a node you cannot call by name is a trap
  assert.deepEqual(trimmed.body.aliases.sort(), ['карман', 'phone'].sort())
})

test('another node\'s alias is reported, not written', async () => {
  const answer = await write({ aliases: ['phone', 'laptop'] })
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body.rejected, ['laptop'])
  assert.equal(store.nodeByAlias('laptop').id, 2)
  assert.deepEqual(store.aliases(1).sort(), ['phone'].sort())
})

test('a rename moves the alias with it', async () => {
  const answer = await write({ name: 'телефон' })
  assert.equal(answer.status, 200)
  assert.equal(answer.body.name, 'телефон')
  assert.ok(answer.body.aliases.includes('телефон'))
  assert.ok(!answer.body.aliases.includes('phone'))
  assert.equal(store.nodeByAlias('телефон').id, 1)
  assert.equal(store.nodeByAlias('phone'), null)
})

test('a name held by another node is a flat refusal', async () => {
  const answer = await write({ name: 'laptop' })
  assert.equal(answer.status, 409)
  assert.equal(answer.body.code, 'alias_taken')
  assert.equal(store.node(1).name, 'телефон')
})

test('an empty name and an unknown key are refused', async () => {
  assert.equal((await write({ name: '   ' })).status, 400)
  assert.equal((await write({ aliases: 'телефон' })).status, 400)
  const unknown = await write({ name: 'ok', events_enabled: false })
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.message, /events_enabled/)
  // nothing was applied by the refused body
  assert.equal(store.node(1).name, 'телефон')
})

test('the naming belongs to the node that asked: another token edits its own', async () => {
  const mine = await read(otherToken)
  assert.equal(mine.body.name, 'laptop')
  const changed = await write({ aliases: ['laptop', 'ноут'] }, otherToken)
  assert.equal(changed.body.name, 'laptop')
  assert.deepEqual(store.aliases(1).sort(), ['телефон'].sort())
})
