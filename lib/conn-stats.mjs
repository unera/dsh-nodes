/**
 * Live counters of the current connection: what a node is doing right now.
 *
 * The numbers describe the running process, not history: they are kept in memory, are
 * cheap enough for the hot path (an increment, no allocation, no logging) and are wiped
 * when the statement they belong to stops being true — a new server generation or a new
 * `client_epoch` from the node. An old generation's numbers mean nothing, so showing
 * them would be worse than showing zeros.
 *
 * Nothing here does I/O or knows about the socket: the frame counters are bumped where
 * the frame is actually parsed and sent, the command counter where the request is
 * actually served, so the numbers cannot drift away from reality.
 *
 * @module dsh-nodes/conn-stats
 */

/** Frame types we know by name; anything else is counted under its own `t`. */
function frameKey (t) {
  // a wrong `t` from a buggy client is exactly what the panel is for: it gets its own row
  return typeof t === 'string' && t ? t : '?'
}

function bump (table, t) {
  const key = frameKey(t)
  // one Map read and one write: no object allocation per frame
  table.set(key, (table.get(key) ?? 0) + 1)
}

function toObject (table) {
  const out = Object.create(null)
  for (const [key, value] of table) out[key] = value
  return out
}

/**
 * Counters of the current connection, per node.
 *
 * @returns {{
 *   bumpIn: (nodeId: number, t: string) => void,
 *   bumpOut: (nodeId: number, t: string) => void,
 *   bumpCommands: (nodeId: number) => void,
 *   reset: (nodeId: number) => void,
 *   resetAll: () => void,
 *   syncGeneration: (epoch: number) => boolean,
 *   snapshot: (nodeId: number) => {commands: number, in: object, out: object, since: number|null},
 * }}
 */
export function createConnStats () {
  /** @type {Map<number, {commands: number, in: Map<string, number>, out: Map<string, number>, since: number}>} */
  const nodes = new Map()
  /** Server generation the numbers belong to; `null` until the first sync. */
  let generation = null

  function entry (nodeId) {
    const id = Number(nodeId)
    let row = nodes.get(id)
    if (row === undefined) {
      row = { commands: 0, in: new Map(), out: new Map(), since: Date.now() }
      nodes.set(id, row)
    }
    return row
  }

  return {
    /** A frame arrived from the node. */
    bumpIn (nodeId, t) {
      bump(entry(nodeId).in, t)
    },

    /** A frame went out to the node. */
    bumpOut (nodeId, t) {
      bump(entry(nodeId).out, t)
    },

    /** `GET /v1/commands` served for the node. */
    bumpCommands (nodeId) {
      entry(nodeId).commands += 1
    },

    /** The node started a new life: what we counted belongs to the previous one. */
    reset (nodeId) {
      nodes.delete(Number(nodeId))
    },

    /** A new server generation: every number is meaningless now. */
    resetAll () {
      nodes.clear()
    },

    /**
     * Keep the numbers tied to one server generation.
     * @returns {boolean} whether the counters had to be thrown away
     */
    syncGeneration (epoch) {
      if (generation === null) {
        generation = epoch
        return false
      }
      if (generation === epoch) return false
      generation = epoch
      nodes.clear()
      return true
    },

    /**
     * A copy of the counters, safe to serialise. A node that never spoke has zeros,
     * not `undefined`: the panel draws one shape for every row.
     */
    snapshot (nodeId) {
      const row = nodes.get(Number(nodeId))
      if (row === undefined) return { commands: 0, in: {}, out: {}, since: null }
      return { commands: row.commands, in: toObject(row.in), out: toObject(row.out), since: row.since }
    },
  }
}
