import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PROMPT_TEXT, SECTION_NAME, SECTION_ORDER } from '../lib/prompt.mjs'

test('секция промпта на месте и короткая', () => {
  assert.equal(SECTION_NAME, 'dsh-nodes')
  assert.ok(SECTION_ORDER > 0)
  assert.ok(PROMPT_TEXT.length > 500, 'иначе модель не поймёт, что это за тулы')
  assert.ok(PROMPT_TEXT.length < 3000, 'промпт не должен съедать контекст сам по себе')
})

test('в промпте есть правила, без которых модель ошибётся', () => {
  for (const needle of [
    'nodes_list',
    'nodes_catalog',
    'nodes_api',
    'nodes_call',
    'алиас',
    'timeout',
    'sandbox_denied',
  ]) {
    assert.match(PROMPT_TEXT.toLowerCase(), new RegExp(needle.toLowerCase()))
  }
})

test('промпт не обещает отмены на узле', () => {
  assert.match(PROMPT_TEXT, /Отмены на узле нет/)
})
