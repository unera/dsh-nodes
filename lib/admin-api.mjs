/**
 * Админ-операции плагина — чистыми функциями.
 *
 * Одна и та же логика нужна трём потребителям: странице (`/api/dsh-nodes/*`
 * за owner-гейтом ядра), тестам и, если появится, клиентской панели. Поэтому
 * здесь нет ни `req`, ни `res`: вход — обычные значения, выход — `{status, body}`.
 *
 * @module dsh-nodes/admin-api
 */
import { newToken } from './db.mjs'

/** Узел в виде, пригодном для админки. */
function nodeView (store, queue, node, { aliveMs, presence }) {
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
    // живой сокет важнее отметки времени: узел может молчать, но быть на связи
    online: Boolean(presence?.online?.(node.id)) || Boolean(node.last_seen && Date.now() - node.last_seen < aliveMs),
    lastSeen: node.last_seen,
    proto: node.proto,
    clientVersion: node.client_version,
    access: node.access,
    workdir: node.workdir,
    allowEscalation: Boolean(node.allow_escalation),
    state: info.state,
    served: info.served,
    queued: info.queued,
  }
}

/** Кто и с чем подключён. */
export function listNodes ({ store, queue, config, presence }) {
  const aliveMs = (config.aliveTimeoutSeconds ?? 60) * 1000
  return {
    status: 200,
    body: {
      epoch: queue.epoch,
      nodes: store.nodes().map((node) => nodeView(store, queue, node, { aliveMs, presence })),
    },
  }
}

/** Справочник: что вообще зарегистрировано. */
export function listCatalog ({ store }) {
  return { status: 200, body: { apis: store.catalog() } }
}

/** Заявки, пришедшие без кода. */
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

/** Одобрить заявку: завести узел и выдать токен. */
export function approvePending ({ store, queue, config }, uuid, body = {}) {
  const approved = store.approve(uuid, { alias: body.alias, access: body.access ?? 'none', workdir: body.workdir ?? null })
  if (!approved) return { status: 409, body: { code: 'bad_request', message: 'заявка не в состоянии pending' } }
  return {
    status: 200,
    body: { uuid, status: 'approved', node: nodeView(store, queue, approved.node, { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000 }) },
  }
}

/** Отклонить заявку. */
export function rejectPending ({ store }, uuid) {
  store.reject(uuid)
  return { status: 200, body: { uuid, status: 'rejected' } }
}

/** Сгенерировать ссылку подключения. */
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
 * Создать узел вручную и сразу получить токен.
 * @returns {{status: number, body: object}}
 */
export function createNode ({ store, queue, config }, body = {}) {
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
  return { status: 201, body: { node: nodeView(store, queue, node, { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000 }), token } }
}

/**
 * Правка узла: алиасы, доступ, рабочий каталог, таймаут.
 *
 * Алиасы задаются полным списком: чего нет в списке — снимается, чего не было —
 * добавляется. Имя узла всегда остаётся алиасом, иначе узел нельзя позвать по
 * имени, под которым он заведён.
 */
export function updateNode ({ store, queue, config }, id, body = {}) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }

  // Переименование — это смена имени, а не ещё один алиас. Имя узла всегда
  // обязано оставаться вызываемым, поэтому старый алиас снимаем, новый ставим.
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
    // после переименования имя берём заново: старый объект помнит прежнее имя
    // и вернул бы его в список алиасов
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
        applied.push(`!${alias}`) // занято другим узлом — возвращаем помеченным
        continue
      }
      store.setAlias(fresh.id, alias)
      applied.push(alias)
    }
    return {
      status: 200,
      body: {
        node: nodeView(store, queue, store.node(node.id), { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000 }),
        rejected: applied.filter((alias) => alias.startsWith('!')).map((alias) => alias.slice(1)),
      },
    }
  }

  return {
    status: 200,
    body: { node: nodeView(store, queue, store.node(node.id), { aliveMs: (config.aliveTimeoutSeconds ?? 60) * 1000 }) },
  }
}

/**
 * Отозвать токен узла.
 *
 * Это именно отзыв, а не «покажи новый токен»: клиент теряет доступ и должен
 * подтвердиться заново — тогда он появляется в заявках без кода.
 */
export function reissueToken ({ store, presence }, id) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }
  store.revokeToken(node.id)
  // сессию закрываем: иначе узел продолжает светиться online, хотя ни одной
  // команды получить уже не может
  try {
    presence?.drop?.(node.id, 4401, 'token revoked')
  } catch {}
  return { status: 200, body: { node: node.id, revoked: true } }
}

/** Удалить узел: висящие ожидания по нему закрываются ошибкой. */
export function deleteNode ({ store, queue }, id) {
  const node = store.node(Number(id))
  if (!node) return { status: 404, body: { code: 'unknown_node', message: `unknown node ${id}` } }
  queue.abort(node.id, { status: 'error', code: 'unknown_node', message: 'node removed', results: null })
  store.deleteNode(node.id)
  return { status: 200, body: { deleted: node.id } }
}

/**
 * Одна точка входа для изменений: `connection.fetch.register` умеет только
 * точные пути, а номера узлов динамические — поэтому операция едет в теле,
 * а не в URL.
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
 * Разобрать остаток пути админ-API и выполнить операцию.
 * Используется fetch-адаптером: `path` без префикса, например `/nodes/3`.
 */
export function handleAdmin ({ store, queue, config, prefix, origin, presence }, method, path, body = {}) {
  const parts = path.split('/').filter(Boolean)
  const [head, second, third] = parts

  if (!head) return { status: 404, body: { code: 'bad_request', message: 'пустой админ-путь' } }

  if (head === 'nodes') {
    if (!second && method === 'GET') return listNodes({ store, queue, config, presence })
    if (!second && method === 'POST') return createNode({ store, queue, config }, body)
    if (second && third === 'update' && method === 'POST') return updateNode({ store, queue, config }, second, body)
    if (second && third === 'delete' && method === 'POST') return deleteNode({ store, queue }, second)
    if (second && third === 'token' && method === 'POST') return reissueToken({ store, presence }, second)
    return { status: 404, body: { code: 'bad_request', message: `${method} /nodes/${second ?? ''} не поддержан` } }
  }
  if (head === 'catalog' && method === 'GET') return listCatalog({ store })
  if (head === 'pairing' && method === 'POST') return createPairing({ store, config, prefix, origin }, body)
  if (head === 'pending') {
    if (!second && method === 'GET') return listPending({ store })
    if (second && third === 'approve' && method === 'POST') return approvePending({ store, queue, config }, second, body)
    if (second && third === 'reject' && method === 'POST') return rejectPending({ store }, second)
    return { status: 404, body: { code: 'bad_request', message: 'нет такого маршрута заявок' } }
  }
  return { status: 404, body: { code: 'bad_request', message: `нет админ-маршрута ${path}` } }
}
