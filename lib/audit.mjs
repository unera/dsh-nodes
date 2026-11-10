/**
 * Audit: what was done on the nodes, including sandbox denials and human decisions.
 *
 * Two tasks, two different fates for a record:
 *
 *  - **log** — long memory. A line with a syslog priority (`<6>`, `<4>`)
 *    goes to stdout, systemd files it by severity and rotates it by its own
 *    rules. It lives as long as systemd sees fit.
 *  - **database** — a shop window for the admin panel. A ring buffer: no more
 *    than `maxRows` records and no older than `maxAgeDays`. Otherwise in a month
 *    we get a database of gigabytes nobody ever looked into.
 *
 * @module dsh-nodes/audit
 */

/** Syslog priorities: systemd understands the `<N>` prefix at the start of a line. */
const PRIORITY = { debug: 7, info: 6, warn: 4, error: 3 }

/** Command length in a record: keeping more is pointless. */
const MAX_COMMAND = 1000

/**
 * One line into the log with a priority.
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
 * Record an audit event.
 *
 * @param {object} options
 * @param {object} options.store store with `writeAudit` and `trimAudit`
 * @param {object} options.config plugin settings
 * @param {object} options.event event description
 * @param {string} options.event.kind `exec` | `denied` | `approve`
 * @param {number} options.event.node node number
 * @param {string} [options.event.session] session
 * @param {string} [options.event.mode] actual or requested mode
 * @param {string} [options.event.command] command text
 * @param {number} [options.event.code] exit code
 * @param {number} [options.event.escalation] step
 * @param {string} [options.event.approved] approval id
 * @param {string} [options.event.outcome] how the approval ended
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
    // the database is a shop window, not the source of truth: its failure must not break execution
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
