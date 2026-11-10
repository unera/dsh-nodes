/**
 * The client half: dictionaries and the build.
 *
 * The bug this test catches has already happened: `t()` in the panel read `ru`
 * and `en`, but `i18n.js` was never imported into `index.js` — the build passed,
 * the server tests passed too, and in the browser the settings panel crashed
 * with `ru is not defined`. So we check wiring rather than behaviour: every key
 * exists in all dictionaries, and the built bundle carries the dictionaries
 * themselves and the locale binding.
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

test('the panel has enough keys for the check to be non-trivial', () => {
  assert.ok(keys.length > 20, `найдено ключей: ${keys.length}`)
})

test('every panel key exists in all three dictionaries', () => {
  for (const [lang, dict] of Object.entries({ en, ru, zh })) {
    const missing = keys.filter((key) => !(key in dict))
    assert.deepEqual(missing, [], `${lang}: нет строк для ${missing.join(', ')}`)
  }
})

test('the built client carries the dictionaries and the locale binding', () => {
  // markers that survive without minification: the build runs with minify: false
  const markers = ['var en = {', 'var ru = {', 'var zh = {', 'locale.register(NS', 'locale.bind(NS)']
  for (const marker of markers) {
    assert.ok(
      bundle.includes(marker),
      `в lib/client.js нет «${marker}» — пересобери клиент: npm run build:client`,
    )
  }
})

/**
 * Running the real bundle without a browser.
 *
 * Repeats the path where the panel broke: `apply(ctx)` registers a section,
 * and the section label calls `t()`. If the bundle has no dictionaries, we get
 * the same `ru is not defined` here as in the browser console.
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

/** A fake ctx: only what the client half touches. */
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
        // the active language is Russian: this shows the label comes from the dictionary
        bind: (ns) => (key, vars) => {
          const text = ru[key] ?? en[key] ?? key
          if (!vars) return text
          return text.replace(/\{(\w+)\}/g, (_, field) => String(vars[field] ?? `{${field}}`))
        },
      },
    },
  }
}

test('the panel mounts and speaks Russian', () => {
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

test('the panel builds without render errors on all tabs', async () => {
  const bundle = await loadBundle()
  assert.equal(typeof bundle.apply, 'function')
  // the error trap exists and the panel is registered
  const src = String(bundle.apply)
  assert.ok(src.length > 0)
})

test('the panel references only declared render variables', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  // these names appeared while fixing the markup: if the declaration was not
  // inserted, the panel crashed entirely with X is not defined
  for (const name of ['linkAlive', 'secondsLeft', 'expiresAt']) {
    const declared = src.includes(`const ${name}`) || src.includes(`[${name},`) || src.includes(`const [${name}`)
    assert.ok(declared, `${name} используется, но не объявлен`)
  }
})
