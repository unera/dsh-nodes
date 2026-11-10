/**
 * Special rules: what the server does with a command beyond "pass through and return".
 *
 * The set is fixed: a rule appears only together with code. A node does not touch
 * the API declaration — it sends a separate `applyRules` list where it says
 * which rule to apply to which method and with which options.
 *
 * A rule belongs to the **node**, not to the API contract: the command goes to a
 * particular machine, and "how to execute" is a property of that machine. That is why
 * bindings live in their own table, while `apidef` stays a clean description of the
 * contract (including when it came from an external source such as MCP).
 *
 * @module dsh-nodes/special-rules
 */

/**
 * Registry of rules.
 *
 * `outputs` are the canonical names of what the server computes itself. Where to put
 * the value in the node answer, and whether to put it at all, is decided by the
 * binding's `retNames` option: without it the number does not land anywhere.
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
 * Which barriers to put around the command according to its rule.
 *
 * `null` — the rule is not about barriers (for example `timing`) or there is none at all.
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
 * Parse and validate the declaration's `applyRules`.
 *
 * An error here is not a reason to "skip it and move on": a rule bound to a
 * non-existent method, or with a typo in the rule name, quietly does nothing,
 * and the only way to notice it is by the absence of numbers. That is why everything that
 * does not add up is returned as a declaration error.
 *
 * @param {unknown} entries what the node sent in `applyRules`
 * @param {{resolve: (api: string, version: string|null, method: string) => ({def: object}|null)}} context
 *   `resolve` looks up the declaration by name (and version, if given) in the request body,
 *   before writing to the database: otherwise the refusal would come after the apis are already written
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
