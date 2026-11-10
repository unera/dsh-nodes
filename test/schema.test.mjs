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

test('особые правила требуют полей в объявлении метода', async () => {
  const { checkSpecialRules, RULES } = await import('../lib/special-rules.mjs')
  // timing без полей замера — это «замер», который ничего не мерил
  const bad = checkSpecialRules([{
    name: 'session',
    methods: [{ method: 'ping', special: 'timing', returns: { type: 'object', properties: {} } }],
  }])
  // три поля, которые ставит сервер, и две отметки узла: каждое отсутствующее — жалоба
  const fields = [...RULES.timing.fields, ...RULES.timing.nodeFields]
  assert.equal(bad.problems.length, fields.length)
  for (const field of fields) assert.match(bad.problems.join(' '), new RegExp(field))

  const good = checkSpecialRules([{
    name: 'session',
    methods: [{
      method: 'ping',
      special: 'timing',
      returns: { type: 'object', properties: Object.fromEntries(fields.map((field) => [field, {}])) },
    }],
  }])
  assert.deepEqual(good.problems, [])

  // правило, которого у сервера нет, — тоже повод сказать вслух
  const unknown = checkSpecialRules([{ name: 'session', methods: [{ method: 'x', special: 'nope' }] }])
  assert.equal(unknown.unknownRules.length, 1)
})

test('привязка метода к правилу описана в схеме announce', () => {
  // без этого поля в схеме узел не знает, как попросить правило, а сервер —
  // что именно он принимает в объявлении
  assert.match(spec, /special:/, 'в MethodDef должно быть поле special')
  const methodDef = spec.slice(spec.indexOf('    MethodDef:'), spec.indexOf('    ApiDef:'))
  assert.match(methodDef, /enum: \[timing, flushBefore, flushAfter, flushAround\]/,
    'перечисление правил в схеме должно совпадать с набором сервера')
  assert.match(spec, /SPECIAL-RULES\.md/, 'схема должна ссылаться на реестр правил')
  // русская документация протокола не должна отставать от английской
  assert.match(read('docs/openapi.ru.yaml'), /special:/)
})

test('правило-барьер полей не требует, а неизвестное правило — повод сказать вслух', async () => {
  const { checkSpecialRules } = await import('../lib/special-rules.mjs')
  const ok = checkSpecialRules([{ name: 'shell', methods: [{ method: 'exec', special: 'flushBefore' }] }])
  assert.deepEqual(ok.problems, [], 'flushBefore полей в ответе не требует')
  assert.deepEqual(ok.unknownRules, [])
  const unknown = checkSpecialRules([{ name: 'shell', methods: [{ method: 'exec', special: 'timing-ish' }] }])
  assert.equal(unknown.unknownRules.length, 1, 'правило, которого у сервера нет, не применяется молча')
  assert.match(unknown.unknownRules[0], /неизвестно/)
})
