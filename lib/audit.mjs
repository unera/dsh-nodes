/**
 * Аудит: что делали на узлах, включая отказы песочницы и решения человека.
 *
 * Две задачи, две разные судьбы записи:
 *
 *  - **журнал** — долгая память. Строка с syslog-приоритетом (`<6>`, `<4>`)
 *    уходит в stdout, systemd раскладывает по важности и ротирует по своим
 *    правилам. Живёт, пока systemd считает нужным.
 *  - **база** — витрина для админки. Кольцевой буфер: не больше `maxRows`
 *    записей и не старше `maxAgeDays`. Иначе через месяц получим базу на
 *    гигабайты, в которую никто не смотрел.
 *
 * @module dsh-nodes/audit
 */

/** Приоритеты syslog: systemd понимает префикс `<N>` в начале строки. */
const PRIORITY = { debug: 7, info: 6, warn: 4, error: 3 }

/** Длина команды в записи: длиннее хранить бессмысленно. */
const MAX_COMMAND = 1000

/**
 * Одна строка в журнал с приоритетом.
 * @param {'info'|'warn'|'error'} level
 * @param {string} text
 * @param {NodeJS.WriteStream} [stream]
 */
export function logLine (level, text, stream = process.stdout) {
  const priority = PRIORITY[level] ?? PRIORITY.info
  try {
    stream.write(`<${priority}>${text}\n`)
  } catch {}
}

/**
 * Записать событие аудита.
 *
 * @param {object} options
 * @param {object} options.store стор с `writeAudit` и `trimAudit`
 * @param {object} options.config настройки плагина
 * @param {object} options.event описание события
 * @param {string} options.event.kind `exec` | `denied` | `approve`
 * @param {number} options.event.node номер узла
 * @param {string} [options.event.session] сессия
 * @param {string} [options.event.mode] фактический или запрошенный режим
 * @param {string} [options.event.command] текст команды
 * @param {number} [options.event.code] код возврата
 * @param {number} [options.event.escalation] ступень
 * @param {string} [options.event.approved] id подтверждения
 * @param {string} [options.event.outcome] чем кончился апрув
 */
export function recordAudit ({ store, config, event, stream }) {
  const command = String(event.command ?? '').slice(0, MAX_COMMAND)
  const row = { ...event, command, at: Date.now() }

  try {
    store.writeAudit(row)
    store.trimAudit({
      maxRows: config.maxAuditRows ?? 2000,
      maxAgeMs: (config.maxAuditAgeDays ?? 7) * 24 * 60 * 60 * 1000,
    })
  } catch {
    // база — витрина, а не источник истины: её сбой не должен ломать исполнение
  }

  const level = event.kind === 'denied' ? 'warn' : event.kind === 'approve' && event.outcome !== 'approved' ? 'warn' : 'info'
  const parts = [
    `[dsh-nodes] audit: ${event.kind}`,
    `node=${event.node}`,
    event.session ? `session=${event.session}` : null,
    event.mode ? `mode=${event.mode}` : null,
    typeof event.code === 'number' ? `code=${event.code}` : null,
    event.escalation ? `escalation=${event.escalation}` : null,
    event.approved ? `approved=${event.approved}` : null,
    event.outcome ? `outcome=${event.outcome}` : null,
    command ? `command=${command.replace(/\s+/g, ' ')}` : null,
  ].filter(Boolean)
  logLine(level, parts.join(' '), stream)
}
