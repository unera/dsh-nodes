/**
 * The plugin's admin operations — as pure functions.
 *
 * The same logic is needed by three consumers: the page (`/api/dsh-nodes/*`
 * behind the core owner gate), the tests and, if it appears, a client panel. That is why
 * there is neither `req` nor `res` here: the input is ordinary values, the output is `{status, body}`.
 *
 * @module dsh-nodes/admin-api
 */
import { newToken } from './db.mjs'

/** A node in a form fit for the admin panel. */
function nodeView (store, queue, node, { aliveMs, presence, connStats }) {
  const apis = store.nodeApis(node.id).map((id) => {
    const def = store.api(id)
    return def ? { id, name: def.name, version: def.version ?? null } : { id, name: `#${id}`, version: null }
  })
  const info = queue.info(node.id)
  return {
    id: node.id,
    name: node.name,
    aliases: store.aliases(node.id),
    apis,
    // "attached" is about the socket. The freshness of the last link is a separate fact:
    // a client that was stopped stops being attached at once, although
    // the timestamp is still fresh.
    attached: Boolean(presence?.online?.(node.id)),
    // online = the socket is held; link freshness is a separate field
    online: typeof presence?.online === 'function'
      ? Boolean(presence.online(node.id))
      : Boolean(node.last_seen && Date.now() - node.last_seen < aliveMs),
    lastSeen: node.last_seen,
    // two different facts: whether the socket is held, and when the last link was
    socket: Boolean(presence?.online?.(node.id)),
    // we count uptime from the moment the server computed itself on announce
    uptimeSeconds: node.boot_at ? Math.max(0, Math.round((Date.now() - node.boot_at) / 1000)) : null,
    proto: node.proto,
    clientVersion: node.client_version,
    // what the client runs on, as the node itself reported it: never inferred from the version
    platform: node.platform ?? null,
    access: node.access,
    // the start mode and who answers questions: the panel draws them as badges
    base: node.base ?? null,
    approver: node.approver ?? null,
    workdir: node.workdir,
    allowEscalation: Boolean(node.allow_escalation),
    max_commandno: info.max_commandno,
    queued: info.queued,
    // the node's own generation, as it last announced it: the counters below are only
    // about that life, and the panel shows the number next to them
    clientEpoch: store.clientEpoch(node.id),
    // live counters of the current connection: in memory, zeroed on a new generation
    conn: typeof connStats?.snapshot === 'function'
      ? connStats.snapshot(node.id)
      : { commands: 0, in: {}, out: {}, since: null },
  }
}

/** Who is connected and with what. */
export function listNodes ({ store, queue, config, presence, connStats }) {
  const aliveMs = (config.aliveTimeoutSeconds ?? 60) * 1000
  // a snapshot of the counters is read only if the panel actually asks: the values come
  // from memory and must belong to the generation the list itself is made under
  try {
    connStats?.syncGeneration?.(queue.epoch)
  } catch {}
  return {
    status: 200,
    body: {
      epoch: queue.epoch,
      nodes: store.nodes().map((node) => nodeView(store, queue, node, { aliveMs, presence, connStats })),
    },
  }
}

/**
 * The plugin's shared settings, available read-only.
 *
 * They are edited in the config: the panel shows the values because the human
 * needs to see whether copying to the host is allowed and how long a question waits.
 */
export function getSettings ({ config }) {
  return {
    status: 200,
    body: {
      // the session directory is always allowed, selfRoots is only an extension
      selfSessionAlways: true,
      selfRoots: config?.selfRoots ?? [],
      approvalWaitSeconds: config?.approvalWaitSeconds ?? 600,
      approvalTtlSeconds: config?.approvalTtlSeconds ?? 86400,
      aliveTimeoutSeconds: config?.aliveTimeoutSeconds ?? 60,
      wsPingSeconds: config?.wsPingSeconds ?? 0,
    },
  }
}

/** The latest audit events (across all nodes at once). */
export function listAudit ({ store }, limit = 100) {
  // a node number tells the human nothing: we put the name in, and keep the number
  // next to it — that is what people search the log by
  const names = new Map(store.nodes().map((node) => [node.id, node.name]))
  return {
    status: 200,
    body: {
      audit: store.readAudit(limit).map((row) => ({
        id: row.id,
        kind: row.kind,
        node: row.node,
        nodeName: row.node ? (names.get(row.node) ?? null) : null,
        session: row.session ? String(row.session).replace(/^session-/, '').slice(0, 8) : null,
        mode: row.mode,
        command: row.command,
        code: row.code,
        escalation: row.escalation,
        approved: row.approved,
        outcome: row.outcome,
        at: row.at,
      })),
    },
  }
}

