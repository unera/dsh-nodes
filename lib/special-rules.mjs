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
    // поля, которые заполняет сервер: узел объявляет их в ответе и оставляет
    // пустыми — считать ему нечем, часов между машинами он не знает
    fields: ['rttMs', 'clockSkewMs', 'durationMs'],
    // а эти две отметки узел обязан приложить сам, своими часами: начало работы
    // и конец. Без них «замер» был бы выдумкой, поэтому объявление проверяется
    nodeFields: ['startedAt', 'now'],
  },
  flushBefore: { description: 'FLUSH перед командой', fields: [] },
  flushAfter: { description: 'FLUSH после команды', fields: [] },
  flushAround: { description: 'FLUSH до и после', fields: [] },
}

/**
 * Правило, объявленное для метода, или `null`.
 *
 * Смотрим в сохранённое объявление API: `special` живёт рядом с методом, и
 * берётся он оттуда же, откуда схема аргументов, — второго источника правды
 * быть не должно.
 *
 * @param {{methods?: object[]}} def объявление API
 * @param {string} methodName имя метода
 * @returns {string|null}
 */
export function ruleFor (def, methodName) {
  const method = (def?.methods ?? []).find((item) => item?.method === methodName)
  return method?.special ?? method?.rule ?? null
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
      // без этих полей правило некуда применить: результат «замера» был бы
      // выдумкой, а барьер — пожеланием
      for (const field of [...definition.fields, ...(definition.nodeFields ?? [])]) {
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
