/**
 * Проверки объявлений API узла.
 *
 * `approver: "local"` — обещание, что узел умеет спрашивать человека. Проверять
 * его надо в одном месте, иначе announce и WebSocket начнут расходиться во
 * мнениях, и что решит узел, будет зависеть от порядка сообщений.
 *
 * @module dsh-nodes/apidef
 */

/** @param {object[]} apis список API из объявления */
export function announcesApprove (apis) {
  if (!Array.isArray(apis)) return false
  const session = apis.find((api) => api?.name === 'session')
  return Boolean(session?.methods?.some((method) => method?.method === 'approve'))
}

