/**
 * HTTP-поверхность dsh-nodes без зависимостей от harness: обычный обработчик
 * для node:http. Плагин (§ index.mjs) только вешает его на webServer, а тесты
 * поднимают http.createServer напрямую — так срез проверяется целиком.
 *
 * @module dsh-nodes/server
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { newToken } from './db.mjs'

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
 */
export function createNodesServer ({ store, queue, config, log = () => {}, presence }) {
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

  /** Внешний адрес: конфиг важнее заголовков, за ним — то, что пришло от прокси. */
  function origin (req) {
    if (config.publicUrl) return String(config.publicUrl).replace(/\/$/, '')
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http'
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
    return `${proto}://${host}`
  }

  function online (node) {
    if (presence?.online?.(node.id)) return true
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

      // ── обмен кода подключения на токен (публичный) ──────────────────────
      if (path === '/v1/pair' && method === 'POST') {
        const body = await readJson(req, maxBody)
        const code = typeof body.code === 'string' ? body.code.trim() : ''
        if (!code) throw new HttpError(400, 'bad_request', 'нужен код из ссылки')
        const row = store.consumePairing(code)
        if (!row) throw new HttpError(404, 'bad_request', 'код не подходит')
        if (row.error === 'used') throw new HttpError(409, 'bad_request', 'код уже использован')
        if (row.error === 'expired') throw new HttpError(410, 'bad_request', 'код истёк')
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : `node-${(body.uuid ?? '').slice(0, 8) || 'new'}`
        const alias = store.freeAlias(name)
        const { node, token } = store.createNode({ name: alias })
        // клиент может принести несколько имён сразу: «nbw», «ноутбук», «laptop»
        const extra = Array.isArray(body.aliases) ? body.aliases.filter((value) => typeof value === 'string' && value.trim()) : []
        const applied = []
        for (const candidate of extra.slice(0, 8)) {
          const wanted = candidate.trim().slice(0, 64)
          if (wanted.toLowerCase() === alias.toLowerCase()) continue
          const free = store.freeAlias(wanted)
          store.setAlias(node.id, free)
          applied.push(free)
        }
        store.db.prepare('UPDATE node SET proto = ?, client_version = ? WHERE id = ?')
          .run(Number(body.proto) || null, body.clientVersion ?? null, node.id)
        store.markPairingUsed(code, node.id)
        log('info', 'pairing-used', { node: node.id, alias })
        return json(res, 200, { token, node: node.id, alias, aliases: [alias, ...applied], base: `${prefix}` })
      }

      // ── админское ────────────────────────────────────────────────────────
      if (path === '/admin' || path === '/admin/') {
        // админка живёт за авторизацией DSH; сюда приходят только по старой ссылке
        res.writeHead(302, { location: '/api/dsh-nodes/admin', 'cache-control': 'no-store' })
        return res.end()
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
        const apis = result.apis.map((id) => {
          const def = store.api(id)
          return { id, name: def?.name ?? String(id), version: def?.version ?? null }
        })
        return json(res, 200, { apis, warnings: result.warnings, epoch: queue.epoch, ...queue.info(node.id) })
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
