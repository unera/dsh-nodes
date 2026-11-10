/**
 * The text of the approval question.
 *
 * In the dialog the human sees only `reason`, so everything the decision rests on
 * has to fit into it: who refused, what is asked to be run, how the current mode
 * differs from the requested one, and what the permission applies to.
 *
 * @module dsh-nodes/reason
 */

const MAX_COMMAND = 300

/**
 * Human-readable description of the request.
 * @param {object} options
 * @param {object} options.node node from the DB
 * @param {object} options.args tool arguments
 * @param {object} options.report sandbox report
 * @param {string} options.current current mode (`ro`/`rw`/`full`)
 * @param {string} options.target requested mode
 * @returns {string}
 */
export function escalationReason ({ node, args, report, current, target }) {
  const meaning = {
    ro: 'только чтение',
    rw: node.workdir ? `запись только в ${node.workdir}` : 'запись только в разрешённый каталог',
    full: 'без песочницы: чтение и запись где угодно, сеть открыта',
  }
  const raw = typeof args?.data?.command === 'string'
    ? args.data.command
    : (args?.data ? JSON.stringify(args.data) : '')
  const brief = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMAND)
  const lines = [`Узел ${node.name} (${node.id}) отказал в доступе: ${report.signature ?? 'нет доступа'}.`]
  if (brief) lines.push(`Команда: ${brief}${raw.length > MAX_COMMAND ? ' …' : ''}`)
  lines.push(`Сейчас: ${current} — ${meaning[current] ?? current}.`)
  lines.push(`Запрашивается: ${target} — ${meaning[target] ?? target}.`)
  lines.push('Разрешение разовое и только для этого вызова.')
  // honest about artifacts: the command runs again from scratch, it is not resumed
  lines.push('Команда выполнится заново целиком: если она успела что-то сделать до отказа, это повторится.')
  return lines.join('\n')
}
