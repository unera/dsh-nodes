// Checking that the protocol schema keeps up with the code.
//
// This catches exactly the case where a route or a method appeared but is
// missing from `spec/openapi.yaml`: the schema used to drift from the code for
// days, and the only way to notice it was by hand.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'

const root = new URL('..', import.meta.url).pathname
const read = (path) => readFileSync(join(root, path), 'utf8')
const spec = read('spec/openapi.yaml')
// a parsed schema: check the structure instead of searching for substrings
const schema = parseYaml(spec)
const components = schema.components?.schemas ?? {}

/** Routes the server really handles. */
function serverRoutes () {
  const source = read('lib/server.mjs')
  const found = new Map()
  for (const match of source.matchAll(/path === '(\/v1\/[^']*)' && method === '(\w+)'/g)) {
    found.set(match[1], match[2].toLowerCase())
  }
  return found
}

/** WebSocket frames the server understands or sends. */
function wsFrames () {
  const source = read('lib/ws.mjs') + read('lib/queue.mjs')
  const kinds = new Set()
  for (const match of source.matchAll(/t === '([a-z-]+)'/g)) kinds.add(match[1])
  for (const match of source.matchAll(/t: '([a-z-]+)'/g)) kinds.add(match[1])
  return kinds
}

/** Client API methods: what a node declares on announce. */
async function clientMethods () {
  // the declarations live in the client repository; CI may not have it, so
  // missing files are a reason to skip the check, not to fail
  const modules = ['../dsh-node-client/lib/plugins/files.mjs', '../dsh-node-client/lib/plugins/session.mjs']
  const names = new Set()
  for (const path of modules) {
    try {
      const module = await import(new URL(path, import.meta.url).href)
      for (const method of module.api().methods) names.add(method.method)
    } catch {
      return null
    }
  }
  return names
}

test('every server route is described in the schema', () => {
  const missing = []
  for (const [path, method] of serverRoutes()) {
    if (!spec.includes(`  ${path}:`)) missing.push(`${method.toUpperCase()} ${path}`)
  }
  assert.deepEqual(missing, [], `нет в spec/openapi.yaml: ${missing.join(', ')}`)
})

test('every websocket frame is described in the schema', () => {
  const declared = /x-ws-frames:\s*\n((?:\s+-\s+\S+\n)+)/.exec(spec)?.[1] ?? ''
  const known = new Set([...declared.matchAll(/-\s+(\S+)/g)].map((match) => match[1]))
  const missing = [...wsFrames()].filter((frame) => !known.has(frame))
  assert.deepEqual(missing, [], `кадры не описаны в x-ws-frames: ${missing.join(', ')}`)
})

test('every client API method is mentioned in the schema', async (t) => {
  const methods = await clientMethods()
  if (!methods) {
    t.skip('клиентский репозиторий не найден рядом')
    return
  }
  // we look where methods belong: in route and model descriptions
  const described = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'method' && typeof value === 'string') described.add(value)
        walk(value)
      }
    }
  }
  walk(schema)
  const missing = [...methods].filter((name) => !described.has(name))
  assert.deepEqual(missing, [], `методы не описаны: ${missing.join(', ')}`)
})

test('the protocol conventions are described in the schema', () => {
  // rules that cannot be derived from a single route: where events live,
  // what the hash prefix means, how work is cancelled
  assert.match(spec, /x-protocol-rules:/)
  assert.match(spec, /control-prefix:\s*"#"/)
  assert.match(spec, /control-api:\s*-1/)
  assert.match(spec, /INTERNAL\.CANCEL/)
})

test('applyRules checks the binding and rejects the whole declaration', async () => {
  const { parseApplyRules } = await import('../lib/special-rules.mjs')
  const defs = {
    session: { id: 7, def: { name: 'session', version: 'v1', methods: [{ method: 'ping' }, { method: 'chdir' }] } },
    shell: { id: 8, def: { name: 'shell', version: 'v1', methods: [{ method: 'exec' }] } },
  }
  const resolve = (name) => defs[name] ?? null

  const ok = parseApplyRules([{ api: 'session', method: 'chdir', rule: 'flushAround' }], { resolve })
  assert.deepEqual(ok.errors, [])
  // a binding refers by name: the API number is issued by the announce transaction
  assert.deepEqual(ok.bindings, [{ api: 'session', version: null, method: 'chdir', rule: 'flushAround', opts: null }])
  assert.deepEqual(ok.warnings, [])

  // anything that does not add up is a rejection, not a silent skip
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

test('timing without retNames is accepted but warns: measuring without keeping is allowed, losing is not', async () => {
  const { parseApplyRules } = await import('../lib/special-rules.mjs')
  const resolve = () => ({ id: 1, def: { name: 'session', version: 'v1', methods: [{ method: 'ping' }] } })
  const result = parseApplyRules([{ api: 'session', method: 'ping', rule: 'timing' }], { resolve })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /retNames пуст/)
  assert.equal(result.bindings[0].opts, null)

  // null in retNames means this field is absent and is not stored, and that is a deliberate choice
  const withNull = parseApplyRules([{
    api: 'session', method: 'ping', rule: 'timing', rulesOpts: { retNames: { durationMs: 'took', clockSkewMs: null } },
  }], { resolve })
  assert.deepEqual(withNull.warnings, [])
  assert.deepEqual(withNull.bindings[0].opts, { retNames: { durationMs: 'took' } })
})

test('binding a method to a rule is described in the announce schema', () => {
  // rules are declared as a separate list rather than a field inside apidef: an
  // external contract source must not know about server-side rules
  assert.match(spec, /applyRules:/, 'в Announce должно быть поле applyRules')
  const announce = spec.slice(spec.indexOf('    Announce:'), spec.indexOf('    AnnounceAccepted:'))
  assert.match(announce, /enum: \[timing, flushBefore, flushAfter, flushAround\]/,
    'перечисление правил в схеме должно совпадать с набором сервера')
  assert.match(spec, /SPECIAL-RULES\.md/, 'схема должна ссылаться на реестр правил')
  const methodDef = spec.slice(spec.indexOf('    MethodDef:'), spec.indexOf('    ApiDef:'))
  assert.equal(/special:/.test(methodDef), false, 'правил внутри apidef быть не должно')
  assert.match(read('docs/openapi.ru.yaml'), /applyRules:/, 'русская схема не должна отставать')
})


