/**
 * Notifications to the device, with buttons.
 *
 * Built so that the client cannot be trusted with interpreting the meaning:
 * the device shows the title, the text and the buttons, and on a press it answers
 * only "such-and-such button was pressed" plus the notification number. What that
 * means and which session to put it into is decided by the server from its own record.
 *
 * @module dsh-nodes/notifications
 */

/** How many buttons we allow: more does not fit on the screen and is not needed. */
export const MAX_BUTTONS = 3

/** Build a notification for sending to the device. */
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

/** Notification number: short and unique, good for dedup on the client. */
export function notificationId () {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Human-readable answer to a press: what happened and what comes next. */
export function describeAnswer ({ notification, button }) {
  const label = notification?.buttons?.find((item) => item.id === button)?.label ?? button ?? 'кнопка'
  return { label, purpose: notification?.purpose ?? null, session: notification?.session ?? null }
}
