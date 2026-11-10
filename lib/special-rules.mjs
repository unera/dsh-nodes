/**
 * Особые правила: что сервер делает с командой сверх «передать и вернуть».
 *
 * Набор фиксирован: правило появляется только вместе с кодом. Клиент merely
 * объявляет, какие его методы хотят какое правило; требование к самому методу
 * проверяет сервер.
 *
 * @module dsh-nodes/special-rules
 */

/**
 * Требования правил к объявлению метода.
 *
 * `fields` — поля, которые команда обязана оставить незаполненными: их ставит
 * сервер. Если поля нет в объявлении, правило применять некуда, и молчать об
 * этом нельзя: получится «замер», который на самом деле ничего не мерил.
 */
export const RULES = {
  timing: {
    description: 'замер времени выполнения',
    fields: ['sentAt', 'receivedAt'],
  },
  flushBefore: { description: 'FLUSH перед командой', fields: [] },
  flushAfter: { description: 'FLUSH после команды', fields: [] },
  flushAround: { description: 'FLUSH до и после', fields: [] },
}

/**
 * Проверить объявление «метод → правило».
 *
 * @param {Array<{name: string, methods: object[]}>} apis объявления узла
 * @returns {{problems: string[], unknownRules: string[]}} что не так
 */
export function checkSpecialRules (apis = []) {
  const problems = []
  const unknownRules = []
  for (const api of apis) {
    for (const method of api?.methods ?? []) {
      const rule = method?.special ?? method?.rule ?? null
      if (!rule) continue
      const definition = RULES[rule]
      if (!definition) {
        unknownRules.push(`${api.name}.${method.method}: правило «${rule}» неизвестно`)
        continue
      }
      // поля ищем в объявлении ответа: где именно клиент их обещает
      const declared = new Set(Object.keys(method?.returns?.properties ?? method?.returns?.fields ?? {}))
      for (const field of definition.fields) {
        if (!declared.has(field)) {
          problems.push(
            `${api.name}.${method.method}: правило «${rule}» требует поля «${field}» в ответе, `
            + 'а объявление его не содержит — замер/барьер применить некуда',
          )
        }
      }
    }
  }
  return { problems, unknownRules }
}
