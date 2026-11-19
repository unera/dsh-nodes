/**
 * Host paths and the boundaries they must stay inside.
 *
 * Every transfer touched two paths before: one on the node, one on the host. The node side lives
 * in a sandbox the client enforces. The host side had nothing: `nodes_call` could issue a
 * `copyToDevice` with any `hostPath`, and the server wrote that file as itself. Prefix checks were
 * not enough either — `..` walked out, and a symlink pointed out.
 *
 * So a path is resolved first and compared after: symlinks of the existing part are followed,
 * the non-existent tail is appended, and only the result is measured against the roots. What
 * comes back is the canonical path, and that is what gets opened — the checked path and the used
 * path must be the same string, or the check means nothing.
 *
 * @module dsh-nodes/paths
 */
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** An error a caller can act on: the same shape the transfer layer already answers with. */
function denied (message) {
  return Object.assign(new Error(message), { code: 'path_denied' })
}

/**
 * Resolve a path the way the filesystem will.
 *
 * Symlinks of the nearest existing ancestor are followed, the rest is appended as written. A path
 * that does not exist yet (a file about to be written) resolves through its parent, which is
 * exactly what the write will do.
 *
 * @param {string} value
 * @returns {string} an absolute path with no symlinks and no `..` left in it
 */
export function canonical (value) {
  const absolute = resolve(String(value ?? ''))
  const tail = []
  let head = absolute
  while (!existsSync(head)) {
    const parent = dirname(head)
    if (parent === head) break
    tail.unshift(basename(head))
    head = parent
  }
  const real = existsSync(head) ? realpathSync(head) : head
  return tail.length > 0 ? join(real, ...tail) : real
}

/**
 * Whether a path is inside one of the roots.
 *
 * Both sides are canonical, and the comparison adds a separator: `/tmp/work-evil` must not pass
 * for `/tmp/work`.
 */
export function inside (roots, value) {
  const target = canonical(value)
  return (roots ?? []).some((root) => {
    const real = canonical(root)
    return target === real || target.startsWith(real.endsWith(sep) ? real : real + sep)
  })
}

/**
 * The path, if it is inside the roots — and the canonical form of it.
 *
 * @param {string[]} roots directories this caller may touch
 * @param {string} value the path from the request
 * @param {string} [what] what to call it in the refusal
 * @returns {string} canonical path
 */
export function checked (roots, value, what = 'путь') {
  const list = (roots ?? []).filter(Boolean)
  if (list.length === 0) {
    throw denied(`${what} ${value}: у этой сессии нет разрешённых каталогов на хосте`)
  }
  const target = canonical(value)
  if (!inside(list, target)) {
    throw denied(`${what} ${target} вне разрешённых каталогов хоста: ${list.join(', ')}`)
  }
  return target
}
