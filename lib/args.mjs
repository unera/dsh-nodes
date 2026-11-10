/**
 * Validation of call arguments against a method schema from the catalog.
 *
 * Lives apart from HTTP and from tools: one and the same rule must apply
 * in `nodes_call`, and in the future admin-API, and in tests (plan §5.2).
 *
 * @module dsh-nodes/args
 */

/** Argument rejection: a code from the closed vocabulary plus the exact text. */
export class ArgsError extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Check `data` against an API method.
 * @param {{id: number, methods: object[]}} def catalog entry
 * @param {string} method method name
 * @param {object} data arguments from the model
 * @returns {object} method specification
 * @throws {ArgsError}
 */
export function checkArgs (def, method, data) {
  const methods = def?.methods ?? []
  const spec = methods.find((m) => m.method === method)
  if (!spec) {
    const known = methods.map((m) => m.method).join(', ')
    throw new ArgsError('unknown_method', `unknown method "${method}" in api ${def.id} (есть: ${known})`)
  }
  const schema = spec.args ?? {}
  const properties = schema.properties ?? {}
  const required = schema.required ?? []
  const args = data ?? {}
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new ArgsError('bad_args', 'bad args: data должен быть объектом')
  }
  for (const key of required) {
    if (args[key] === undefined) throw new ArgsError('bad_args', `bad args: ${key} обязателен`)
  }
  for (const [key, rule] of Object.entries(properties)) {
    const value = args[key]
    if (value === undefined) continue
    if (rule.type === 'string' && typeof value !== 'string') {
      throw new ArgsError('bad_args', `bad args: ${key} должен быть строкой`)
    }
    if (rule.type === 'number' && typeof value !== 'number') {
      throw new ArgsError('bad_args', `bad args: ${key} должен быть числом`)
    }
    if (rule.type === 'boolean' && typeof value !== 'boolean') {
      throw new ArgsError('bad_args', `bad args: ${key} должен быть boolean`)
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      throw new ArgsError('bad_args', `bad args: ${key} ожидает одно из [${rule.enum.join(', ')}], получено ${JSON.stringify(value)}`)
    }
  }
  return spec
}
