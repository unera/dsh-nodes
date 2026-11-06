/**
 * Текст вопроса об апруве.
 *
 * В диалоге человек видит только `reason`, поэтому в него надо уложить всё, по
 * чему принимается решение: кто отказал, что просят выполнить, чем текущий
 * режим отличается от запрашиваемого и на что действует разрешение.
 *
 * @module dsh-nodes/reason
 */

const MAX_COMMAND = 300

/**
 * Человеческое описание запроса.
 * @param {object} options
 * @param {object} options.node узел из БД
 * @param {object} options.args аргументы тула
 * @param {object} options.report отчёт песочницы
 * @param {string} options.current текущий режим (`ro`/`rw`/`full`)
 * @param {string} options.target запрашиваемый режим
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
  return lines.join('\n')
}
