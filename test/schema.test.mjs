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

/**
 * Client API methods: what a node declares on announce.
 *
 * The declarations live in the client repository, which is checked out as a sibling of this
 * one: `test/` → repository root → `<parent>`. CI may not have it at all, and then the check
 * is skipped with the path it looked at — a skip that says nothing was the bug this replaces.
 *
 * @returns {{names: Set<string>|null, reason: string|null}}
 */
async function clientMethods () {
  const modules = ['../../dsh-node-client/lib/plugins/files.mjs', '../../dsh-node-client/lib/plugins/session.mjs']
  const names = new Set()
  for (const path of modules) {
    try {
      const module = await import(new URL(path, import.meta.url).href)
      for (const method of module.api().methods) names.add(method.method)
    } catch (error) {
      return { names: null, reason: `${path}: ${error?.code ?? error?.message ?? error}` }
    }
  }
  return { names, reason: null }
}

/** The machine-readable list of the methods a node announces. */
function declaredClientMethods () {
  const declared = schema['x-client-methods'] ?? {}
  return new Set(Object.values(declared).flat().map((name) => String(name)))
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

test('every client API method is listed in the schema', async (t) => {
  const { names, reason } = await clientMethods()
  if (!names) {
    // an honest skip: it names the path that was missing instead of hiding the check
    t.skip(`клиентского репозитория нет рядом, сверять не с чем (${reason})`)
    return
  }
  // the list a client author can rely on is `x-client-methods`; a method that exists in the
  // client and is not there is exactly the drift this test exists for
  const declared = declaredClientMethods()
  const missing = [...names].filter((name) => !declared.has(name))
  assert.deepEqual(missing, [], `методы клиента не описаны в x-client-methods: ${missing.join(', ')}`)
})

test('the device event vocabulary matches docs/device-events.md', () => {
  // The reference is docs/device-events.md: it is what a client author reads. The schema must
  // carry exactly the same types, on the routes they belong to, or the two drift apart again.
  const doc = read('docs/device-events.md')
  const fromDoc = new Set([...doc.matchAll(/type:\s*"([a-z-]+)"/g)].map((match) => match[1]))
  const declared = schema['x-device-events'] ?? {}
  // `none` is the "no type at all" case, not a name
  const fromSpec = new Set(Object.values(declared).flat().map(String).filter((type) => type !== 'none'))

  assert.ok(fromDoc.size >= 6, `в справочнике должен быть словарь, а нашлось: ${[...fromDoc].join(', ')}`)
  const onlyDoc = [...fromDoc].filter((type) => !fromSpec.has(type))
  const onlySpec = [...fromSpec].filter((type) => !fromDoc.has(type))
  assert.deepEqual(onlyDoc, [], `есть в docs/device-events.md, нет в x-device-events: ${onlyDoc.join(', ')}`)
  assert.deepEqual(onlySpec, [], `есть в x-device-events, нет в docs/device-events.md: ${onlySpec.join(', ')}`)

  // and the enum of the field must be the same list: a generated client reads the enum, not
  // the extension
  const enumOf = schema.paths?.['/v1/events']?.post?.requestBody?.content?.['application/json']
    ?.schema?.properties?.type?.enum ?? []
  const eventsTypes = new Set([...(declared['/v1/events'] ?? []), ...(declared['/v1/events (legacy)'] ?? [])]
    .map(String).filter((type) => type !== 'none'))
  assert.deepEqual([...eventsTypes].filter((type) => !enumOf.includes(type)), [],
    'типы /v1/events в x-device-events должны быть в enum поля type')
  assert.deepEqual(enumOf.filter((type) => !eventsTypes.has(type)), [],
    'enum поля type не должен знать типов, которых нет в x-device-events')
  // the upload route is where a whole recording arrives: `type=voice` names it, not an action
  const uploadType = schema.paths?.['/v1/upload-file']?.post?.parameters
    ?.find((parameter) => parameter.name === 'type')?.schema?.enum ?? []
  assert.deepEqual(uploadType, ['voice'], 'у /v1/upload-file должен быть type=voice')
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


