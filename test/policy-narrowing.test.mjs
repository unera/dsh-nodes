/**
 * Who owns a node's permissions: the admin panel, not the client.
 *
 * `PUT /v1/announce` and the admin operations write the same columns (`access`, `base`,
 * `allowEscalation`, `approver`), so one of them has to win. The owner of the machine wins:
 * an announcement may narrow its own rights and never widen them, and what it did not get
 * comes back in `warnings`. The tests below are that rule, on a real server and a real route.
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
import { createNode, updateNode } from '../lib/admin-api.mjs'

let dir
let store
let queue
let server
let base
let config

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-policy-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5 })
  config = {}
  const nodes = createNodesServer({ store, queue, config, log: () => {} })
  server = createServer((req, res) => { void nodes.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

const apis = [{ name: 'shell', version: '1', methods: [{ method: 'exec', args: { type: 'object', properties: {} } }] }]

/** A node the owner has already configured through the admin side. */
function nodeByAdmin (name, body) {
  const created = createNode({ store, queue, config }, { name, ...body })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  return created.body
}

async function announce (token, body) {
  const answer = await fetch(`${base}/v1/announce`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apis, ...body }),
  })
  return { status: answer.status, body: await answer.json() }
}

test('the panel ceiling wins: an announcement cannot widen `access`', async () => {
  const { node, token } = nodeByAdmin('narrow-access', { access: 'ro' })
  const answer = await announce(token, { access: 'full' })
  assert.equal(answer.status, 200, JSON.stringify(answer.body))

  const stored = store.node(node.id)
  assert.equal(stored.access, 'read-only', 'потолок из панели не поднимается объявлением')
  assert.ok(answer.body.warnings.some((line) => /access/.test(line)), 'клиент должен узнать, что ему отказали')
})

test('within the panel ceiling an announcement still has its say', async () => {
  const { node, token } = nodeByAdmin('full-access', { access: 'full' })
  const answer = await announce(token, { access: 'ro' })
  assert.equal(answer.status, 200)
  assert.equal(store.node(node.id).access, 'read-only', 'сузить свои права узел может сам')
  assert.deepEqual(answer.body.warnings, [], 'добровольное сужение — не повод предупреждать')
})

test('a node without an owner value fills the ceiling in itself', async () => {
  // `none` is what a node gets before anybody has said anything about it
  const { node, token } = nodeByAdmin('unset-access', {})
  const answer = await announce(token, { access: 'rw' })
  assert.equal(answer.status, 200)
  assert.equal(store.node(node.id).access, 'workspace-write', 'пока владелец молчит, решает объявление')
})

test('`base` narrows as well, and only down', async () => {
  const { node, token } = nodeByAdmin('start-mode', { access: 'full' })
  const set = updateNode({ store, queue, config }, node.id, { base: 'rw' })
  assert.equal(set.status, 200)

  const wider = await announce(token, { base: 'full' })
  assert.equal(wider.status, 200)
  assert.equal(store.node(node.id).base, 'rw', 'стартовый режим из панели не расширяется')
  assert.ok(wider.body.warnings.some((line) => /base/.test(line)))

  const narrower = await announce(token, { base: 'ro' })
  assert.equal(narrower.status, 200)
  assert.equal(store.node(node.id).base, 'ro', 'сузить стартовый режим можно')
})

test('`allowEscalation: false` is not turned back on by an announcement', async () => {
  const { node, token } = nodeByAdmin('no-questions', { access: 'rw', allowEscalation: false })
  const answer = await announce(token, { allowEscalation: true })
  assert.equal(answer.status, 200)
  assert.equal(store.node(node.id).allow_escalation, 0, 'право спрашивать объявлением не выдаётся')
  assert.ok(answer.body.warnings.some((line) => /allowEscalation/.test(line)))
})

test('`approver: none` survives an announcement that wants questions', async () => {
  const { node, token } = nodeByAdmin('approver-none', { access: 'rw' })
  assert.equal(updateNode({ store, queue, config }, node.id, { approver: 'none' }).status, 200)

  const answer = await announce(token, { approver: 'local' })
  assert.equal(answer.status, 200)
  assert.equal(store.node(node.id).approver, 'none', 'выключенные вопросы объявление не включает')
  assert.ok(answer.body.warnings.some((line) => /approver/.test(line)))

  // the other direction is allowed: the node may give up asking by itself
  const off = await announce(token, { approver: 'none' })
  assert.equal(off.status, 200)
  assert.equal(store.node(node.id).approver, 'none')
})

test('the admin refuses a mode it does not know instead of storing it', async () => {
  const { node } = nodeByAdmin('bad-modes', { access: 'rw' })
  const badBase = updateNode({ store, queue, config }, node.id, { base: 'none' })
  assert.equal(badBase.status, 400)
  assert.match(badBase.body.message, /base/)

  const badAccess = updateNode({ store, queue, config }, node.id, { access: 'everything' })
  assert.equal(badAccess.status, 400)
  assert.match(badAccess.body.message, /access/)

  const badApprover = updateNode({ store, queue, config }, node.id, { approver: 'sudo' })
  assert.equal(badApprover.status, 400)
  assert.match(badApprover.body.message, /approver/)

  // nothing was written by the refusals
  const stored = store.node(node.id)
  assert.equal(stored.access, 'workspace-write')
  assert.equal(stored.base, null)
  assert.equal(stored.approver, null)
})

test('the admin accepts the short spelling of `access` and stores the DSH one', async () => {
  const { node } = nodeByAdmin('short-spelling', {})
  assert.equal(updateNode({ store, queue, config }, node.id, { access: 'full' }).status, 200)
  assert.equal(store.node(node.id).access, 'danger-full-access')
})
