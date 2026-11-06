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
  assert.equal(tools.length, 4)
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
