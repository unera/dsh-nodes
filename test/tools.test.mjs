/**
 * The shape of the tools: `render` must return an array of blocks, not one block.
 *
 * We already stumbled on this once on a live server — "content.some is not a function".
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createTools } from '../lib/tools.mjs'

let dir
let store
let queue
let tools

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-tools-'))
  store = new Store(join(dir, 'nodes.sqlite'))
  queue = new Queue({ epoch: store.bumpEpoch(), defaultTimeout: 5 })
  tools = createTools({ store, queue, config: { aliveTimeoutSeconds: 60 }, epoch: queue.epoch })
})

after(() => {
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

const byName = (name) => tools.find((tool) => tool.name === name)

test('every render returns an array of blocks', async () => {
  // four tools for working with nodes plus notifications; there is no separate
  // file transfer tool — that is a method of the file API
  assert.deepEqual(tools.map((tool) => tool.name).sort(),
    ['nodes_api', 'nodes_call', 'nodes_catalog', 'nodes_list', 'nodes_notify'])
  assert.equal(tools.length, 5)
  for (const tool of tools) {
    assert.equal(typeof tool.output.render, 'function', `${tool.name}: нет render`)
    const value = await tool.execute({ node: 1, api: 1, method: 'exec', data: {} }, { agent: null })
    const blocks = tool.output.render({}, value)
    assert.ok(Array.isArray(blocks), `${tool.name}.render должен вернуть массив`)
    assert.ok(blocks.length >= 1, `${tool.name}.render вернул пустой массив`)
    for (const block of blocks) {
      assert.equal(block.type, 'text', `${tool.name}: блок должен быть текстовым`)
      assert.equal(typeof block.text, 'string')
    }
  }
})

test('nodes_list without nodes says so in words', () => {
  const value = { nodes: [], epoch: 1 }
  const [block] = byName('nodes_list').output.render({}, value)
  assert.match(block.text, /узлов нет/)
})

test('nodes_catalog on an empty catalog explains why it is empty', () => {
  const [block] = byName('nodes_catalog').output.render({}, { apis: [] })
  assert.match(block.text, /справочник пуст/)
})

test('nodes_call renders the status and the result text', () => {
  const [ok] = byName('nodes_call').output.render({}, {
    status: 'ok',
    results: [{ type: 'text', text: 'привет' }],
  })
  assert.match(ok.text, /привет/)

  const [bad] = byName('nodes_call').output.render({}, {
    status: 'error',
    code: 'bad_args',
    message: 'bad args: command обязателен',
  })
  assert.match(bad.text, /bad_args/)
  assert.match(bad.text, /command обязателен/)
})

test('nodes render with an alias, freshness and access', () => {
  const [block] = byName('nodes_list').output.render({}, {
    nodes: [{ id: 1, aliases: ['nbw'], online: true, lastSeen: Date.now(), apis: [3], access: 'none' }],
  })
  assert.match(block.text, /1 — nbw \(online\)/)
  assert.match(block.text, /apis: 3/)
})

test('nodes_call accepts both a number and an alias', async () => {
  const node = store.createNode({ name: 'nbw' }).node
  const apiId = store.announce(node.id, [{
    name: 'bash',
    version: '1',
    methods: [{ method: 'exec', args: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
  }]).apis[0]
  const call = byName('nodes_call')

  const byAlias = await call.execute({ node: 'nbw', api: apiId, method: 'nope' }, { agent: null })
  assert.equal(byAlias.code, 'unknown_method')
  const byNumber = await call.execute({ node: node.id, api: apiId, method: 'nope' }, { agent: null })
  assert.equal(byNumber.code, 'unknown_method')
  const byDigitString = await call.execute({ node: String(node.id), api: apiId, method: 'nope' }, { agent: null })
  assert.equal(byDigitString.code, 'unknown_method', 'число строкой тоже должно адресовать узел')
})

test('the copy chunk fits into the result body limit', async () => {
  const { DEFAULT_CHUNK } = await import('../lib/copy.mjs')
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../lib/server.mjs', import.meta.url), 'utf8')
  const maxBody = Number(/maxBodyBytes \?\? ([0-9* ]+)/.exec(source)?.[1]?.trim().replace(/\s/g, '').split('*').reduce((a, b) => Number(a) * Number(b), 1) ?? 0)
  assert.ok(DEFAULT_CHUNK * 1.4 < maxBody, `кусок ${DEFAULT_CHUNK} с base64 не влезает в ${maxBody}`)
})

test('full requested without strict: the mode goes to the node as is, no question is asked', async () => {
  const { node } = store.createNode({ name: 'rw-node', access: 'danger-full-access', allowEscalation: 1 })
  store.announce(node.id, [{ name: 'shell', version: '1', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const api = { id: store.nodeApis(node.id)[0] }

  // a spy queue: we remember exactly what went to the node and answer with success at once
  const sent = []
  const spyQueue = {
    epoch: queue.epoch,
    enqueue (command) {
      sent.push(command)
      return { seq: sent.length, promise: Promise.resolve({ status: 'ok', code: 0, results: [] }) }
    },
    cancel () {},
  }
  const localTools = createTools({
    store, queue: spyQueue, config: { aliveTimeoutSeconds: 60 }, epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'rw' }),
  })
  const call = localTools.find((tool) => tool.name === 'nodes_call')
  await call.execute({ node: node.id, api: api.id, method: 'exec', data: {}, sandbox: 'full' }, {})

  assert.equal(sent.length, 1, 'должна уйти ровно одна команда')
  assert.equal(sent[0].method, 'exec')
  // the server passes the requested mode as is: narrowing to the starting mode is
  // the node's job (it looks at approved: without it the mode narrows to base)
  assert.equal(sent[0].sandbox.mode, 'danger-full-access')
  assert.equal(sent[0].approved ?? null, null, 'без strict согласия нет, значит узел сузит режим')
  // and there is no approval: the kernel never denied anything, so there is nothing to escalate
  assert.equal(sent.filter((command) => command.method === 'approve').length, 0)
})

test('a control command: no waiting, a daily timeout, api -1', async () => {
  const { CONTROL_API } = await import('../lib/queue.mjs')
  const created = store.createNode({ name: 'ctrl-node' })
  const nodeId = created.node.id
  const seq = queue.control(nodeId, '#INTERNAL.CANCEL', { seq: 7, reason: 'timeout' })
  assert.ok(seq, 'команда должна получить номер')
  const issued = queue.issued(nodeId, seq)
  assert.equal(issued.api, CONTROL_API, 'служебные команды идут под псевдо-API -1')
  assert.equal(issued.method, '#INTERNAL.CANCEL')
  assert.deepEqual(issued.args, { seq: 7, reason: 'timeout' })
  assert.equal(issued.timeout, 86_400, 'сутки, а не обычный таймаут')
})

test('a client cannot announce a service method with a hash', () => {
  const created = store.createNode({ name: 'reserved-node' })
  const answer = store.announce(created.node.id, [{
    name: 'shell',
    version: 'x',
    methods: [{ method: '#INTERNAL.CANCEL', args: { type: 'object' } }, { method: 'exec', args: { type: 'object' } }],
  }])
  const def = store.api(answer.apis[0])
  const names = (def.methods ?? []).map((m) => m.method)
  assert.ok(!names.includes('#INTERNAL.CANCEL'), 'служебное имя не должно попасть в объявление')
  assert.ok(names.includes('exec'), 'обычные методы остаются')
  assert.match(answer.warnings.join(' '), /зарезервированы/)
})

test('a failure inside the announce transaction rolls the node fields back too', () => {
  // the server refuses everything it can check before the transaction; this is the last
  // line: the node patch goes into the same BEGIN as the apis and the bindings, so a
  // failure while binding the rules must leave the node exactly as it was
  const created = store.createNode({ name: 'rollback-node', access: 'read-only' })
  const before = store.node(created.node.id)
  assert.throws(
    () => store.announce(
      created.node.id,
      [{ name: 'shell', version: 'r1', methods: [{ method: 'exec', args: { type: 'object' } }] }],
      // no such api in the declaration: the transaction throws while writing the rules
      [{ api: 'ghost', version: null, method: 'exec', rule: 'timing', opts: null }],
      { access: 'danger-full-access', platform: 'android', client_epoch: 3, workdir: '/tmp/x' },
    ),
    (error) => error.code === 'apply-rules-invalid',
  )
  const after = store.node(created.node.id)
  assert.equal(after.access, 'read-only', 'потолок прав откатывается вместе с транзакцией')
  assert.equal(after.platform, null, 'platform откатывается вместе с транзакцией')
  assert.equal(after.client_epoch, null, 'поколение клиента откатывается вместе с транзакцией')
  assert.equal(after.workdir, before.workdir)
  assert.deepEqual(store.nodeApis(created.node.id), [], 'apis не записались')
  assert.deepEqual(store.nodeRules(created.node.id), [], 'биндинги не записались')
})

test('the flushAround rule reaches the queue as barriers', async () => {
  const { node } = store.createNode({ name: 'flush-node', access: 'danger-full-access' })
  store.announce(node.id, [{
    name: 'session',
    version: '9',
    methods: [
      { method: 'chdir', args: { type: 'object' } },
      { method: 'cwd', args: { type: 'object' } },
    ],
  }])
  const api = { id: store.nodeApis(node.id)[0] }
  // the rule arrives as a separate list: it is not inside apidef
  store.setNodeRules(node.id, [{ apiId: api.id, method: 'chdir', rule: 'flushAround' }])

  const sent = []
  const spyQueue = {
    epoch: queue.epoch,
    enqueue (command) {
      sent.push(command)
      return { seq: sent.length, promise: Promise.resolve({ status: 'ok', code: 0, results: [] }) }
    },
    cancel () {},
  }
  const localTools = createTools({
    store, queue: spyQueue, config: { aliveTimeoutSeconds: 60 }, epoch: queue.epoch,
    sandboxFor: () => ({ mode: 'rw' }),
  })
  const call = localTools.find((tool) => tool.name === 'nodes_call')
  await call.execute({ node: node.id, api: api.id, method: 'chdir', data: { path: '/tmp' } }, {})
  await call.execute({ node: node.id, api: api.id, method: 'cwd', data: {} }, {})

  const chdir = sent.find((command) => command.method === 'chdir')
  assert.equal(chdir.flushBefore, true, 'chdir обязан дождаться пула до себя')
  assert.equal(chdir.flushAfter, true, 'и не пускать за собой ничего, пока не применится')
  assert.equal(chdir.rule, 'flushAround')
  const cwd = sent.find((command) => command.method === 'cwd')
  assert.equal(cwd.flushBefore, false, 'метод без привязки барьеров не просит')
  assert.equal(cwd.flushAfter, false)
  assert.equal(cwd.rule, null)
})

test('the rule lives on the node, not in the API declaration', () => {
  const { node } = store.createNode({ name: 'rule-node' })
  store.announce(node.id, [{ name: 'session', version: '1', methods: [{ method: 'ping', args: { type: 'object' } }] }])
  const apiId = store.nodeApis(node.id)[0]
  assert.equal(store.nodeRule(node.id, apiId, 'ping'), null, 'без привязки правила нет')
  store.setNodeRules(node.id, [{ apiId, method: 'ping', rule: 'timing', opts: { retNames: { durationMs: 'took' } } }])
  assert.deepEqual(store.nodeRule(node.id, apiId, 'ping'), { rule: 'timing', opts: { retNames: { durationMs: 'took' } } })
  // the binding is replaced as a whole: the old one must not survive
  store.setNodeRules(node.id, [{ apiId, method: 'ping', rule: 'flushBefore' }])
  assert.deepEqual(store.nodeRule(node.id, apiId, 'ping'), { rule: 'flushBefore', opts: null })
})

function timingOutcome ({ startedAt = 1000, finishedAt = 1250.5, nodeNow = 5000.25 } = {}) {
  return {
    status: 'ok',
    internal: { rule: 'timing', ruleState: { startedAt, finishedAt }, nodeNow },
    results: [{ type: 'text', text: JSON.stringify({ pong: 1 }) }],
  }
}

test('timing rule: the server measures the duration, the offset comes from the node clock', async () => {
  const { annotateTiming } = await import('../lib/tools.mjs')
  const filled = annotateTiming(timingOutcome(), { opts: { retNames: { durationMs: 'took', clockSkewMs: 'skew' } } })
  const payload = JSON.parse(filled.results[0].text)
  assert.equal(payload.took, 250.5, 'длительность — по отметкам сервера, узел тут не нужен')
  assert.equal(payload.skew, 3749.75, 'смещение — часы узла минус момент ответа')
  assert.equal(payload.pong, 1, 'остальное в ответе не трогаем')
  assert.equal('startedAt' in payload, false, 'внутренние отметки правила наружу не идут')
  assert.equal('finishedAt' in payload, false)
})

test('timing rule: without the node clock the offset is not invented', async () => {
  const { annotateTiming } = await import('../lib/tools.mjs')
  const outcome = timingOutcome({ nodeNow: null })
  const filled = annotateTiming(outcome, { opts: { retNames: { durationMs: 'took', clockSkewMs: 'skew' } } })
  const payload = JSON.parse(filled.results[0].text)
  assert.equal(payload.took, 250.5, 'длительность считается всегда')
  assert.equal('skew' in payload, false, 'без часов узла смещение не вычисляется')
})

test('timing rule: an empty retNames means measure and store nowhere', async () => {
  const { annotateTiming } = await import('../lib/tools.mjs')
  const outcome = timingOutcome()
  assert.deepEqual(annotateTiming(outcome, { opts: null }).results, outcome.results)
  // the leftover of the rule (internal) still does not leak out — nodes_call does that
})


test('timing rule does not crash when there is nothing to measure', async () => {
  const { annotateTiming } = await import('../lib/tools.mjs')
  const logged = []
  const log = (level, event, details) => logged.push({ level, event, details })
  const opts = { retNames: { durationMs: 'durationMs', clockSkewMs: 'clockSkewMs' } }

  // 1. no rule timestamps: the command bypassed the queue with the rule
  const noState = { status: 'ok', results: [{ type: 'text', text: '{"a":1}' }] }
  assert.deepEqual(annotateTiming(noState, { opts, log }), noState)
  // 2. the answer is not a JSON object: there is nowhere to put the measurement
  const notJson = { status: 'ok', internal: { ruleState: { startedAt: 1, finishedAt: 2 } }, results: [{ type: 'text', text: 'просто вывод' }] }
  assert.deepEqual(annotateTiming(notJson, { opts, log }), notJson)
  assert.equal(logged.length, 2, 'обе беды должны быть слышны')
  for (const entry of logged) {
    assert.equal(entry.level, 'error')
    assert.equal(entry.event, 'special-rule-violated')
    assert.equal(entry.details.rule, 'timing')
  }
  // 3. the node sent no clock — that is not an error: the offset is simply not computed
  const noClock = timingOutcome({ nodeNow: null })
  assert.equal(annotateTiming(noClock, { opts, log }).results.length, 1)
  assert.equal(logged.length, 2, 'отсутствие now — не повод ругаться')
})

test('timing rule stores only what was requested', async () => {
  const { annotateTiming } = await import('../lib/tools.mjs')
  const filled = annotateTiming(timingOutcome(), { opts: { retNames: { durationMs: 'took' } } })
  const payload = JSON.parse(filled.results[0].text)
  assert.equal(typeof payload.took, 'number')
  assert.equal('clockSkewMs' in payload, false, 'не просили — не кладём')
  assert.equal('durationMs' in payload, false, 'кладём под именем из retNames, а не под канонным')
})
