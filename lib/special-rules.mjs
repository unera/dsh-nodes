/**
 * Особые правила: что сервер делает с командой сверх «передать и вернуть».
 *
 * Набор фиксирован: правило появляется только вместе с кодом. Узел не трогает
 * объявление API — он присылает отдельный список `applyRules`, где говорит,
 * к какому методу какое правило применить и с какими опциями.
 *
 * Правило принадлежит **узлу**, а не контракту API: команда уходит конкретной
 * машине, и «как исполнять» — свойство этой машины. Поэтому привязки живут в
 * своей таблице, а `apidef` остаётся чистым описанием контракта (в том числе
 * когда он пришёл из внешнего источника вроде MCP).
 *
 * @module dsh-nodes/special-rules
 */

/**
 * Реестр правил.
 *
 * `outputs` — канонные имена того, что сервер считает сам. Куда положить
 * значение в ответе узла и положить ли вообще, решает опция `retNames`
 * привязки: без неё число никуда не попадает.
 */
export const RULES = {
  timing: {
    description: 'замер времени выполнения',
    outputs: ['durationMs', 'clockSkewMs'],
  },
  flushBefore: { description: 'FLUSH перед командой', outputs: [] },
  flushAfter: { description: 'FLUSH после команды', outputs: [] },
  flushAround: { description: 'FLUSH до и после', outputs: [] },
}

/**
 * Какие барьеры ставить вокруг команды по её правилу.
 *
 * `null` — правило не про барьеры (например `timing`) или его нет вовсе.
 *
 * @param {string|null} rule
 * @returns {{before: boolean, after: boolean}|null}
 */
export function flushPhases (rule) {
  if (rule === 'flushBefore') return { before: true, after: false }
  if (rule === 'flushAfter') return { before: false, after: true }
  if (rule === 'flushAround') return { before: true, after: true }
  return null
}

function isPlainRecord (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Разобрать и проверить `applyRules` объявления.
 *
 * Ошибка здесь — не повод «пропустить и пойти дальше»: правило, привязанное к
 * несуществующему методу или с опечаткой в имени правила, тихо ничего не делает,
 * и заметить это можно только по отсутствию чисел. Поэтому всё, что не сходится,
 * возвращается как ошибка объявления.
 *
 * @param {unknown} entries то, что узел прислал в `applyRules`
 * @param {{resolve: (api: string, version: string|null, method: string) => ({def: object}|null)}} context
 *   `resolve` ищет объявление по имени (и версии, если она указана) в теле запроса,
 *   до записи в базу: иначе отказ придёт уже после того, как apis записаны
 * @returns {{bindings: Array<{api: string, version: string|null, method: string, rule: string, opts: object|null}>, errors: string[], warnings: string[]}}
 */
export function parseApplyRules (entries, { resolve }) {
  const bindings = []
  const errors = []
  const warnings = []
  if (entries === undefined || entries === null) return { bindings, errors, warnings }
  if (!Array.isArray(entries)) {
    return { bindings, errors: ['applyRules должен быть массивом'], warnings }
  }
  const seen = new Set()
  entries.forEach((entry, index) => {
    const where = `applyRules[${index}]`
    if (!isPlainRecord(entry)) {
      errors.push(`${where}: должен быть объектом`)
      return
    }
    const apiName = typeof entry.api === 'string' ? entry.api.trim() : ''
    const method = typeof entry.method === 'string' ? entry.method.trim() : ''
    const rule = typeof entry.rule === 'string' ? entry.rule.trim() : ''
    if (!apiName) errors.push(`${where}: не указано имя api`)
    if (!method) errors.push(`${where}: не указан method`)
    if (!rule) errors.push(`${where}: не указано правило`)
    if (!apiName || !method || !rule) return
    if (method.startsWith('#')) {
      errors.push(`${where}: «${method}» — служебное имя, правила к нему не привязываются`)
      return
    }
    const definition = RULES[rule]
    if (!definition) {
      errors.push(`${where}: правило «${rule}» неизвестно; известны: ${Object.keys(RULES).join(', ')}`)
      return
    }
    const version = typeof entry.version === 'string' && entry.version ? entry.version : null
    const target = resolve(apiName, version, method)
    if (!target) {
      errors.push(`${where}: api «${apiName}${version ? '@' + version : ''}» не объявлен этим узлом`)
      return
    }
    const declared = (target.def?.methods ?? []).some((item) => item?.method === method)
    if (!declared) {
      errors.push(`${where}: api «${apiName}» не объявляет метод «${method}»`)
      return
    }
    const key = `${apiName}\u0000${version ?? ''}\u0000${method}`
    if (seen.has(key)) {
      errors.push(`${where}: правило для «${apiName}.${method}» уже задано выше`)
      return
    }
    seen.add(key)

    let opts = null
    const rawOpts = entry.rulesOpts ?? entry.opts ?? null
    if (rawOpts !== null && rawOpts !== undefined) {
      if (!isPlainRecord(rawOpts)) {
        errors.push(`${where}: rulesOpts должен быть объектом`)
        return
      }
      const unknown = Object.keys(rawOpts).filter((option) => option !== 'retNames')
      if (unknown.length) {
        errors.push(`${where}: неизвестные опции правила «${rule}»: ${unknown.join(', ')}; известны: retNames`)
        return
      }
      if (rawOpts.retNames !== undefined && rawOpts.retNames !== null) {
        if (!isPlainRecord(rawOpts.retNames)) {
          errors.push(`${where}: rulesOpts.retNames должен быть объектом «канонное имя → поле в ответе»`)
          return
        }
        const retNames = {}
        for (const [canonical, field] of Object.entries(rawOpts.retNames)) {
          if (!definition.outputs.includes(canonical)) {
            const known = definition.outputs.length ? definition.outputs.join(', ') : '—'
            errors.push(`${where}: правило «${rule}» не считает «${canonical}»; считается: ${known}`)
            return
          }
          if (field === null) continue
          if (typeof field !== 'string' || !field.trim()) {
            errors.push(`${where}: retNames.${canonical} должен быть строкой или null`)
            return
          }
          retNames[canonical] = field.trim()
        }
        if (Object.keys(retNames).length) opts = { retNames }
      }
    }
    if (rule === 'timing' && !opts?.retNames) {
      warnings.push(`applyRules[${index}]: правило timing привязано к «${apiName}.${method}», но retNames пуст — замер считается и никуда не кладётся`)
    }
    bindings.push({ api: apiName, version, method, rule, opts })
  })
  return { bindings, errors, warnings }
}
