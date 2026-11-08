/**
 * Очередь: выдача, закрытие, поиск по номеру.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Queue } from '../lib/queue.mjs'


test('issued находит выданную команду по номеру', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'files.upload', args: { path: '/tmp/x' }, timeout: 30 })
  const found = queue.issued(1, seq)
  assert.equal(found.method, 'files.upload')
  assert.deepEqual(found.args, { path: '/tmp/x' })
  assert.equal(queue.issued(1, seq + 999), null, 'чужой номер не выдавали')
})
