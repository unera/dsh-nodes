import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

test('an event without a type is a notify, and the host says so once', () => {
  const warnings = []
  const warnOnce = (message) => warnings.push(message)
  assert.deepEqual(eventTypeOf({}, { warnOnce }), { type: 'notify' })
  assert.deepEqual(eventTypeOf({ type: 'NOTIFY' }, { warnOnce }), { type: 'notify' })
  assert.equal(warnings.length, 1, 'only the call without a type reports; an explicit notify says nothing')
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
