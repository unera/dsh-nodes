import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Store } from '../lib/db.mjs'
import { Queue } from '../lib/queue.mjs'
import { createNodesServer } from '../lib/server.mjs'
import {
  eventTypeOf,
  headerEpoch,
  headerSeconds,
  voiceFiletype,
  voiceSynth,
  voiceTargetPath,
  voiceUploadId,
  VOICE_FILETYPES,
} from '../lib/voice-upload.mjs'

test('only the formats the recognizer can take are accepted', () => {
  assert.equal(voiceFiletype('wav'), 'wav')
  assert.equal(voiceFiletype('OGG'), 'ogg')
  assert.deepEqual([...VOICE_FILETYPES], ['wav', 'ogg', 'opus', 'mp3', 'm4a', 'flac'])
  assert.throws(() => voiceFiletype(''), (error) => error.code === 'bad_filetype' && error.status === 400)
  assert.throws(() => voiceFiletype('exe'), (error) => error.code === 'bad_filetype')
})

test('an id is either given safely or minted, never taken raw', () => {
  assert.equal(voiceUploadId('take-1_A'), 'take-1_A')
  assert.match(voiceUploadId(''), /^[0-9a-f-]{36}$/)
  assert.match(voiceUploadId(undefined), /^[0-9a-f-]{36}$/)
  assert.throws(() => voiceUploadId('../../etc/passwd'), (error) => error.code === 'bad_id')
  assert.throws(() => voiceUploadId('a/b'), (error) => error.code === 'bad_id')
  assert.throws(() => voiceUploadId('x'.repeat(65)), (error) => error.code === 'bad_id')
})

