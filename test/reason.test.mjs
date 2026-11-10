/**
 * The text of the approval question: a human decides on nothing else.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escalationReason } from '../lib/reason.mjs'

const node = { id: 5, name: 'nbw', workdir: '/home/unera/work/ai/.dsh' }

test('the question carries the node, the command, the modes and the one-off nature', () => {
  const text = escalationReason({
    node,
    args: { method: 'exec', data: { command: 'touch /etc/passwd' } },
    report: { signature: 'read-only file system' },
    current: 'ro',
    target: 'rw',
  })
  assert.match(text, /Узел nbw \(5\)/, 'узел зовём по имени и номеру')
  assert.match(text, /touch \/etc\/passwd/, 'команда должна быть видна')
  assert.match(text, /Сейчас: ro — только чтение/)
  assert.match(text, /Запрашивается: rw — запись только в \/home\/unera\/work\/ai\/\.dsh/)
  assert.match(text, /Разрешение разовое/)
  assert.match(text, /выполнится заново целиком/, 'человек должен знать, что команда пойдёт с начала')
})

test('a long command is truncated instead of breaking the dialogue', () => {
  const text = escalationReason({
    node,
    args: { data: { command: `echo ${'x'.repeat(500)}` } },
    report: { signature: 'read-only file system' },
    current: 'rw',
    target: 'full',
  })
  assert.match(text, /…/, 'должно быть многоточие')
  assert.ok(text.length < 800, `слишком длинный текст: ${text.length}`)
  assert.match(text, /без песочницы/, 'у full понятное объяснение')
})

test('without a command the text stays meaningful', () => {
  const text = escalationReason({ node, args: {}, report: {}, current: 'ro', target: 'full' })
  assert.match(text, /нет доступа/)
  assert.doesNotMatch(text, /Команда:/)
})
