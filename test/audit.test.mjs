/**
 * Audit: what goes to the journal, what goes to the database, and why the database does not grow.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { logLine, recordAudit } from '../lib/audit.mjs'
import { Store } from '../lib/db.mjs'

function freshStore () {
  // ':memory:' — the migrations are the same, no file needed
  const dir = mkdtempSync(join(tmpdir(), 'dsh-nodes-audit-'))
  return { store: new Store(join(dir, 'state.sqlite')), dir }
}

test('the log line carries a syslog priority', () => {
  const lines = []
  const stream = { write: (text) => lines.push(text) }
  logLine('warn', 'что-то пошло не так', stream)
  logLine('info', 'всё хорошо', stream)
  assert.deepEqual(lines, ['<4>что-то пошло не так\n', '<6>всё хорошо\n'])
})

test('a human decision and a denial reach the log with the right severity', () => {
  const { store, dir } = freshStore()
  const lines = []
  const stream = { write: (text) => lines.push(text) }
  const config = {}
  recordAudit({ store, config, stream, event: { kind: 'denied', node: 5, mode: 'rw', command: 'touch /etc/x' } })
  recordAudit({ store, config, stream, event: { kind: 'approve', node: 5, mode: 'full', outcome: 'approved' } })
  recordAudit({ store, config, stream, event: { kind: 'approve', node: 5, mode: 'full', outcome: 'cancelled' } })
  assert.match(lines[0], /^<4>\[dsh-nodes\] audit: denied node=5 mode=rw/)
  assert.match(lines[1], /^<6>.*approved/)
  assert.match(lines[2], /^<4>.*cancelled/, 'запрет человеком — предупреждение, а не info')
  assert.equal(store.readAudit(10).length, 3)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('the database is a ring buffer: old records are evicted', () => {
  const { store, dir } = freshStore()
  for (let i = 0; i < 50; i++) {
    recordAudit({ store, config: { maxAuditRows: 20 }, stream: { write: () => {} }, event: { kind: 'exec', node: 1, command: `echo ${i}` } })
  }
  const rows = store.readAudit(100)
  assert.equal(rows.length, 20, 'должно остаться ровно 20 записей')
  assert.match(rows[0].command, /echo 49/, 'свежая запись сверху')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('very old records are removed by age', () => {
  const { store, dir } = freshStore()
  store.writeAudit({ kind: 'exec', node: 1, command: 'старьё', at: Date.now() - 30 * 24 * 60 * 60 * 1000 })
  recordAudit({ store, config: { maxAuditAgeDays: 7 }, stream: { write: () => {} }, event: { kind: 'exec', node: 1, command: 'свежее' } })
  const rows = store.readAudit(10)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].command, 'свежее')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a long command is truncated and a database failure does not block the log', () => {
  const lines = []
  const stream = { write: (text) => lines.push(text) }
  const broken = { writeAudit: () => { throw new Error('база упала') }, trimAudit: () => {} }
  recordAudit({ store: broken, config: {}, stream, event: { kind: 'exec', node: 1, mode: 'full', command: 'x'.repeat(5000) } })
  assert.equal(lines.length, 1, 'журнал должен получить запись даже при сбое базы')
  assert.ok(lines[0].length < 1500, `строка слишком длинная: ${lines[0].length}`)
})
