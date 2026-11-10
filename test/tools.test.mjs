/**
 * Форма тулов: `render` обязан вернуть массив блоков, а не один блок.
 * На этом уже один раз спотыкались на живом сервере — «content.some is not a function».
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

test('каждый render возвращает массив блоков', async () => {
  // четыре инструмента работы с узлами плюс уведомления; передачи файлов
  // отдельным инструментом нет — это метод файлового API
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

test('nodes_list без узлов говорит об этом словами', () => {
  const value = { nodes: [], epoch: 1 }
  const [block] = byName('nodes_list').output.render({}, value)
  assert.match(block.text, /узлов нет/)
})

test('nodes_catalog на пустом справочнике объясняет, почему пусто', () => {
  const [block] = byName('nodes_catalog').output.render({}, { apis: [] })
  assert.match(block.text, /справочник пуст/)
})

test('nodes_call рендерит статус и текст результата', () => {
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

test('узлы рендерятся с алиасом, свежестью и доступом', () => {
  const [block] = byName('nodes_list').output.render({}, {
    nodes: [{ id: 1, aliases: ['nbw'], online: true, lastSeen: Date.now(), apis: [3], access: 'none' }],
  })
  assert.match(block.text, /1 — nbw \(online\)/)
  assert.match(block.text, /apis: 3/)
})

test('nodes_call принимает и номер, и алиас', async () => {
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

test('кусок копирования влезает в предел тела результата', async () => {
  const { DEFAULT_CHUNK } = await import('../lib/copy.mjs')
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../lib/server.mjs', import.meta.url), 'utf8')
  const maxBody = Number(/maxBodyBytes \?\? ([0-9* ]+)/.exec(source)?.[1]?.trim().replace(/\s/g, '').split('*').reduce((a, b) => Number(a) * Number(b), 1) ?? 0)
  assert.ok(DEFAULT_CHUNK * 1.4 < maxBody, `кусок ${DEFAULT_CHUNK} с base64 не влезает в ${maxBody}`)
})

test('просили full без strict: режим уходит узлу как есть, вопроса нет', async () => {
  const { node } = store.createNode({ name: 'rw-node', access: 'danger-full-access', allowEscalation: 1 })
  store.announce(node.id, [{ name: 'shell', version: '1', methods: [{ method: 'exec', args: { type: 'object' } }] }])
  const api = { id: store.nodeApis(node.id)[0] }

  // очередь-шпион: запоминаем, что именно ушло узлу, и отвечаем успехом сразу
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
  // сервер передаёт запрошенный режим как есть: понижение до стартового — дело
  // узла (он смотрит на approved: без него режим сужается до base)
  assert.equal(sent[0].sandbox.mode, 'danger-full-access')
  assert.equal(sent[0].approved ?? null, null, 'без strict согласия нет, значит узел сузит режим')
  // и апрува нет: отказ ядра не наступал, поднимать не из чего
  assert.equal(sent.filter((command) => command.method === 'approve').length, 0)
})

test('управляющая команда: без ожидания, с суточным сроком, api -1', async () => {
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

test('клиент не может объявить служебный метод с решёткой', () => {
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
