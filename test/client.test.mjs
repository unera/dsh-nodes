/**
 * Клиентская половина: словари и сборка.
 *
 * Ошибка, которую этот тест ловит, уже случалась: `t()` в панели читал `ru`
 * и `en`, а `i18n.js` к `index.js` подключён не был — сборка проходила, тесты
 * сервера тоже, а в браузере панель настроек падала с `ru is not defined`.
 * Поэтому проверяем не поведение, а связность: каждый ключ есть во всех
 * словарях, и в собранном бандле лежат сами словари и привязка к локали.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { en, ru, zh } from '../src/client/i18n.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/client/index.js'), 'utf8')
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')

const keys = [...new Set([...source.matchAll(/\bt\('([\w.]+)'/g)].map((match) => match[1]))]

test('ключей в панели достаточно много, чтобы проверка была не пустой', () => {
  assert.ok(keys.length > 20, `найдено ключей: ${keys.length}`)
})

test('каждый ключ панели есть во всех трёх словарях', () => {
  for (const [lang, dict] of Object.entries({ en, ru, zh })) {
    const missing = keys.filter((key) => !(key in dict))
    assert.deepEqual(missing, [], `${lang}: нет строк для ${missing.join(', ')}`)
  }
})

test('собранный клиент несёт словари и привязку к локали', () => {
  // маркеры без минификации: сборка идёт с minify: false
  const markers = ['var en = {', 'var ru = {', 'var zh = {', 'locale.register(NS', 'locale.bind(NS)']
  for (const marker of markers) {
    assert.ok(
      bundle.includes(marker),
      `в lib/client.js нет «${marker}» — пересобери клиент: npm run build:client`,
    )
  }
})