/** Catalog: what is registered at all. */
export function listCatalog ({ store }) {
  // next to each API — who holds it: the panel shows that in the expanded card,
  // and the human immediately sees which nodes can do such a method
  const apis = store.catalog().map((api) => {
    const nodes = store.nodes()
      .filter((node) => store.nodeApis(node.id).includes(api.id))
      .map((node) => ({ id: node.id, name: node.name, online: Boolean(node.last_seen && Date.now() - node.last_seen < 60_000) }))
    return {
      id: api.id,
      name: api.name,
      version: api.version,
      description: api.description,
      methods: (api.methods ?? []).map((method) => ({
        method: method.method ?? method.name ?? null,
        description: method.description ?? null,
        args: method.args?.properties ?? null,
      })),
      nodes,
    }
  })
  return { status: 200, body: { apis } }
}

/** Enrollment requests that came without a code. */
export function listPending ({ store }) {
  return {
    status: 200,
    body: {
      pending: store.pending().map((row) => ({
        uuid: row.uuid,
        short: row.uuid.slice(0, 8),
        name: row.name,
        ip: row.ip,
        proto: row.proto,
        clientVersion: row.client_version,
        waiting: Math.round((Date.now() - row.first_seen) / 1000),
      })),
    },
  }
}

/** Approve a request: create the node and issue a token. */
export function approvePending ({ store, queue, config, connStats }, uuid, body = {}) {
  const approved = store.approve(uuid, { alias: body.alias, access: body.access ?? null, workdir: body.workdir ?? null })
  if (!approved) return { status: 409, body: { code: 'bad_request', message: 'заявка не в состоянии pending' } }
  return {
    status: 200,
    body: { uuid, status: 'approved', node: nodeView(store, queue, approved.node, { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000, connStats }) },
  }
}

/** Reject a request. */
export function rejectPending ({ store }, uuid) {
  store.reject(uuid)
  return { status: 200, body: { uuid, status: 'rejected' } }
}

/** Generate a pairing link. */
export function createPairing ({ store, config, prefix, origin }, body = {}) {
  const ttl = Number(body.ttlSeconds) > 0 ? Number(body.ttlSeconds) : 600
  const code = newToken()
  const { expiresAt } = store.createPairing(code, { ttlSeconds: ttl, note: body.note ?? null })
  return {
    status: 201,
    body: { url: `${origin}${prefix}/pair?v=${encodeURIComponent(code)}`, code, expiresAt, ttlSeconds: ttl },
  }
}

/**
 * Create a node by hand and get the token at once.
 * @returns {{status: number, body: object}}
 */
export function createNode ({ store, queue, config, connStats }, body = {}) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : null
  if (!name) return { status: 400, body: { code: 'bad_request', message: 'нужно имя узла' } }
  const alias = store.freeAlias(name)
  const { node, token } = store.createNode({
    name: alias,
    access: body.access ?? 'none',
    workdir: body.workdir ?? null,
    defaultTimeout: body.defaultTimeout ?? null,
    allowEscalation: body.allowEscalation === false ? 0 : 1,
  })
  return { status: 201, body: { node: nodeView(store, queue, node, { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000, connStats }), token } }
}

/**
 * Editing a node: aliases, access, working directory, timeout.
 *
 * Aliases are given as a full list: what is not in the list is removed, what was not there is
 * added. The node name always stays an alias, otherwise the node cannot be called by
 * the name it was created under.
 */
export function updateNode ({ store, queue, config, connStats }, id, body = {}) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }

  // Renaming is a change of the name, not one more alias. The node name must always
  // stay callable, so we remove the old alias and set the new one.
  let renamed = null
  if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== node.name) {
    const wanted = body.name.trim().slice(0, 64)
    const owner = store.nodeByAlias(wanted)
    if (owner && owner.id !== node.id) {
      return { status: 409, body: { code: 'alias_taken', message: `имя «${wanted}» занято узлом ${owner.id}` } }
    }
    store.updateNode(node.id, { name: wanted })
    store.removeAlias(node.id, node.name)
    store.setAlias(node.id, wanted)
    renamed = wanted
  }

  const patch = {}
  for (const key of ['access', 'workdir', 'default_timeout']) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  if (body.allowEscalation !== undefined) patch.allow_escalation = body.allowEscalation ? 1 : 0
  if (Object.keys(patch).length) store.updateNode(node.id, patch)

  if (Array.isArray(body.aliases)) {
    // after a rename we take the name anew: the old object remembers the previous name
    // and would put it back into the alias list
    const fresh = store.node(node.id)
    const wanted = [...new Set(body.aliases.map((value) => String(value).trim()).filter(Boolean))].slice(0, 16)
    if (!wanted.some((alias) => alias.toLowerCase() === fresh.name.toLowerCase())) wanted.unshift(fresh.name)
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
        applied.push(`!${alias}`) // taken by another node — return it marked
        continue
      }
      store.setAlias(fresh.id, alias)
      applied.push(alias)
    }
    return {
      status: 200,
      body: {
        node: nodeView(store, queue, store.node(node.id), { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000, connStats }),
        rejected: applied.filter((alias) => alias.startsWith('!')).map((alias) => alias.slice(1)),
      },
    }
  }

  return {
    status: 200,
    body: { node: nodeView(store, queue, store.node(node.id), { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000, connStats }) },
  }
}

