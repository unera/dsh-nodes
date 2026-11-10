/**
 * The sandbox mode from the core policy and the contract with cordis.
 *
 * These tests appeared after it turned out that a service not declared in
 * `inject` throws on access, and we swallowed that error — so the sandbox mode
 * was never read at all. We check both the answers themselves and the service
 * declarations.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { FALLBACK_MODE, modeFromPolicy } from '../lib/policy.mjs'

const root = new URL('..', import.meta.url).pathname

test('the policy returns the mode and the root', () => {
  const result = modeFromPolicy({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/w' }) })
  assert.deepEqual(result, { mode: 'workspace-write', root: '/w' })
})

test('the unknown case is the narrowest mode, not full access', () => {
  const warnings = []
  assert.deepEqual(modeFromPolicy(null, {}, (m) => warnings.push(m)), { mode: FALLBACK_MODE })
  assert.equal(FALLBACK_MODE, 'read-only')

  const empty = modeFromPolicy({ resolve: () => undefined }, {}, (m) => warnings.push(m))
  assert.deepEqual(empty, { mode: 'read-only' }, 'нет ответа — значит read-only')

  const thrown = modeFromPolicy({ resolve: () => { throw new Error('boom') } }, {}, (m) => warnings.push(m))
  assert.deepEqual(thrown, { mode: 'read-only' }, 'ошибка политики не должна давать полный доступ')

  assert.equal(warnings.length, 3, 'о каждой проблеме надо сказать в журнал')
})

test('a service without resolve does not crash the plugin either', () => {
  assert.deepEqual(modeFromPolicy({}, {}), { mode: 'read-only' })
})

test('every service we access directly is declared in inject', () => {
  // comments are not counted: services are mentioned there for explanation
  const source = readFileSync(join(root, 'index.mjs'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

  const declared = /export const inject = \{([^}]*)\}/.exec(source)?.[1] ?? ''
  const names = [...declared.matchAll(/(\w+)\s*:/g)].map((match) => match[1])
  assert.ok(names.length > 0, 'inject должен быть картой сервисов')

  // a direct access like `ctx.<service>` requires a declaration in inject.
  // `ctx.get('...')` does not, so such accesses do not end up here.
  const used = new Set([...source.matchAll(/ctx\.(\w+)/g)].map((match) => match[1]))
  const notServices = new Set(['get', 'effect', 'logger', 'plugin', 'on', 'inject', 'emit', 'set'])
  const missing = [...used].filter((name) => !notServices.has(name) && !names.includes(name))
  assert.deepEqual(missing, [], `используются, но не объявлены в inject: ${missing.join(', ')}`)

  // the reverse check: the test must catch a real hole instead of always being green
  const broken = source.replace(/\n\s*sandboxPolicy:\s*null,/, "\n")
  const brokenNames = [...(/export const inject = \{([^}]*)\}/.exec(broken)?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => m[1])
  assert.ok(!brokenNames.includes('sandboxPolicy'), 'подготовка: из inject убрать sandboxPolicy не удалось')
  const brokenUsed = new Set([...broken.matchAll(/ctx\.(\w+)/g)].map((match) => match[1]))
  const brokenMissing = [...brokenUsed].filter((name) => !notServices.has(name) && !brokenNames.includes(name))
  assert.ok(brokenMissing.includes('sandboxPolicy'), 'тест обязан замечать необъявленный сервис')
})
