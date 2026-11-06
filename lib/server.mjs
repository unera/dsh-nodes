/**
 * HTTP-поверхность dsh-nodes без зависимостей от harness: обычный обработчик
 * для node:http. Плагин (§ index.mjs) только вешает его на webServer, а тесты
 * поднимают http.createServer напрямую — так срез проверяется целиком.
 *
 * @module dsh-nodes/server
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'

/** Ничего не отвечаем до таймаута: тело читается с потолком. */
class HttpError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function json (res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson (req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new HttpError(413, 'body_too_large', `тело больше ${maxBytes} байт`)
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'bad_request', 'тело должно быть JSON-объектом')
    }
    return value
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'bad_request', 'тело не разбирается как JSON')
  }
}

function equal (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Собрать обработчики.
 * @param {object} options
 * @param {import('./db.mjs').Store} options.store
 * @param {import('./queue.mjs').Queue} options.queue
 * @param {object} options.config разобранный конфиг плагина
 * @param {(level: string, message: string, extra?: object) => void} [options.log]
 * @param {number} [options.adminToken] действующий админ-токен
 */
export function createNodesServer ({ store, queue, config, log = () => {}, adminToken }) {
  const prefix = (config.routePrefix ?? '/dsh-nodes').replace(/\/$/, '')
  const maxBody = config.maxBodyBytes ?? 1024 * 1024
  const aliveMs = (config.aliveTimeoutSeconds ?? 60) * 1000

  /** Разбор пути: префикс + остаток, без query. */
  function route (url) {
    const path = (url ?? '/').split('?')[0]
    if (path !== prefix && !path.startsWith(prefix + '/')) return null
    return path.slice(prefix.length) || '/'
  }

  function query (url) {
    return new URL(url ?? '/', 'http://x').searchParams
  }

  /** Токен узла из заголовка; иначе 401 без подробностей. */
  function authNode (req) {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (.+)$/.exec(header.trim())
    if (!match) throw new HttpError(401, 'unauthorized', 'нужен Bearer-токен')
    const node = store.nodeByToken(match[1])
    if (!node) throw new HttpError(401, 'unauthorized', 'токен не подходит')
    store.touch(node.id)
    return node
  }

  function authAdmin (req) {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (.+)$/.exec(header.trim())
    if (!match || !adminToken || !equal(match[1], adminToken)) {
      throw new HttpError(401, 'unauthorized', 'нужен админ-токен')
    }
  }

  function online (node) {
    return Boolean(node.last_seen && Date.now() - node.last_seen < aliveMs)
  }

  function publicNode (node) {
    return {
      id: node.id,
      name: node.name,
      aliases: store.aliases(node.id),
      apis: store.nodeApis(node.id),
      online: online(node),
      lastSeen: node.last_seen,
      proto: node.proto,
      clientVersion: node.client_version,
      access: node.access,
      workdir: node.workdir,
      allowEscalation: Boolean(node.allow_escalation),
      ...queue.info(node.id),
    }
  }

  async function handle (req, res) {
    const path = route(req.url)
    if (path === null) {
      return json(res, 404, { code: 'bad_request', message: 'не наш префикс' })
    }
    const method = (req.method ?? 'GET').toUpperCase()
    const params = query(req.url)
    try {
      // ── публичное: заявки на регистрацию (§9.1) ──────────────────────────
      if (path === '/v1/enroll' && method === 'POST') {
        const body = await readJson(req, maxBody)
        const uuid = typeof body.uuid === 'string' && body.uuid.length >= 8 && body.uuid.length <= 64 ? body.uuid : null
        if (!uuid) throw new HttpError(400, 'bad_request', 'нужен uuid длиной 8..64')
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : `node-${uuid.slice(0, 8)}`
        if (store.pending().length >= (config.maxPendingEnroll ?? 50)) {
          throw new HttpError(429, 'rate_limited', 'список заявок переполнен')
        }
        const result = store.enrollRequest({
          uuid,
          name,
          proto: Number(body.proto) || null,
          clientVersion: body.clientVersion ?? body.client_version ?? null,
          ip: req.socket.remoteAddress ?? null,
        })
        log('info', 'enroll', { uuid, name, status: result.status })
        return json(res, 202, result)
      }

      const enrollMatch = /^\/v1\/enroll\/([^/]+)$/.exec(path)
      if (enrollMatch && method === 'GET') {
        const row = store.enrollment(decodeURIComponent(enrollMatch[1]))
        if (!row) return json(res, 404, { code: 'bad_request', message: 'заявки нет' })
        if (row.status === 'pending') {
          store.db.prepare('UPDATE enrollment SET last_seen = ? WHERE uuid = ?').run(Date.now(), row.uuid)
          return json(res, 202, { status: 'pending' })
        }
        if (row.status !== 'approved' || !row.node) {
          return json(res, 403, { status: row.status })
        }
        // токен отдаётся один раз: дальше только перевыпуск в админке
        if (row.handed_at) return json(res, 409, { status: 'handed' })
        const token = store.reissueToken(row.node)
        store.markHanded(row.uuid)
        const node = store.node(row.node)
        log('warn', 'enroll-approved', { uuid: row.uuid, node: row.node })
        return json(res, 200, { status: 'approved', token, node: node.id, alias: store.aliases(node.id)[0] ?? node.name })
      }

      // ── админское ────────────────────────────────────────────────────────
      if (path === '/admin' || path === '/admin/') {
        return json(res, 200, {
          hint: 'админка: страница появится отдельным шагом; пока — JSON-API ниже',
          endpoints: ['/v1/admin/nodes', '/v1/admin/pending'],
        })
      }

      if (path.startsWith('/v1/admin/')) {
        authAdmin(req)
        const rest = path.slice('/v1/admin'.length)
        if (rest === '/nodes' && method === 'GET') return json(res, 200, { nodes: store.nodes().map(publicNode), epoch: queue.epoch })
        if (rest === '/nodes' && method === 'POST') {
          const body = await readJson(req, maxBody)
          const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : null
          if (!name) throw new HttpError(400, 'bad_request', 'нужно имя узла')
          const alias = store.freeAlias(name)
          const { node, token } = store.createNode({
            name: alias,
            access: body.access ?? 'none',
            workdir: body.workdir ?? null,
            defaultTimeout: body.defaultTimeout ?? null,
            allowEscalation: body.allowEscalation === false ? 0 : 1,
          })
          log('info', 'node-created', { id: node.id, alias })
          return json(res, 201, { node: publicNode(node), token })
        }
        const nodeMatch = /^\/nodes\/(\d+)(\/token)?$/.exec(rest)
        if (nodeMatch) {
          const id = Number(nodeMatch[1])
          const node = store.node(id)
          if (!node) return json(res, 404, { code: 'unknown_node', message: `unknown node ${id}` })
          if (nodeMatch[2] && method === 'POST') {
            const token = store.reissueToken(id)
            log('warn', 'token-reissued', { id })
            return json(res, 200, { token })
          }
          if (method === 'PATCH') {
            const body = await readJson(req, maxBody)
            store.updateNode(id, body)
            if (typeof body.alias === 'string' && body.alias.trim()) {
              const alias = store.freeAlias(body.alias.trim())
              store.setAlias(id, alias)
            }
            return json(res, 200, { node: publicNode(store.node(id)) })
          }
          if (method === 'DELETE') {
            queue.abort(id, { status: 'error', code: 'unknown_node', message: 'node removed', results: null })
            store.deleteNode(id)
            log('warn', 'node-deleted', { id })
            return json(res, 200, { deleted: id })
          }
        }
        if (rest === '/pending' && method === 'GET') {
          return json(res, 200, {
            pending: store.pending().map((row) => ({
              uuid: row.uuid,
              short: row.uuid.slice(0, 8),
              name: row.name,
              ip: row.ip,
              waiting: Math.round((Date.now() - row.first_seen) / 1000),
            })),
          })
        }
        const pendMatch = /^\/pending\/([^/]+)\/(approve|reject)$/.exec(rest)
        if (pendMatch && method === 'POST') {
          const uuid = decodeURIComponent(pendMatch[1])
          if (pendMatch[2] === 'reject') {
            store.reject(uuid)
            return json(res, 200, { uuid, status: 'rejected' })
          }
          const body = await readJson(req, maxBody)
          const approved = store.approve(uuid, { alias: body.alias, access: body.access ?? 'none', workdir: body.workdir ?? null })
          if (!approved) throw new HttpError(409, 'bad_request', 'заявка не в состоянии pending')
          log('info', 'enroll-approved', { uuid, node: approved.node.id, alias: approved.alias })
          return json(res, 200, { uuid, status: 'approved', node: approved.node.id, alias: approved.alias })
        }
        return json(res, 404, { code: 'bad_request', message: 'нет такого админ-маршрута' })
      }

      // ── узел ─────────────────────────────────────────────────────────────
      const node = authNode(req)

      if (path === '/v1/announce' && method === 'PUT') {
        const body = await readJson(req, maxBody)
        if (!Array.isArray(body.apis)) throw new HttpError(400, 'bad_request', 'нужен массив apis')
        for (const api of body.apis) {
          if (typeof api?.name !== 'string' || !api.name.trim()) throw new HttpError(400, 'bad_request', 'у каждого api нужно name')
          if (!Array.isArray(api.methods) || !api.methods.length) throw new HttpError(400, 'bad_request', `у api «${api.name}» нет методов`)
          for (const m of api.methods) {
            if (typeof m?.method !== 'string' || !m.method.trim()) throw new HttpError(400, 'bad_request', `у api «${api.name}» метод без имени`)
            if (!m.args || typeof m.args !== 'object') throw new HttpError(400, 'bad_request', `метод «${m.method}» без схемы args`)
          }
        }
        store.db.prepare('UPDATE node SET proto = COALESCE(?, proto), client_version = COALESCE(?, client_version) WHERE id = ?')
          .run(Number(body.proto) || null, body.clientVersion ?? body.client_version ?? null, node.id)
        const result = store.announce(node.id, body.apis)
        for (const warning of result.warnings) log('warn', 'apidef-conflict', { node: node.id, warning })
        return json(res, 200, { apis: result.apis, warnings: result.warnings, epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/catalog' && method === 'GET') {
        return json(res, 200, { epoch: queue.epoch, apis: store.catalog() })
      }

      if (path === '/v1/state' && method === 'GET') {
        return json(res, 200, { node: node.id, online: online(node), epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/commands' && method === 'GET') {
        const after = Number(params.get('after') ?? 0)
        const limit = Number(params.get('limit') ?? 0) || undefined
        const taken = queue.take(node.id, { after, limit })
        return json(res, 200, taken)
      }

      const resultMatch = /^\/v1\/commands\/(\d+)\/result$/.exec(path)
      if (resultMatch && method === 'POST') {
        const seq = Number(resultMatch[1])
        const body = await readJson(req, maxBody)
        const outcome = queue.close(node.id, seq, body)
        if (outcome === 'unknown') return json(res, 404, { code: 'bad_request', message: `нет команды ${seq}` })
        if (outcome === 'already') {
          log('info', 'late-result', { node: node.id, seq })
          return json(res, 409, { code: 'bad_request', message: `команда ${seq} уже закрыта` })
        }
        return json(res, 200, { seq, ok: Boolean(body.ok) })
      }

      return json(res, 404, { code: 'bad_request', message: `${method} ${path} не поддержан` })
    } catch (error) {
      if (error instanceof HttpError) {
        return json(res, error.status, { code: error.code, message: error.message })
      }
      log('error', 'handler-crash', { error: error?.message ?? String(error), path })
      return json(res, 500, { code: 'internal', message: 'internal error' })
    }
  }

  return { handle, route, config }
}

/** Новый uuid для серверных нужд (тесты, локальный узел). */
export function uuid () {
  return randomUUID()
}
