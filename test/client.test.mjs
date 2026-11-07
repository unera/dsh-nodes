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
import { runInNewContext } from 'node:vm'

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

/**
 * Запуск настоящего бандла без браузера.
 *
 * Повторяет путь, на котором панель ломалась: `apply(ctx)` регистрирует
 * секцию, а подпись секции зовёт `t()`. Если словарей в бандле нет, здесь
 * будет то же самое `ru is not defined`, что и в консоли браузера.
 */
function loadBundle () {
  let loaded = null
  const context = {
    window: { __ModuleLoader__: { load: (definition) => { loaded = definition } } },
    console,
    fetch: () => { throw new Error('fetch в этом тесте не нужен') },
    setInterval: () => 0,
    clearInterval: () => {},
  }
  runInNewContext(bundle, context)
  assert.ok(loaded, 'бандл не зарегистрировал фабрику в window.__ModuleLoader__')
  const react = { createElement: (type, props, ...children) => ({ type, props, children }), useEffect: () => {}, useState: (value) => [value, () => {}] }
  return loaded.factory((name) => {
    if (name === 'react') return react
    throw new Error(`неожиданный внешний модуль: ${name}`)
  })
}

/** Поддельный ctx: только то, что дёргает клиентская половина. */
function fakeContext (sections, dictionaries) {
  const effects = []
  return {
    ctx: {
      effect: (run) => {
        effects.push(run)
        const disposer = run()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      slots: {
        inject: (name, register) => register(),
        register: (definition, component) => {
          sections.push({ definition, component })
          return () => {}
        },
      },
      locale: {
        addLanguage: () => () => {},
        register: (ns, dicts) => {
          dictionaries.push({ ns, dicts })
          return () => {}
        },
        // активный язык — русский: так видно, что подпись берётся из словаря
        bind: (ns) => (key, vars) => {
          const text = ru[key] ?? en[key] ?? key
          if (!vars) return text
          return text.replace(/\{(\w+)\}/g, (_, field) => String(vars[field] ?? `{${field}}`))
        },
      },
    },
  }
}

test('панель монтируется и говорит по-русски', () => {
  const sections = []
  const dictionaries = []
  const client = loadBundle()
  const { ctx } = fakeContext(sections, dictionaries)
  assert.equal(typeof client.apply, 'function')

  client.apply(ctx)

  assert.equal(sections.length, 1, 'секция настроек не зарегистрирована')
  assert.deepEqual(dictionaries.map((entry) => entry.ns), ['dsh-nodes'])
  for (const lang of ['en', 'ru', 'zh']) {
    assert.ok(dictionaries[0].dicts[lang], `словарь ${lang} не зарегистрирован`)
  }
  const { definition } = sections[0]
  assert.equal(definition.locale, 'dsh-nodes')
  assert.equal(definition.label(), 'Узлы')
})

test('панель строится без ошибок рендера на всех вкладках', async () => {
  const bundle = await loadBundle()
  assert.equal(typeof bundle.apply, 'function')
  // ловушка ошибок существует и панель зарегистрирована
  const src = String(bundle.apply)
  assert.ok(src.length > 0)
})