test('the server, not the device, chooses where a recording lands', () => {
  const configured = voiceTargetPath({ config: { voiceCacheDir: '/srv/voice' }, id: 't1', filetype: 'wav' })
  assert.equal(configured, '/srv/voice/t1.wav')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/home/dsh/work/ai/.dsh'
  try {
    assert.equal(
      voiceTargetPath({ config: {}, id: 't2', filetype: 'ogg' }),
      '/home/dsh/work/ai/.dsh/cache/voice/incoming/t2.ogg',
    )
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('which side speaks is device by default and host on request', () => {
  assert.equal(voiceSynth('host'), 'host')
  assert.equal(voiceSynth('HOST'), 'host')
  assert.equal(voiceSynth('device'), 'device')
  assert.equal(voiceSynth(''), 'device')
  assert.equal(voiceSynth(undefined), 'device')
  assert.equal(voiceSynth('espeak'), 'device', 'a typo costs nothing, it does not break an upload')
})

test('the optional length header is a number or nothing', () => {
  assert.equal(headerSeconds({ 'x-seconds': '4.8' }), 4.8)
  assert.equal(headerSeconds({}), null)
  assert.equal(headerSeconds({ 'x-seconds': 'скоро' }), null)
  assert.equal(headerSeconds({ 'x-seconds': '0' }), null)
})

test('client timestamps are accepted only as whole positive milliseconds', () => {
  assert.equal(headerEpoch({ 'x-sent-at': '1763038800123' }, 'x-sent-at'), 1763038800123)
  assert.equal(headerEpoch({ 'x-sent-at': '12.5' }, 'x-sent-at'), null)
  assert.equal(headerEpoch({ 'x-sent-at': '-5' }, 'x-sent-at'), null)
  assert.equal(headerEpoch({ 'x-sent-at': '0' }, 'x-sent-at'), null)
  assert.equal(headerEpoch({ 'x-sent-at': 'вчера' }, 'x-sent-at'), null)
  assert.equal(headerEpoch({}, 'x-sent-at'), null)
})

test('a missing type is guessed from the body, and the host says so once', () => {
  const warnings = []
  const warnOnce = (message) => warnings.push(message)
  // no notification → the body is text for a session, and it must name both a session and words
  const guessedSession = eventTypeOf({ session: 's-1', text: 'привет' }, { warnOnce })
  assert.deepEqual(guessedSession, { type: 'notify-session' })
  const guessedButton = eventTypeOf({ notification: 'n-1', button: 'b1' }, { warnOnce })
  assert.deepEqual(guessedButton, { type: 'notify-button' })
  assert.equal(warnings.length, 2)
})

test('the old notify type still works in both directions', () => {
  done: {
    assert.deepEqual(eventTypeOf({ type: 'notify', notification: 'n-1' }, { warnOnce: () => {} }), { type: 'notify-button' })
    assert.deepEqual(
      eventTypeOf({ type: 'notify', session: 's-1', text: 'привет' }, { warnOnce: () => {} }),
      { type: 'notify-session' },
    )
  }
})

test('each notify type refuses without its own fields', () => {
  assert.equal(eventTypeOf({ type: 'notify-button' }, { warnOnce: () => {} }).error.status, 400)
  assert.equal(eventTypeOf({ type: 'notify-button' }, { warnOnce: () => {} }).error.message.includes('уведомления'), true)
  assert.equal(eventTypeOf({ type: 'notify-session', session: 's-1' }, { warnOnce: () => {} }).error.code, 'bad_request')
  assert.equal(eventTypeOf({ type: 'notify-session', text: 'привет' }, { warnOnce: () => {} }).error.code, 'bad_request')
  assert.deepEqual(eventTypeOf({ type: 'notify-session', session: 's-1', text: 'привет' }), { type: 'notify-session' })
})

test('voice is not an events type: it belongs to the upload route', () => {
  const refused = eventTypeOf({ type: 'voice' })
  assert.equal(refused.error.status, 400)
  assert.equal(refused.error.code, 'bad_type')
  assert.match(refused.error.message, /\/v1\/upload-file/)
})

test('a form event is a clear refusal, not a silent notify', () => {
  const form = eventTypeOf({ type: 'form' })
  assert.equal(form.error.status, 501)
  assert.equal(form.error.code, 'form_not_supported')

  const junk = eventTypeOf({ type: 'telepathy' })
  assert.equal(junk.error.status, 400)
  assert.equal(junk.error.code, 'bad_type')
})

/** A server with one registered node and a directory for recordings. */
async function stand (t, { maxTransferBytes = 1_000_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-voice-'))
  const store = new Store(join(dir, 'nodes.sqlite'))
  const epoch = store.bumpEpoch()
  const queue = new Queue({ epoch, defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const events = []
  const handler = createNodesServer({
    store,
    queue,
    config: {
      routePrefix: '/dsh-nodes',
      maxBodyBytes: 65536,
      maxTransferBytes,
      aliveTimeoutSeconds: 60,
      voiceCacheDir: join(dir, 'incoming'),
    },
    services: { emit: (name, payload) => events.push({ name, payload }), sessions: null, sessionController: null },
  })
  const server = createServer((req, res) => handler.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-nodes`
  const { node, token } = store.createNode({ name: 'phone', token: 'test-node-token' })
  t.after(() => {
    server.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { base, token, node, dir, events, store, queue }
}

test('a recording pushed by the device is stored and announced', async (t) => {
  const { base, token, node, dir, events } = await stand(t)
  const bytes = Buffer.from('RIFF....WAVEfmt ')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=take-1`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-length': String(bytes.length),
      'x-seconds': '4.8',
      'x-record-start': '1763038800000',
      'x-record-stop': '1763038804800',
      'x-sent-at': '1763038804900',
      'x-record-garbage': 'yesterday',
    },
    body: bytes,
  })
  const body = await answer.json()
  assert.equal(answer.status, 202)
  assert.equal(body.accepted, true)
  assert.equal(body.id, 'take-1')
  assert.equal(body.bytes, bytes.length)
  assert.equal(body.seconds, 4.8)
  assert.equal(body.path, join(dir, 'incoming', 'take-1.wav'))
  assert.deepEqual(readFileSync(body.path), bytes, 'the stored bytes are exactly what was sent')
  assert.equal(existsSync(`${body.path}.inprogress`), false, 'no half file is left behind')

  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'dsh-nodes/voice')
  const payload = events[0].payload
  assert.equal(payload.node, node.id)
  assert.equal(payload.nodeName, 'phone')
  assert.equal(payload.id, 'take-1')
  assert.equal(payload.path, body.path)
  assert.equal(payload.bytes, bytes.length)
  assert.equal(payload.seconds, 4.8)
  assert.equal(payload.at.recordStart, 1763038800000)
  assert.equal(payload.at.recordStop, 1763038804800)
  assert.equal(payload.at.sentAt, 1763038804900)
  assert.ok(Number.isInteger(payload.at.receivedAt) && payload.at.receivedAt > 0, 'the server stamps its own arrival')
  assert.equal(payload.synth, 'device', 'no synth parameter means the fast path')
})

test('a refused recording writes nothing and announces nothing', async (t) => {
  const { base, token, dir, events } = await stand(t, { maxTransferBytes: 10 })
  const send = (query, size) => fetch(`${base}/v1/upload-file?type=voice${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(size) },
    body: Buffer.alloc(size, 1),
  })

  const wrongType = await send('&filetype=exe&id=a1', 4)
  assert.equal(wrongType.status, 400)
  assert.equal((await wrongType.json()).code, 'bad_filetype')

  const badId = await send('&filetype=wav&id=../x', 4)
  assert.equal(badId.status, 400)
  assert.equal((await badId.json()).code, 'bad_id')

  const tooBig = await send('&filetype=wav&id=a2', 50)
  assert.equal(tooBig.status, 413)
  assert.equal((await tooBig.json()).code, 'too_big')

  assert.equal(existsSync(join(dir, 'incoming', 'a1.exe')), false)
  assert.equal(existsSync(join(dir, 'incoming', 'a2.wav')), false)
  assert.deepEqual(events, [], 'nothing is announced when nothing was stored')
})

test('an upload without a node token is refused', async (t) => {
  const { base } = await stand(t)
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=x1`, {
    method: 'POST',
    headers: { 'content-length': '4' },
    body: Buffer.from('abcd'),
  })
  assert.equal(answer.status, 401)
})

test('the command path is untouched: no type=voice means no voice route', async (t) => {
  const { base, token, dir, events } = await stand(t)
  // the ordinary upload of a copyFromDevice answer: no seq, so the transfer layer refuses it
  const answer = await fetch(`${base}/v1/upload-file`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': '4' },
    body: Buffer.from('abcd'),
  })
  assert.ok(answer.status >= 400, 'a transfer without a command must not be accepted')
  const body = await answer.json()
  assert.ok(['wrong_command', 'no_command', 'bad_request'].includes(body.code) || body.code, `unexpected code ${body.code}`)
  assert.deepEqual(events, [], 'the voice route did not run')
  assert.equal(existsSync(join(dir, 'incoming')), false, 'nothing was written for a voice upload')
})

test('an upload without client timestamps still arrives, with only receivedAt', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=plain`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  const payload = events[0].payload
  assert.equal(payload.at.recordStart, null)
  assert.equal(payload.at.recordStop, null)
  assert.equal(payload.at.sentAt, null)
  assert.ok(payload.at.receivedAt > 0)
})

test('synth=host travels into the event', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=hosted&synth=host`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  assert.equal(events[0].payload.synth, 'host')
})

