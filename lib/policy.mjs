/**
 * Sandbox mode from the core policy.
 *
 * Split out because there used to be a real hole here: `ctx.sandboxPolicy`
 * without a declaration in `inject` throws, we swallowed that error, and before
 * fail-closed appeared it silently meant "mode unknown → run without a sandbox".
 *
 * Rule: the unknown is treated as the narrowest mode, not as the absence of a
 * sandbox. An error in the policy must not grant full access.
 *
 * @module dsh-nodes/policy
 */

/** The narrowest mode: what you get under any uncertainty. */
export const FALLBACK_MODE = 'read-only'

/**
 * Turn a policy answer into a sandbox mode.
 * @param {object|null} service the `sandboxPolicy` service
 * @param {unknown} session session the policy is computed for
 * @param {(message: string) => void} [warn] where to report the problem
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
