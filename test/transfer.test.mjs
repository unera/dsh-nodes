/**
 * Передача файлов по HTTP: разрешение даёт команда, путь берётся из неё.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { Readable } from 'node:stream'

import { Queue } from '../lib/queue.mjs'
import { commandMode, inspect, receive, requireCommand, TransferError } from '../lib/transfer.mjs'

let dir
before(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-transfer-')) })
after(() => rmSync(dir, { recursive: true, force: true }))

const node = { id: 1, name: 'nbw' }

test('без выданной команды передача запрещена', () => {
  const queue = new Queue({ epoch: 1 })
  assert.throws(
    () => requireCommand({ queue, node, method: 'files.upload', seq: '7' }),
    (error) => error instanceof TransferError && error.status === 403 && /не выдавалась/.test(error.message),
  )
})

test('чужая команда не подходит: метод должен совпадать', () => {
  const queue = new Queue({ epoch: 1 })
  const { seq } = queue.enqueue({ nodeId: 1, api: 9, method: 'files.download', args: { path: '/tmp/x' }, timeout: 30 })
  assert.throws(
    () => requireCommand({ queue, node, method: 'files.upload', seq }),
    (error) => error instanceof TransferError && error.status === 403 && /передача требует files.upload/.test(error.message),
  )
})

test('загрузка: тело пишется в .inprogress, сверяется sha256 и режим', async () => {
  const queue = new Queue({ epoch: 1 })
  const target = join(dir, 'uploaded.bin')
  const body = Buffer.from([0, 1, 2, 250, 251, 13, 10])
  const { seq } = queue.enqueue({
    nodeId: 1, api: 9, method: 'files.upload',
    args: { path: target, size: body.length }, timeout: 30,
  })
  const command = requireCommand({ queue, node, method: 'files.upload', seq })
  // тело отдаём потоком, как это делает http-сервер
  const stream = Readable.from([body])
  const result = await receive({
    stream,
    headers: { 'content-length': String(body.length) },
    command,
    mode: commandMode(command, '644'),
    config: {},
  })
  assert.equal(result.bytes, body.length)
  assert.equal(result.mode, 0o644)
  assert.deepEqual(readFileSync(target), body, 'байты должны совпасть')
})

test('размер из команды не совпал с content-length — отказ 412 и файла нет', async () => {
  const queue = new Queue({ epoch: 1 })
  const target = join(dir, 'mismatch.bin')
  const { seq } = queue.enqueue({ nodeId: 1, api: 9, method: 'files.upload', args: { path: target, size: 99 }, timeout: 30 })
  const command = requireCommand({ queue, node, method: 'files.upload', seq })
  const body = Buffer.from('abc')
  await assert.rejects(
    () => receive({ stream: Readable.from([body]), headers: { 'content-length': '3' }, command, mode: null, config: {} }),
    (error) => error.status === 412 && /разошлись/.test(error.message),
  )
  assert.throws(() => readFileSync(target))
})

test('скачивание несуществующего файла — 404 с текстом', () => {
  assert.throws(
    () => inspect(join(dir, 'нет-такого')),
    (error) => error.status === 404 && /скачивать нечего/.test(error.message),
  )
})

test('файл на месте: размер известен', () => {
  const path = join(dir, 'present.txt')
  writeFileSync(path, 'hello')
  assert.equal(inspect(path).bytes, 5)
})
