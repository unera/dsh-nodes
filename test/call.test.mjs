import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Queue } from '../lib/queue.mjs'
import { createNodeCaller } from '../lib/call.mjs'
import { acceptVoiceWant, voiceWantOf } from '../lib/server.mjs'

/** A store that answers the four questions the caller asks, and nothing else. */
function stubStore ({ nodes = [], apis = [], held = {} } = {}) {
  return {
    node: (id) => nodes.find((item) => item.id === id) ?? null,
    nodeByAlias: (alias) => nodes.find((item) => item.alias === alias) ?? null,
    nodeApis: (id) => held[id] ?? [],
    api: (id) => apis.find((item) => item.id === id) ?? null,
  }
}

const VOICE = {
  id: 440,
  name: 'voice',
  version: '1.0',
  methods: [
    {
      method: 'record',
      args: {
        type: 'object',
        properties: { mode: { type: 'string' }, maxSeconds: { type: 'number' } },
        additionalProperties: false,
      },
    },
  ],
}

/** Let the queued command be answered the way a node would answer it. */
function answerNext (queue, nodeId, payload) {
  const command = (queue.take(nodeId, { limit: 1 }).commands ?? [])[0]
  assert.ok(command, 'a command should have been queued')
  queue.close(nodeId, command.seq, {
    ok: true,
    status: 'ok',
    results: [{ type: 'text', text: JSON.stringify(payload) }],
  })
  return command
}

test('a plugin call reaches the queue with the declared arguments', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const store = stubStore({
    nodes: [{ id: 19, name: 'A059P', alias: 'phone', default_timeout: 30 }],
    apis: [VOICE],
    held: { 19: [440] },
  })
  const caller = createNodeCaller({ store, queue, config: {}, notify: () => {} })

  const pending = caller.call('phone', 'voice', 'record', { mode: 'toggle', maxSeconds: 20 }, { timeout: 10 })
  const command = answerNext(queue, 19, { path: '/storage/emulated/0/DSH/voice/x.wav', seconds: 1.4 })
  const outcome = await pending

  assert.equal(command.api, 440)
  assert.equal(command.method, 'record')
  assert.deepEqual(command.args, { mode: 'toggle', maxSeconds: 20 })
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.payload.path, '/storage/emulated/0/DSH/voice/x.wav')
  assert.equal(outcome.payload.seconds, 1.4)
})

test('an unknown node and an unknown api are refusals, not exceptions', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const store = stubStore({ nodes: [{ id: 19, name: 'A059P', alias: 'phone' }], apis: [], held: { 19: [] } })
  const caller = createNodeCaller({ store, queue, config: {} })

  const noNode = await caller.call('tablet', 'voice', 'record', {})
  assert.equal(noNode.status, 'error')
  assert.equal(noNode.code, 'unknown_node')

  const noApi = await caller.call('phone', 'voice', 'record', {})
  assert.equal(noApi.status, 'error')
  assert.equal(noApi.code, 'unknown_api')
})

test('arguments are checked against the declared schema before anything is queued', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 5, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const store = stubStore({
    nodes: [{ id: 19, name: 'A059P', alias: 'phone' }],
    apis: [VOICE],
    held: { 19: [440] },
  })
  const caller = createNodeCaller({ store, queue, config: {} })

  const refused = await caller.call('phone', 'voice', 'record', { maxSeconds: 'много' })
  assert.equal(refused.status, 'error')
  assert.equal(refused.code, 'bad_args')
  assert.equal(queue.info(19).max_commandno, 0, 'nothing should have been queued')
})

test('a node that never answers ends as an error outcome, not a hang', async () => {
  const queue = new Queue({ epoch: 1, defaultTimeout: 1, maxBatch: 5, maxQueue: 100, commandTtl: 300 })
  const store = stubStore({
    nodes: [{ id: 19, name: 'A059P', alias: 'phone' }],
    apis: [VOICE],
    held: { 19: [440] },
  })
  const caller = createNodeCaller({ store, queue, config: {} })

  const outcome = await caller.call('phone', 'voice', 'record', { mode: 'ptt' }, { timeout: 1 })
  assert.equal(outcome.status, 'timeout')
  assert.equal(outcome.code, 'timeout')
})

test('a voice request is recognised and emits one event without touching a session', () => {
  const events = []
  const services = { emit: (name, payload) => events.push({ name, payload }) }
  const want = voiceWantOf({ voice: { want: 'record', mode: 'toggle' } })
  assert.deepEqual(want, { mode: 'toggle' })

  const answer = acceptVoiceWant({
    node: { id: 19, name: 'A059P', events_enabled: 1 },
    want,
    sessionId: null,
    services,
    log: () => {},
  })

  assert.equal(answer.status, 202)
  assert.deepEqual(answer.payload, { accepted: true, device: 'A059P', mode: 'toggle' })
  assert.deepEqual(events, [{
    name: 'dsh-nodes/voice-want',
    payload: { node: 19, nodeName: 'A059P', mode: 'toggle', sessionId: null },
  }])
})

test('an ordinary event body is not mistaken for a voice request', () => {
  assert.equal(voiceWantOf({ text: 'привет' }), null)
  assert.equal(voiceWantOf({ voice: { want: 'something-else' } }), null)
  assert.equal(voiceWantOf(null), null)
})

test('a device with events disabled is refused even for a voice request', () => {
  const answer = acceptVoiceWant({
    node: { id: 19, name: 'A059P', events_enabled: 0 },
    want: { mode: 'ptt' },
    sessionId: null,
    services: { emit: () => { throw new Error('must not emit') } },
  })
  assert.equal(answer.status, 403)
  assert.equal(answer.payload.code, 'events_disabled')
})
