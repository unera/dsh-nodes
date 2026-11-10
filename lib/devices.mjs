/**
 * Device events: put a record into a session and wake the turn up.
 *
 * Built the same way as cron in DSH: take the session agent through the controller,
 * hand it a user message with our `source.kind`, then flush the journal to
 * disk. The key difference from faking a human is `kind`: the message is marked as
 * coming from a device, and the model sees that without having to guess.
 *
 * @module dsh-nodes/devices
 */

/**
 * Message text: first why the event was wanted, then the fact itself.
 *
 * `purpose` comes from the server, not from the client: the device cannot be
 * trusted with interpreting the meaning, it only reports "button N was pressed".
 */
export function renderDeviceEvent ({ node, button, text, purpose, at }) {
  const parts = []
  if (purpose) parts.push(purpose)
  // "event" says nothing: we write what exactly happened
  const what = button
    ? `устройство ${node}: нажата кнопка «${button}»`
    : `сообщение с устройства ${node}`
  parts.push(what)
  if (text) parts.push(text)
  if (at) parts.push(`(${at})`)
  return parts.join('\n')
}

/**
 * Put the event into a session and wake the turn up.
 *
 * @param {object} options
 * @param {object} options.ctx plugin context (sessions, sessionController)
 * @param {string} options.sessionId
 * @param {string} options.text ready message text
 * @param {object} options.source origin fields: node, button, identifier
 * @returns {Promise<{ok: true, session: string} | {ok: false, status: number, message: string}>}
 */
export async function deliverEvent ({ ctx, sessionId, text, source }) {
  const controller = ctx?.sessionController
  const sessions = ctx?.sessions
  if (!controller?.resolveAgent || !sessions?.flush) {
    return { ok: false, status: 503, message: 'DSH не отдаёт сервисы сессий: событие некуда положить' }
  }
  let resolved
  try {
    resolved = await controller.resolveAgent(sessionId)
  } catch (error) {
    return { ok: false, status: 500, message: `DSH не отдал сессию: ${error?.message ?? error}` }
  }
  if (!resolved || resolved.error || !resolved.agent) {
    // do not pass our guess off as fact: we show what exactly DSH answered
    const reason = resolved?.error?.message ?? (resolved?.error ? String(resolved.error) : null)
    return {
      ok: false,
      status: 404,
      message: `сессия ${sessionId} не найдена${reason ? `: ${reason}` : ''}`,
    }
  }
  const message = await buildMessage(text, source)
  if (!message) {
    return { ok: false, status: 500, message: 'не смог собрать сообщение: DSH не отдал конструктор' }
  }
  try {
    resolved.agent.followup(message)
  } catch (error) {
    return { ok: false, status: 500, message: `сессия не приняла событие: ${error?.message ?? error}` }
  }
  // We do not wait for the flush: `followup` may start a whole turn, and then
  // the answer to the device would be delayed by the whole model run. The client
  // only needs to know that the event was accepted.
  Promise.resolve(sessions.flush(resolved.agent.session)).catch(() => {})
  return { ok: true, session: sessionId }
}

/** We build the message through DSH if it offers a constructor; otherwise by hand. */
async function buildMessage (text, source) {
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (typeof mod.createUserMessage === 'function') {
      return mod.createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'dsh-nodes', ...source },
      })
    }
  } catch {}
  // fallback: role user and the origin mark in source — DSH is obliged
  // to pass unknown source kinds through
  return {
    id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-nodes', ...source },
  }
}
