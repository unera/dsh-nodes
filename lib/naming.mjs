/**
 * The node's name and aliases: one place where they are read and written.
 *
 * The same edit has two doors — the admin panel (`updateNode` in lib/admin-api.mjs) and the node
 * itself (`GET/PUT /v1/naming`, so that a phone can download the naming it was given or send the
 * one a person typed on it). The rules must be identical on both: the name is always an alias,
 * the list is a full replacement, an alias belongs to one node, a rename is a name plus an alias.
 * A second copy of those rules would drift, so both doors call this module.
 *
 * @module dsh-nodes/naming
 */

/** How long a name may be. The server's own limit for a node created at pairing. */
export const NAME_LIMIT = 64

/** How many aliases one node may carry, the name included. */
export const ALIAS_LIMIT = 16

/** A refusal the routes answer as they are: bad input, or a name that belongs to somebody else. */
export class NamingError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * The naming of one node, in the shape both doors return.
 *
 * `aliases` always contains the name: a node you cannot call by the name it was created under
 * is a trap, and the alias table is the only list the caller may address.
 */
export function namingOf (store, node) {
  return { node: node.id, name: node.name, aliases: store.aliases(node.id) }
}

/**
 * Change the name and/or the aliases of a node.
 *
 * `body.name` is a rename, not one more alias: the old name leaves the alias table and the new
 * one enters it. `body.aliases` is the full list — what is not in it is removed. An alias already
 * held by another node is not an error but a marked refusal: the answer carries `rejected`, and
 * everything else is applied, which is what the panel shows as «заняты другими узлами».
 *
 * @param {object} store the node store
 * @param {number|string} id the node number
 * @param {{name?: string, aliases?: string[]}} body what to change; keys outside this pair are a mistake
 * @returns {{node: number, name: string, aliases: string[], rejected: string[]}}
 * @throws {NamingError} 404 unknown node, 400 bad request, 409 the new name belongs to another node
 */
export function applyNaming (store, id, body = {}) {
  const node = store.node(Number(id))
  if (!node) throw new NamingError(404, 'unknown_node', `unknown node ${id}`)

  const unknown = Object.keys(body ?? {}).filter((key) => key !== 'name' && key !== 'aliases')
  if (unknown.length) {
    throw new NamingError(
      400,
      'bad_request',
      `неизвестное поле «${unknown.join(', ')}»: наименование знает name и aliases`,
    )
  }

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new NamingError(400, 'bad_request', 'name — непустая строка')
    }
    const wanted = body.name.trim().slice(0, NAME_LIMIT)
    if (wanted !== node.name) {
      const owner = store.nodeByAlias(wanted)
      if (owner && owner.id !== node.id) {
        throw new NamingError(409, 'alias_taken', `имя «${wanted}» занято узлом ${owner.id}`)
      }
      store.updateNode(node.id, { name: wanted })
      store.removeAlias(node.id, node.name)
      store.setAlias(node.id, wanted)
    }
  }

  /** @type {string[]} */
  let rejected = []
  if (body.aliases !== undefined) {
    if (!Array.isArray(body.aliases)) throw new NamingError(400, 'bad_request', 'aliases — массив строк')
    // after a rename the node object is stale: it still remembers the previous name and would
    // put it back into the alias list
    const fresh = store.node(node.id)
    const wanted = uniqueAliases(body.aliases, fresh.name)
    const current = store.aliases(fresh.id)
    for (const alias of current) {
      if (!wanted.some((value) => value.toLowerCase() === alias.toLowerCase())) store.removeAlias(fresh.id, alias)
    }
    const applied = []
    for (const alias of wanted) {
      if (current.some((value) => value.toLowerCase() === alias.toLowerCase())) {
        applied.push(alias)
        continue
      }
      const owner = store.nodeByAlias(alias)
      if (owner && owner.id !== fresh.id) {
        applied.push(`!${alias}`) // taken by another node — returned marked, not written
        continue
      }
      store.setAlias(fresh.id, alias)
      applied.push(alias)
    }
    rejected = applied.filter((alias) => alias.startsWith('!')).map((alias) => alias.slice(1))
  }

  return { ...namingOf(store, store.node(node.id)), rejected }
}

/**
 * The wanted list as it will be written: trimmed, deduplicated case-insensitively, capped, and
 * always carrying the node's name.
 */
function uniqueAliases (list, name) {
  const wanted = [...new Set(
    list
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value).trim().slice(0, NAME_LIMIT))
      .filter(Boolean),
  )].slice(0, ALIAS_LIMIT)
  const lower = wanted.map((value) => value.toLowerCase())
  if (!lower.includes(name.toLowerCase())) wanted.unshift(name)
  return wanted.slice(0, ALIAS_LIMIT)
}