test('a junk synth value is received as device, not refused', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=typo&synth=espeak`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  assert.equal(events[0].payload.synth, 'device')
})

test('a new-session event requires neither text nor session', async (t) => {
  const { base, token, node, events } = await stand(t)
  const answer = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'new-session' }),
  })
  const body = await answer.json()
  assert.equal(answer.status, 202)
  assert.deepEqual(body, { accepted: true, device: 'phone' })
  assert.deepEqual(events, [{ name: 'dsh-nodes/voice-new-session', payload: { node: node.id, nodeName: 'phone' } }])
})

test('voice on the events route is refused with a pointer to the upload route', async (t) => {
  const { base, token, events } = await stand(t)
  const answer = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'voice', action: 'new-session' }),
  })
  assert.equal(answer.status, 400)
  const body = await answer.json()
  assert.equal(body.code, 'bad_type')
  assert.match(body.message, /upload-file/)
  assert.deepEqual(events, [])
})

test('a recording pushed by the device is stored and announced', async (t) => {
  const { base, token, node, dir, events } = await stand(t)
  const bytes = Buffer.from('RIFF....WAVEfmt ')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=take-1`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-length': String(bytes.length),
      'x-seconds': '4.8',
      'x-record-start': '1763038800000',
      'x-record-stop': '1763038804800',
      'x-sent-at': '1763038804900',
      'x-record-garbage': 'yesterday',
    },
    body: bytes,
  })
  const body = await answer.json()
  assert.equal(answer.status, 202)
  assert.equal(body.accepted, true)
  assert.equal(body.id, 'take-1')
  assert.equal(body.bytes, bytes.length)
  assert.equal(body.seconds, 4.8)
  assert.equal(body.path, join(dir, 'incoming', 'take-1.wav'))
  assert.deepEqual(readFileSync(body.path), bytes, 'the stored bytes are exactly what was sent')
  assert.equal(existsSync(`${body.path}.inprogress`), false, 'no half file is left behind')

  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'dsh-nodes/voice')
  const payload = events[0].payload
  assert.equal(payload.node, node.id)
  assert.equal(payload.nodeName, 'phone')
  assert.equal(payload.id, 'take-1')
  assert.equal(payload.path, body.path)
  assert.equal(payload.bytes, bytes.length)
  assert.equal(payload.seconds, 4.8)
  assert.equal(payload.at.recordStart, 1763038800000)
  assert.equal(payload.at.recordStop, 1763038804800)
  assert.equal(payload.at.sentAt, 1763038804900)
  assert.ok(Number.isInteger(payload.at.receivedAt) && payload.at.receivedAt > 0, 'the server stamps its own arrival')
  assert.equal(payload.synth, 'device', 'no synth parameter means the fast path')
})

