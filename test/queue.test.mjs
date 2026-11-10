/**
 * Очередь: выдача, закрытие, поиск по номеру.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

import { Queue } from '../lib/queue.mjs'


test('issued находит выданную команду по номеру', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'files.upload', args: { path: '/tmp/x' }, timeout: 30 })
  const found = queue.issued(1, seq)
  assert.equal(found.method, 'files.upload')
  assert.deepEqual(found.args, { path: '/tmp/x' })
  assert.equal(queue.issued(1, seq + 999), null, 'чужой номер не выдавали')
})

test('ждущую команду отменять не нужно: узел её не видел', () => {
  // проверяем правило, а не детали: CANCEL — только для взятых в работу
  const source = readFileSync(new URL('../lib/queue.mjs', import.meta.url), 'utf8')
  const matches = source.match(/command\.status === 'processing'/g) ?? []
  assert.ok(matches.length >= 2, 'обе точки закрытия должны проверять, что команда в работе')
})

test('flushAround: барьер до, барьер после, команда — между ними', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({
    nodeId: 1, api: 7, method: 'chdir', args: {}, flushBefore: true, flushAfter: true,
  })

  const first = queue.take(1, { limit: 5 }).commands
  assert.equal(first.length, 1, 'барьер не должен уезжать в пачке с другими командами')
  assert.equal(first[0].method, '#INTERNAL.FLUSH')
  assert.equal(first[0].api, -1, 'барьер — служебная команда под псевдо-API')
  assert.equal(first[0].seq, seq - 1, 'номер барьера идёт раньше номера команды')

  assert.deepEqual(queue.take(1).commands, [], 'пока барьер висит, за ним ничего не выдаётся')

  queue.close(1, first[0].seq, { ok: true })
  const middle = queue.take(1).commands
  assert.equal(middle.length, 1)
  assert.equal(middle[0].method, 'chdir')
  assert.equal(middle[0].seq, seq, 'команда получила свой номер после барьера')

  // второй барьер выдаётся сам (он же должен доехать до узла), но за ним уже
  // ничего нет — и всё, что встало бы после него, ждало бы его ответа
  queue.close(1, seq, { ok: true })
  const last = queue.take(1, { limit: 5 }).commands
  assert.equal(last.length, 1, 'второй барьер уходит один')
  assert.equal(last[0].method, '#INTERNAL.FLUSH')
  assert.equal(last[0].seq, seq + 1)
})

test('flushBefore и flushAfter ставят по одному барьеру', () => {
  const queue = new Queue({ epoch: 1 })
  const before = queue.enqueue({ nodeId: 1, api: 7, method: 'a', args: {}, flushBefore: true })
  const after = queue.enqueue({ nodeId: 1, api: 7, method: 'b', args: {}, flushAfter: true })

  const beforeBarrier = queue.issued(1, before.seq - 1)
  assert.equal(beforeBarrier.method, '#INTERNAL.FLUSH', 'перед командой — барьер')
  assert.equal(beforeBarrier.seq, 1)
  assert.equal(before.seq, 2)

  const afterBarrier = queue.issued(1, after.seq + 1)
  assert.equal(afterBarrier.method, '#INTERNAL.FLUSH', 'за командой — барьер')
  assert.equal(after.seq, 3, 'номер команды между барьерами')
  assert.equal(afterBarrier.seq, 4)
})

test('без правила барьеров нет', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: {} })
  assert.equal(seq, 1, 'первая команда узла получает первый номер')
  assert.deepEqual(queue.take(1, { limit: 5 }).commands.map((command) => command.method), ['exec'])
})

test('барьер живёт меньше служебных суток: он держит очередь', () => {
  const queue = new Queue({ epoch: 1, barrierTimeout: 90 })
  queue.enqueue({ nodeId: 1, api: 7, method: 'chdir', args: {}, flushBefore: true })
  const [barrier] = queue.take(1).commands
  assert.equal(barrier.timeout, 90, 'срок барьера — свой, а не суточный, как у CANCEL')
})

test('потерянный барьер не держит очередь вечно и попадает в журнал', () => {
  const queue = new Queue({ epoch: 1, barrierTimeout: 1 })
  const log = []
  queue.setControlLog((nodeId, method, args, outcome) => log.push({ nodeId, method, outcome }))
  queue.enqueue({ nodeId: 1, api: 7, method: 'chdir', args: {}, flushBefore: true })
  const [barrier] = queue.take(1).commands
  const removed = queue.sweep(Date.now() + 10 * 60 * 1000)
  assert.ok(removed >= 1, 'барьер должен сниматься уборкой')
  assert.equal(log.length, 1)
  assert.equal(log[0].method, '#INTERNAL.FLUSH')
  assert.equal(log[0].outcome.code, 'lost')
  assert.equal(queue.info(1).queued, 0)
  void barrier
})

test('аборт вызова просит узел остановиться', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { command: 'sleep 120' } })
  // команду уже выдали: она в работе на узле
  assert.equal(queue.take(1).commands[0].seq, seq)
  assert.equal(queue.cancel(1, seq), true)

  const next = queue.take(1, { limit: 5 }).commands
  assert.equal(next.length, 1, 'узел должен получить управляющую команду')
  assert.equal(next[0].method, '#INTERNAL.CANCEL')
  assert.equal(next[0].api, -1)
  assert.equal(next[0].args.seq, seq, 'отменяем именно ту команду, которую взяли')
})

test('аборт ждущей команды не шлёт CANCEL: узел её не видел', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: {} })
  assert.equal(queue.cancel(1, seq), true)
  assert.deepEqual(queue.take(1).commands, [], 'незачем будить узел ради того, чего он не брал')
})

test('поздний результат после таймаута — это «уже закрыта», а не «нет команды»', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: {}, timeout: 0.01 })
  queue.take(1)
  const node = queue.nodes.get(1)
  const command = node.queue.find((item) => item.seq === seq)
  command.takenAt = Date.now() - 60_000
  queue.sweep(Date.now() + 70_000)
  assert.equal(queue.close(1, seq, { ok: true, results: [] }), 'already')
})

test('управляющая команда будит узел, а не ждёт, пока он проснётся сам', () => {
  const queue = new Queue({ epoch: 1 })
  const woken = []
  queue.setNotify((nodeId) => woken.push(nodeId))
  queue.control(1, '#INTERNAL.CANCEL', { seq: 7, reason: 'timeout' })
  assert.deepEqual(woken, [1], 'без побудки отмена лежит в очереди до случайного просыпания')
})

test('отмена обгоняет пользовательскую работу в очереди', () => {
  const queue = new Queue({ epoch: 1 })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { n: 1 } })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { n: 2 } })
  const cancelSeq = queue.control(1, '#INTERNAL.CANCEL', { seq: 1, reason: 'timeout' })

  const batch = queue.take(1, { limit: 5 }).commands
  assert.equal(batch[0].seq, cancelSeq, 'управляющая команда идёт первой')
  assert.equal(batch[0].method, '#INTERNAL.CANCEL')
  assert.deepEqual(batch.slice(1).map((command) => command.args.n), [1, 2], 'остальное — в порядке постановки')
})

test('отмена проходит сквозь барьер, а обычная работа за ним стоит', () => {
  const queue = new Queue({ epoch: 1 })
  // барьер перед командой «b» (flushBefore), затем ещё одна обычная команда
  queue.enqueue({ nodeId: 1, api: 7, method: 'a', args: {} })
  queue.enqueue({ nodeId: 1, api: 7, method: 'b', args: {}, flushBefore: true })
  queue.enqueue({ nodeId: 1, api: 7, method: 'c', args: {} })

  const cancelSeq = queue.control(1, '#INTERNAL.CANCEL', { seq: 1, reason: 'abort' })
  const batch = queue.take(1, { limit: 5 }).commands
  assert.equal(batch[0].seq, cancelSeq, 'приоритетная команда обгоняет всё')
  assert.deepEqual(batch.slice(1).map((command) => command.method), ['a'], 'до барьера обычная работа идёт')

  // барьер выдан отдельно, за ним ничего
  queue.close(1, batch[0].seq, { ok: true })
  queue.close(1, batch[1].seq, { ok: true })
  const barrier = queue.take(1, { limit: 5 }).commands
  assert.equal(barrier.length, 1)
  assert.equal(barrier[0].method, '#INTERNAL.FLUSH')
})

test('потолок очереди не распространяется на управляющие команды, а обычным говорит по-человечески', async () => {
  const queue = new Queue({ epoch: 1, maxQueue: 2 })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { n: 1 } })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { n: 2 } })
  const overflow = queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: { n: 3 } })
  assert.equal(overflow.seq, null, 'третья не влезает')
  const outcome = await overflow.promise
  assert.equal(outcome.code, 'queue_full')
  assert.match(outcome.message, /перегружен/, 'модели надо объяснить, что случилось')
  assert.match(outcome.message, /сбавь темп/)

  // отмена в забитую очередь всё равно проходит
  const cancelSeq = queue.control(1, '#INTERNAL.CANCEL', { seq: 1, reason: 'abort' })
  assert.ok(cancelSeq, 'управляющая команда не подчиняется потолку')
})

test('take и info называют номер max_commandno', () => {
  const queue = new Queue({ epoch: 1 })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: {} })
  queue.enqueue({ nodeId: 1, api: 7, method: 'exec', args: {} })
  assert.equal(queue.info(1).max_commandno, 2)
  const taken = queue.take(1, { limit: 1 })
  assert.equal(taken.max_commandno, 2, 'номер выдаётся вместе с пачкой: клиенту не надо ничего считать')
  assert.equal(taken.commands.length, 1)
})

test('аборт закрывает висящий вопрос человеку, а не только процессы', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({
    nodeId: 1, api: -1, method: '#INTERNAL.APPROVE', args: { id: 'x', text: 't' }, timeout: 86400, priority: 5,
  })
  assert.equal(queue.take(1).commands[0].seq, seq, 'вопрос ушёл на узел')
  assert.equal(queue.cancel(1, seq), true)

  const next = queue.take(1, { limit: 5 }).commands
  assert.equal(next.length, 1)
  assert.equal(next[0].method, '#INTERNAL.CANCEL', 'узел должен получить просьбу закрыть вопрос')
  assert.equal(next[0].args.seq, seq)
})

test('сама отмена себя не отменяет: рекурсии нет', () => {
  const queue = new Queue({ epoch: 1 })
  const seq = queue.control(1, '#INTERNAL.CANCEL', { seq: 1, reason: 'timeout' })
  queue.take(1)               // отмена ушла на узел и висит
  const before = queue.info(1).queued
  queue.cancel(1, seq)
  assert.equal(queue.info(1).queued, before - 1, 'команда снята и второй отмены не породила')
})
