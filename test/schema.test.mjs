// Проверка, что схема протокола не отстаёт от кода.
//
// Это ловит именно тот случай, когда маршрут или метод появился, а в
// `spec/openapi.yaml` его нет: раньше схема расходилась с кодом на дни, и
// заметить это можно было только вручную.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = new URL('..', import.meta.url).pathname
const read = (path) => readFileSync(join(root, path), 'utf8')
const spec = read('spec/openapi.yaml')

/** Маршруты, которые сервер действительно обрабатывает. */
function serverRoutes () {
  const source = read('lib/server.mjs')
  const found = new Map()
  for (const match of source.matchAll(/path === '(\/v1\/[^']*)' && method === '(\w+)'/g)) {
    found.set(match[1], match[2].toLowerCase())
  }
  return found
}

/** Кадры websocket, которые сервер понимает или отправляет. */
function wsFrames () {
  const source = read('lib/ws.mjs') + read('lib/queue.mjs')
  const kinds = new Set()
  for (const match of source.matchAll(/t === '([a-z-]+)'/g)) kinds.add(match[1])
  for (const match of source.matchAll(/t: '([a-z-]+)'/g)) kinds.add(match[1])
  return kinds
}

/** Методы клиентских API: то, что узел объявляет при announce. */
function clientMethods () {
  // описания клиентских API живут в репозитории клиента; в CI его может не
  // быть, поэтому отсутствие файлов — не ошибка, а повод пропустить проверку
  const sources = ['../dsh-node-client/lib/plugins/files.mjs', '../dsh-node-client/lib/plugins/session.mjs']
  const source = sources
    .map((path) => {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
  if (!source) return null
  const names = new Set()
  for (const match of source.matchAll(/method: '([a-zA-Z_]+)'/g)) names.add(match[1])
  return names
}

test('каждый маршрут сервера описан в схеме', () => {
  const missing = []
  for (const [path, method] of serverRoutes()) {
    if (!spec.includes(`  ${path}:`)) missing.push(`${method.toUpperCase()} ${path}`)
  }
  assert.deepEqual(missing, [], `нет в spec/openapi.yaml: ${missing.join(', ')}`)
})

test('каждый кадр websocket описан в схеме', () => {
  const declared = /x-ws-frames:\s*\n((?:\s+-\s+\S+\n)+)/.exec(spec)?.[1] ?? ''
  const known = new Set([...declared.matchAll(/-\s+(\S+)/g)].map((match) => match[1]))
  const missing = [...wsFrames()].filter((frame) => !known.has(frame))
  assert.deepEqual(missing, [], `кадры не описаны в x-ws-frames: ${missing.join(', ')}`)
})

test('каждый метод клиентских API упомянут в схеме', (t) => {
  const methods = clientMethods()
  if (!methods) {
    t.skip('клиентский репозиторий не найден рядом')
    return
  }
  const missing = [...methods].filter((name) => !spec.includes(name))
  assert.deepEqual(missing, [], `методы не описаны: ${missing.join(', ')}`)
})

test('соглашения протокола описаны в схеме', () => {
  // правила, которые нельзя вывести из отдельного маршрута: где живут события,
  // что значит решётка, как отменяют работу
  assert.match(spec, /x-protocol-rules:/)
  assert.match(spec, /control-prefix:\s*"#"/)
  assert.match(spec, /control-api:\s*-1/)
  assert.match(spec, /INTERNAL\.CANCEL/)
})

test('applyRules проверяет привязку и отказывает объявлению целиком', async () => {
  const { parseApplyRules } = await import('../lib/special-rules.mjs')
  const defs = {
    session: { id: 7, def: { name: 'session', version: 'v1', methods: [{ method: 'ping' }, { method: 'chdir' }] } },
    shell: { id: 8, def: { name: 'shell', version: 'v1', methods: [{ method: 'exec' }] } },
  }
  const resolve = (name) => defs[name] ?? null

  const ok = parseApplyRules([{ api: 'session', method: 'chdir', rule: 'flushAround' }], { resolve })
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.bindings, [{ apiId: 7, method: 'chdir', rule: 'flushAround', opts: null }])
  assert.deepEqual(ok.warnings, [])

  // всё, что не сходится, — отказ, а не тихий пропуск
  const unknownRule = parseApplyRules([{ api: 'session', method: 'chdir', rule: 'nope' }], { resolve })
  assert.match(unknownRule.errors[0], /неизвестно/)
  const unknownApi = parseApplyRules([{ api: 'files', method: 'exec', rule: 'timing' }], { resolve })
  assert.match(unknownApi.errors[0], /не объявлен/)
  const unknownMethod = parseApplyRules([{ api: 'session', method: 'nope', rule: 'timing' }], { resolve })
  assert.match(unknownMethod.errors[0], /не объявляет метод/)
  const duplicate = parseApplyRules([
    { api: 'session', method: 'chdir', rule: 'flushBefore' },
    { api: 'session', method: 'chdir', rule: 'flushAfter' },
  ], { resolve })
  assert.match(duplicate.errors[0], /уже задано/)
  const badOption = parseApplyRules([{
    api: 'session', method: 'ping', rule: 'timing', rulesOpts: { retNames: { nope: 'x' } },
  }], { resolve })
  assert.match(badOption.errors[0], /не считает/)
  const badRuleOption = parseApplyRules([{
    api: 'session', method: 'ping', rule: 'timing', rulesOpts: { mystery: 1 },
  }], { resolve })
  assert.match(badRuleOption.errors[0], /неизвестные опции/)
  const reserved = parseApplyRules([{ api: 'session', method: '#INTERNAL.FLUSH', rule: 'timing' }], { resolve })
  assert.match(reserved.errors[0], /служебное имя/)
})

test('timing без retNames принимается, но предупреждает: мерить в стол можно, терять — нет', async () => {
  const { parseApplyRules } = await import('../lib/special-rules.mjs')
  const resolve = () => ({ id: 1, def: { name: 'session', version: 'v1', methods: [{ method: 'ping' }] } })
  const result = parseApplyRules([{ api: 'session', method: 'ping', rule: 'timing' }], { resolve })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /retNames пуст/)
  assert.equal(result.bindings[0].opts, null)

  // null в retNames — «этого поля нет, не кладём», и это уже осознанный выбор
  const withNull = parseApplyRules([{
    api: 'session', method: 'ping', rule: 'timing', rulesOpts: { retNames: { durationMs: 'took', clockSkewMs: null } },
  }], { resolve })
  assert.deepEqual(withNull.warnings, [])
  assert.deepEqual(withNull.bindings[0].opts, { retNames: { durationMs: 'took' } })
})

test('привязка метода к правилу описана в схеме announce', () => {
  // правила объявляются отдельным списком, а не полем внутри apidef: внешний
  // источник контракта не должен знать про серверные правила
  assert.match(spec, /applyRules:/, 'в Announce должно быть поле applyRules')
  const announce = spec.slice(spec.indexOf('    Announce:'), spec.indexOf('    AnnounceAccepted:'))
  assert.match(announce, /enum: \[timing, flushBefore, flushAfter, flushAround\]/,
    'перечисление правил в схеме должно совпадать с набором сервера')
  assert.match(spec, /SPECIAL-RULES\.md/, 'схема должна ссылаться на реестр правил')
  const methodDef = spec.slice(spec.indexOf('    MethodDef:'), spec.indexOf('    ApiDef:'))
  assert.equal(/special:/.test(methodDef), false, 'правил внутри apidef быть не должно')
  assert.match(read('docs/openapi.ru.yaml'), /applyRules:/, 'русская схема не должна отставать')
})


