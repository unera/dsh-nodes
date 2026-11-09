import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildNotification, describeAnswer, notificationId, MAX_BUTTONS } from '../lib/notifications.mjs'

test('уведомление ограничивает кнопки и подписи', () => {
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

test('заголовок и текст не растягиваются без предела', () => {
  const built = buildNotification({ id: 'n-2', title: 'x'.repeat(500), text: 'y'.repeat(2000) })
  assert.ok(built.title.length <= 80)
  assert.ok(built.text.length <= 500)
})

test('пустой заголовок заменяется именем по умолчанию', () => {
  assert.equal(buildNotification({ id: 'n-3', title: '  ', text: 'т' }).title, 'dsh-nodes')
})

test('номер уведомления уникален', () => {
  const ids = new Set(Array.from({ length: 200 }, () => notificationId()))
  assert.equal(ids.size, 200)
})

test('нажатие переводится в подпись, смысл и сессию', () => {
  const described = describeAnswer({
    notification: { buttons: [{ id: 'b2', label: 'нет' }], purpose: 'спросить про перезагрузку', session: 'session-x' },
    button: 'b2',
  })
  assert.equal(described.label, 'нет')
  assert.equal(described.purpose, 'спросить про перезагрузку')
  assert.equal(described.session, 'session-x')
})
