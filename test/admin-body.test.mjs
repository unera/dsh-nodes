/**
 * The admin JSON body has a ceiling, like the node routes do.
 *
 * `/api/dsh-nodes/op` sits behind the owner's login, but "private" is not a size limit: a
 * body was read into memory whatever its length. The ceiling is the same `maxBodyBytes` the
 * node routes live under, so there is one number to configure and one behaviour to remember.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { AdminError, readJsonBody } from '../lib/admin-api.mjs'

const root = new URL('..', import.meta.url).pathname
const LIMIT = 1024

/** A fetch-style request, the way `connection.fetch` hands one over. */
function request (body, { headers = {} } = {}) {
  return new Request('http://127.0.0.1/api/dsh-nodes/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  })
}

test('an ordinary admin body is parsed', async () => {
  const body = await readJsonBody(request(JSON.stringify({ op: 'update', id: 3, body: { aliases: ['a'] } })), LIMIT)
  assert.deepEqual(body, { op: 'update', id: 3, body: { aliases: ['a'] } })
})

test('an empty body is an empty object, not an error', async () => {
  assert.deepEqual(await readJsonBody(request(''), LIMIT), {})
  assert.deepEqual(await readJsonBody(request(null), LIMIT), {})
})

test('a body above the ceiling is refused with 413 and a code', async () => {
  const big = JSON.stringify({ op: 'update', pad: 'x'.repeat(LIMIT * 2) })
  await assert.rejects(
    () => readJsonBody(request(big), LIMIT),
    (error) => {
      assert.ok(error instanceof AdminError, 'отказ должен быть AdminError, а не 500')
      assert.equal(error.status, 413)
      assert.equal(error.code, 'body_too_large')
      return true
    },
  )
})

test('a streamed body stops at the ceiling instead of being buffered whole', async () => {
  const chunk = new Uint8Array(256)
  let sent = 0
  const stream = new ReadableStream({
    pull (controller) {
      if (sent > LIMIT * 4) { controller.close(); return }
      sent += chunk.length
      controller.enqueue(chunk)
    },
  })
  await assert.rejects(() => readJsonBody(request(stream), LIMIT), /тело больше/)
  assert.ok(sent <= LIMIT * 4, 'чтение прекращается, как только перевалило за предел')
})

test('a body exactly at the ceiling is still accepted', async () => {
  // {"op":"update"} is 15 bytes; pad the value so the whole body is exactly LIMIT bytes
  const empty = JSON.stringify({ op: 'update', pad: '' })
  const body = JSON.stringify({ op: 'update', pad: 'x'.repeat(LIMIT - Buffer.byteLength(empty)) })
  assert.equal(Buffer.byteLength(body), LIMIT)
  assert.equal((await readJsonBody(request(body), LIMIT)).op, 'update')
})

test('broken JSON and a non-object are 400, not 500', async () => {
  for (const body of ['{}oops', '[1,2,3]', '"строка"', 'null']) {
    await assert.rejects(
      () => readJsonBody(request(body), LIMIT),
      (error) => {
        assert.ok(error instanceof AdminError, `${body}: отказ должен быть AdminError`)
        assert.equal(error.status, 400)
        assert.equal(error.code, 'bad_request')
        return true
      },
    )
  }
})

test('a runtime without a web stream is still capped, after reading', async () => {
  const text = JSON.stringify({ op: 'pair', pad: 'x'.repeat(LIMIT * 2) })
  const fake = { headers: { get: () => null }, body: null, text: async () => text }
  await assert.rejects(() => readJsonBody(fake, LIMIT), /тело больше/)
  const ok = { headers: { get: () => null }, body: null, text: async () => '{"op":"pair"}' }
  assert.deepEqual(await readJsonBody(ok, LIMIT), { op: 'pair' })
})

test('the admin routes pass the plugin ceiling to the reader', () => {
  // index.mjs needs cordis to be imported, so the wiring is checked as source text: what
  // matters is that the ceiling comes from the config and not from a literal
  const source = readFileSync(join(root, 'index.mjs'), 'utf8')
  assert.match(source, /readJsonBody\(request, config\.maxBodyBytes\)/,
    'маршрут админки обязан читать тело с потолком из конфига')
  assert.match(source, /error instanceof AdminError/, 'отказ по размеру должен стать 413, а не 500')
})