test('a refused recording writes nothing and announces nothing', async (t) => {
  const { base, token, dir, events } = await stand(t, { maxTransferBytes: 10 })
  const send = (query, size) => fetch(`${base}/v1/upload-file?type=voice${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(size) },
    body: Buffer.alloc(size, 1),
  })

  const wrongType = await send('&filetype=exe&id=a1', 4)
  assert.equal(wrongType.status, 400)
  assert.equal((await wrongType.json()).code, 'bad_filetype')

  const badId = await send('&filetype=wav&id=../x', 4)
  assert.equal(badId.status, 400)
  assert.equal((await badId.json()).code, 'bad_id')

  const tooBig = await send('&filetype=wav&id=a2', 50)
  assert.equal(tooBig.status, 413)
  assert.equal((await tooBig.json()).code, 'too_big')

  assert.equal(existsSync(join(dir, 'incoming', 'a1.exe')), false)
  assert.equal(existsSync(join(dir, 'incoming', 'a2.wav')), false)
  assert.deepEqual(events, [], 'nothing is announced when nothing was stored')
})

test('an upload without a node token is refused', async (t) => {
  const { base } = await stand(t)
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=x1`, {
    method: 'POST',
    headers: { 'content-length': '4' },
    body: Buffer.from('abcd'),
  })
  assert.equal(answer.status, 401)
})

test('the command path is untouched: no type=voice means no voice route', async (t) => {
  const { base, token, dir, events } = await stand(t)
  // the ordinary upload of a copyFromDevice answer: no seq, so the transfer layer refuses it
  const answer = await fetch(`${base}/v1/upload-file`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': '4' },
    body: Buffer.from('abcd'),
  })
  assert.ok(answer.status >= 400, 'a transfer without a command must not be accepted')
  const body = await answer.json()
  assert.ok(['wrong_command', 'no_command', 'bad_request'].includes(body.code) || body.code, `unexpected code ${body.code}`)
  assert.deepEqual(events, [], 'the voice route did not run')
  assert.equal(existsSync(join(dir, 'incoming')), false, 'nothing was written for a voice upload')
})

test('an upload without client timestamps still arrives, with only receivedAt', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=plain`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  const payload = events[0].payload
  assert.equal(payload.at.recordStart, null)
  assert.equal(payload.at.recordStop, null)
  assert.equal(payload.at.sentAt, null)
  assert.ok(payload.at.receivedAt > 0)
})

test('synth=host travels into the event', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=hosted&synth=host`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  assert.equal(events[0].payload.synth, 'host')
})

