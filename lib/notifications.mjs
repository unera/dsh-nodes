/**
 * Уведомления на устройство с кнопками.
 *
 * Устроено так, чтобы клиенту нельзя было доверять трактовку смысла:
 * устройство показывает заголовок, текст и кнопки, а на нажатие отвечает
 * только «нажата кнопка такая-то» и номер уведомления. Что это значит и в
 * какую сессию положить — решает сервер по своей записи.
 *
 * @module dsh-nodes/notifications
 */

/** Сколько кнопок разрешаем: больше на экране не помещается и не нужно. */
export const MAX_BUTTONS = 3

/** Собрать уведомление к отправке на устройство. */
export function buildNotification ({ id, title, text, buttons = [], purpose = null }) {
  const prepared = buttons
    .filter((label) => typeof label === 'string' && label.trim())
    .slice(0, MAX_BUTTONS)
    .map((label, index) => ({ id: `b${index + 1}`, label: label.trim().slice(0, 40) }))
  return {
    id,
    title: (title ?? '').trim().slice(0, 80) || 'dsh-nodes',
    text: (text ?? '').trim().slice(0, 500),
    buttons: prepared,
    purpose: purpose ? String(purpose).slice(0, 500) : null,
  }
}

/** Номер уведомления: короткий и уникальный, годится для дедупа на клиенте. */
export function notificationId () {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Человеческий ответ на нажатие: что произошло и что дальше. */
export function describeAnswer ({ notification, button }) {
  const label = notification?.buttons?.find((item) => item.id === button)?.label ?? button ?? 'кнопка'
  return { label, purpose: notification?.purpose ?? null, session: notification?.session ?? null }
}