/**
 * Revoke the node token.
 *
 * This is a revocation, not "show a new token": the client loses access and must
 * confirm itself again — then it shows up among the requests without a code.
 */
export function reissueToken ({ store, presence }, id) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }
  store.revokeToken(node.id)
  // we close the session: otherwise the node keeps showing as online, although it cannot
  // receive a single command any more
  try {
    presence?.drop?.(node.id, 4401, 'token revoked')
  } catch {}
  return { status: 200, body: { node: node.id, revoked: true } }
}

/** Delete a node: pending waits on it are closed with an error. */
export function deleteNode ({ store, queue }, id) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }
  queue.abort(node.id, { status: 'error', code: 'unknown_node', message: 'node removed', results: null })
  store.deleteNode(node.id)
  return { status: 200, body: { deleted: node.id } }
}

/**
 * One entry point for changes: `connection.fetch.register` only knows
 * exact paths, while node numbers are dynamic — that is why the operation travels in the body,
 * not in the URL.
 * @param {object} deps
 * @param {{op: string, id?: number|string, body?: object}} payload
 */
export function handleAdminOp (deps, payload = {}) {
  const { op } = payload
  const body = payload.body ?? {}
  switch (op) {
    case 'pair': return createPairing(deps, body)
    case 'create': return createNode(deps, body)
    case 'approve': return approvePending(deps, payload.id, body)
    case 'reject': return rejectPending(deps, payload.id)
    case 'update': return updateNode(deps, payload.id, body)
    case 'delete': return deleteNode(deps, payload.id)
    case 'token': return reissueToken(deps, payload.id)
    default: return { status: 400, body: { code: 'bad_request', message: `неизвестная операция «${op}»` } }
  }
}

/**
 * Parse the rest of the admin-API path and execute the operation.
 * Used by the fetch adapter: `path` without the prefix, for example `/nodes/3`.
 */
export function handleAdmin ({ store, queue, config, prefix, origin, presence, connStats }, method, path, body = {}) {
  // a request may come with parameters: `/audit?limit=50`
  const [clean, query = ''] = String(path).split('?')
  const params = new URLSearchParams(query)
  const parts = clean.split('/').filter(Boolean)
  const [head, second, third] = parts

  if (!head) return { status: 404, body: { code: 'bad_request', message: 'пустой админ-путь' } }

  if (head === 'nodes') {
    if (!second && method === 'GET') return listNodes({ store, queue, config, presence, connStats })
    if (!second && method === 'POST') return createNode({ store, queue, config, connStats }, body)
    if (second && third === 'update' && method === 'POST') return updateNode({ store, queue, config, connStats }, second, body)
    if (second && third === 'delete' && method === 'POST') return deleteNode({ store, queue }, second)
    if (second && third === 'token' && method === 'POST') return reissueToken({ store, presence }, second)
    return { status: 404, body: { code: 'bad_request', message: `${method} /nodes/${second ?? ''} не поддержан` } }
  }
  if (head === 'catalog' && method === 'GET') return listCatalog({ store })
  if (head === 'settings' && method === 'GET') return getSettings({ config })
  if (head === 'audit' && method === 'GET') return listAudit({ store }, Number(params.get('limit') ?? second) || 100)
  if (head === 'pairing' && method === 'POST') return createPairing({ store, config, prefix, origin }, body)
  if (head === 'pending') {
    if (!second && method === 'GET') return listPending({ store })
    if (second && third === 'approve' && method === 'POST') return approvePending({ store, queue, config, connStats }, second, body)
    if (second && third === 'reject' && method === 'POST') return rejectPending({ store }, second)
    return { status: 404, body: { code: 'bad_request', message: 'нет такого маршрута заявок' } }
  }
  return { status: 404, body: { code: 'bad_request', message: `нет админ-маршрута ${path}` } }
}
