/**
 * Режим песочницы из политики ядра.
 *
 * Вынесено отдельно, потому что тут была настоящая дыра: `ctx.sandboxPolicy`
 * без объявления в `inject` бросает ошибку, мы её глотали, и до появления
 * fail-closed это молча означало «режим неизвестен → запускаем без песочницы».
 *
 * Правило: неизвестность трактуется как самый узкий режим, а не как отсутствие
 * песочницы. Ошибка в политике не должна давать полный доступ.
 *
 * @module dsh-nodes/policy
 */

/** Самый узкий режим: то, что получается при любой неопределённости. */
export const FALLBACK_MODE = 'read-only'

/**
 * Разобрать ответ политики в режим песочницы.
 * @param {object|null} service сервис `sandboxPolicy`
 * @param {unknown} session сессия, для которой считается политика
 * @param {(message: string) => void} [warn] куда сообщить о проблеме
 * @returns {{mode: string, root?: string}}
 */
export function modeFromPolicy (service, session, warn = () => {}) {
  try {
    const policy = service?.resolve?.({ session })
    if (!policy?.mode) {
      warn('sandboxPolicy без режима: считаю read-only')
      return { mode: FALLBACK_MODE }
    }
    return { mode: policy.mode, ...(policy.workspaceRoot ? { root: policy.workspaceRoot } : {}) }
  } catch (error) {
    warn(`sandboxPolicy не разрешился (${error?.message ?? error}): считаю read-only`)
    return { mode: FALLBACK_MODE }
  }
}
