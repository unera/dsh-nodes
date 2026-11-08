/**
 * События устройств: положить запись в сессию и разбудить ход.
 *
 * Устроено так же, как cron в DSH: взять агента сессии через контроллер,
 * отдать ему user-сообщение с нашим `source.kind`, затем сбросить журнал на
 * диск. Ключевое отличие от подделки человека — `kind`: сообщение помечено как
 * пришедшее от устройства, и модель видит это без догадок.
 *
 * @module dsh-nodes/devices
 */

/**
 * Текст сообщения: сначала то, зачем событие было нужно, потом сам факт.
 *
 * `purpose` приходит с сервера, а не с клиента: устройству нельзя доверять
 * трактовку смысла, оно сообщает только «нажата кнопка N».
 */
export function renderDeviceEvent ({ node, button, text, purpose, at }) {
  const parts = []
  if (purpose) parts.push(purpose)
  const what = button ? `устройство ${node}: нажата кнопка «${button}»` : `устройство ${node}: событие`
  parts.push(what)
  if (text) parts.push(text)
  if (at) parts.push(`(${at})`)
  return parts.join('\n')
}

/**
 * Положить событие в сессию и разбудить ход.
 *
 * @param {object} options
 * @param {object} options.ctx контекст плагина (sessions, sessionController)
 * @param {string} options.sessionId
 * @param {string} options.text готовый текст сообщения
 * @param {object} options.source поля происхождения: узел, кнопка, идентификатор
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
    return { ok: false, status: 500, message: `не смог найти сессию: ${error?.message ?? error}` }
  }
  if (!resolved || resolved.error || !resolved.agent) {
    return { ok: false, status: 404, message: `сессии ${sessionId} больше нет: возможно, её удалили` }
  }
  const message = await buildMessage(text, source)
  if (!message) {
    return { ok: false, status: 500, message: 'не смог собрать сообщение: DSH не отдал конструктор' }
  }
  try {
    resolved.agent.followup(message)
    const flushed = await sessions.flush(resolved.agent.session)
    if (flushed === false) return { ok: false, status: 500, message: 'журнал сессии не подтвердил запись' }
  } catch (error) {
    return { ok: false, status: 500, message: `сессия не приняла событие: ${error?.message ?? error}` }
  }
  return { ok: true, session: sessionId }
}

/** Сообщение собираем через DSH, если он отдаёт конструктор; иначе — руками. */
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
  // запасной путь: роль user и метка происхождения в source — DSH обязан
  // пропускать незнакомые виды источников
  return {
    id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-nodes', ...source },
  }
}
