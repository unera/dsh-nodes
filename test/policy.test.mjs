/**
 * Режим песочницы из политики ядра и контракт с cordis.
 *
 * Эти тесты появились после того, как выяснилось: сервис, не объявленный в
 * `inject`, бросает ошибку при обращении, а мы её глотали — и режим песочницы
 * не читался вообще. Проверяем и сами ответы, и объявление сервисов.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { FALLBACK_MODE, modeFromPolicy } from '../lib/policy.mjs'

const root = new URL('..', import.meta.url).pathname

test('политика отдаёт режим и корень', () => {
  const result = modeFromPolicy({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/w' }) })
  assert.deepEqual(result, { mode: 'workspace-write', root: '/w' })
})

test('неизвестность — самый узкий режим, а не полный доступ', () => {
  const warnings = []
  assert.deepEqual(modeFromPolicy(null, {}, (m) => warnings.push(m)), { mode: FALLBACK_MODE })
  assert.equal(FALLBACK_MODE, 'read-only')

  const empty = modeFromPolicy({ resolve: () => undefined }, {}, (m) => warnings.push(m))
  assert.deepEqual(empty, { mode: 'read-only' }, 'нет ответа — значит read-only')

  const thrown = modeFromPolicy({ resolve: () => { throw new Error('boom') } }, {}, (m) => warnings.push(m))
  assert.deepEqual(thrown, { mode: 'read-only' }, 'ошибка политики не должна давать полный доступ')

  assert.equal(warnings.length, 3, 'о каждой проблеме надо сказать в журнал')
})

test('сервис без resolve тоже не роняет плагин', () => {
  assert.deepEqual(modeFromPolicy({}, {}), { mode: 'read-only' })
})

test('все сервисы, к которым обращаемся напрямую, объявлены в inject', () => {
  // комментарии не считаем: там сервисы упоминаются для объяснения
  const source = readFileSync(join(root, 'index.mjs'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  const declared = /export const inject = \{([^}]*)\}/.exec(source)?.[1] ?? ''
  const names = [...declared.matchAll(/(\w+)\s*:/g)].map((match) => match[1])
  assert.ok(names.length > 0, 'inject должен быть картой сервисов')

  // прямое обращение вида ctx.<service> требует объявления; ctx.get — нет
  const used = new Set([...source.matchAll(/ctx\.(\w+)/g)].map((match) => match[1]))
  const allowed = new Set(['get', 'effect', 'logger', 'inject', 'tools', 'systemPrompt', 'webServer', 'connection', 'sandboxPolicy', 'plugin', 'on'])
  for (const name of used) {
    if (allowed.has(name) && !names.includes(name)) continue
    if (['get', 'effect', 'logger', 'inject', 'plugin', 'on'].includes(name)) continue
    assert.ok(names.includes(name), `ctx.${name} используется, но не объявлен в inject`)
  }
})
