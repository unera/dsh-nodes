import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildNotification, describeAnswer, notificationId, MAX_BUTTONS } from '../lib/notifications.mjs'

test('a notification limits buttons and labels', () => {
  const built = buildNotification({
    id: 'n-1',
    title: 'Перезагрузить?',
    text: 'dsh работает давно',
    buttons: ['да', 'нет', 'позже', 'четвёртая', ''],
  })
  assert.equal(built.buttons.length, MAX_BUTTONS, 'больше трёх кнопок не показываем')
  assert.deepEqual(built.buttons.map((button) => button.label), ['да', 'нет', 'позже'])
  assert.equal(built.buttons[0].id, 'b1', 'у кнопки есть машинный id, а не только подпись')
})

test('the title and the text do not stretch without a limit', () => {
  const built = buildNotification({ id: 'n-2', title: 'x'.repeat(500), text: 'y'.repeat(2000) })
  assert.ok(built.title.length <= 80)
  assert.ok(built.text.length <= 500)
})

test('an empty title is replaced with the default name', () => {
  assert.equal(buildNotification({ id: 'n-3', title: '  ', text: 'т' }).title, 'dsh-nodes')
})

test('the notification id is unique', () => {
  const ids = new Set(Array.from({ length: 200 }, () => notificationId()))
  assert.equal(ids.size, 200)
})

test('a click is translated into a label, a purpose and a session', () => {
  const described = describeAnswer({
    notification: { buttons: [{ id: 'b2', label: 'нет' }], purpose: 'спросить про перезагрузку', session: 'session-x' },
    button: 'b2',
  })
  assert.equal(described.label, 'нет')
  assert.equal(described.purpose, 'спросить про перезагрузку')
  assert.equal(described.session, 'session-x')
})