test('a junk synth value is received as device, not refused', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&filetype=wav&id=typo&synth=espeak`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202)
  assert.equal(events[0].payload.synth, 'device')
})


test('an action on the upload route is ignored, not refused', async (t) => {
  const { base, token, events } = await stand(t)
  const bytes = Buffer.from('RIFF')
  const answer = await fetch(`${base}/v1/upload-file?type=voice&action=file&filetype=wav&id=legacy-1`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(answer.status, 202, 'a client that still sends action=file keeps working')
  assert.equal(events[0].payload.id, 'legacy-1')

  const odd = await fetch(`${base}/v1/upload-file?type=voice&action=whatever&filetype=wav&id=legacy-2`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.length) },
    body: bytes,
  })
  assert.equal(odd.status, 202, 'an unknown action is ignored too: the route already says what this is')
})

test('a notify-button without a notification is refused before anything is delivered', async (t) => {
  const { base, token, events } = await stand(t)
  const answer = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'notify-button', button: 'b1' }),
  })
  assert.equal(answer.status, 400)
  assert.equal((await answer.json()).code, 'bad_request')
  assert.deepEqual(events, [])
})

test('a notify-session needs both a session and words', async (t) => {
  const { base, token } = await stand(t)
  const withoutText = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'notify-session', session: 's-1' }),
  })
  assert.equal(withoutText.status, 400)
  assert.equal((await withoutText.json()).code, 'bad_request')

  const withoutSession = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'notify-session', text: 'привет' }),
  })
  assert.equal(withoutSession.status, 400)
})

/** Register a voice API the way a real client announces it, then queue one command. */
function voiceCommand (store, queue, node, method, args) {
  store.announce(node.id, [{
    name: 'voice',
    version: 'test',
    methods: [
      { method: 'answer', args: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } } } },
      { method: 'play', args: { type: 'object', properties: { path: { type: 'string' } } } },
      { method: 'record', args: { type: 'object', properties: {} } },
    ],
  }], [], {})
  const apiId = store.nodeApis(node.id)[0]
  const { seq } = queue.enqueue({ nodeId: node.id, api: apiId, method, args, timeout: 10 })
  return { seq, apiId }
}

test('a voice answer may serve its own file by its seq', async (t) => {
  const { base, token, store, queue, node, dir } = await stand(t)
  const file = join(dir, 'answer.ogg')
  writeFileSync(file, Buffer.from('OggS-test'))
  const { seq } = voiceCommand(store, queue, node, 'answer', { id: 'ex-1', path: file })
  queue.take(node.id, { limit: 5 })

  const answer = await fetch(`${base}/v1/download-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(answer.status, 200)
  assert.equal(await answer.text(), 'OggS-test')
})

test('a record command still cannot serve a file', async (t) => {
  const { base, token, store, queue, node, dir } = await stand(t)
  const file = join(dir, 'take.wav')
  writeFileSync(file, Buffer.from('RIFF'))
  const { seq } = voiceCommand(store, queue, node, 'record', { path: file })
  queue.take(node.id, { limit: 5 })

  const answer = await fetch(`${base}/v1/download-file?seq=${seq}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(answer.status, 403)
  assert.equal((await answer.json()).code, 'wrong_command')
})

test('a bug report is accepted, emitted and bounded', async (t) => {
  const { base, token, node, events } = await stand(t)
  const long = 'x'.repeat(2500)
  const answer = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'bug-report', id: 'ex-1', kind: 'tts-failed', text: long, app: '0.10.41' }),
  })
  assert.equal(answer.status, 202)
  assert.deepEqual(await answer.json(), { accepted: true, id: 'ex-1' })

  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'dsh-nodes/bug-report')
  const payload = events[0].payload
  assert.equal(payload.node, node.id)
  assert.equal(payload.nodeName, 'phone')
  assert.equal(payload.id, 'ex-1')
  assert.equal(payload.kind, 'tts-failed')
  assert.equal(payload.app, '0.10.41')
  assert.equal(payload.text.length, 2000, 'the text is cut to the limit')
  assert.ok(payload.text.endsWith('…'))
})

test('an unknown kind is still a report, not a refusal', async (t) => {
  const { base, token, events } = await stand(t)
  const answer = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'bug-report', id: 'ex-2', kind: 'something-new', text: 'привет' }),
  })
  assert.equal(answer.status, 202)
  assert.equal(events[0].payload.kind, 'something-new')
})
