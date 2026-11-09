/**
 * HTTP-поверхность dsh-nodes без зависимостей от harness: обычный обработчик
 * для node:http. Плагин (§ index.mjs) только вешает его на webServer, а тесты
 * поднимают http.createServer напрямую — так срез проверяется целиком.
 *
 * @module dsh-nodes/server
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { newToken } from './db.mjs'
import { announcesApprove } from './apidef.mjs'
import { deliverEvent, renderDeviceEvent } from './devices.mjs'
import { commandMode, commandPath, fileResponse, inspect, receive, requireCommand, TransferError } from './transfer.mjs'

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

export function createNodesServer ({ store, queue, config, log = () => {}, presence, services = null }) {
  const prefix = (config.routePrefix ?? '/dsh-nodes').replace(/\/$/, '')
  // тело результата может нести кусок файла в base64: миллиона мало
  const maxBody = config.maxBodyBytes ?? 4 * 1024 * 1024
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

  /**
   * «Онлайн» — это про открытый канал, а не про свежесть отметки времени.
   *
   * Раньше здесь был запасной путь «last_seen не старше минуты», и он врал:
   * узел с растянутым пингом (15 с × 10 = 150 с) молчит дольше минуты, хотя
   * канал открыт. Теперь присутствие решает сокет, а время последней связи
   * отдаётся отдельным полем `lastSeen` — пусть потребитель сам смотрит.
   */
  function online (node) {
    if (typeof presence?.online === 'function') return Boolean(presence.online(node.id))
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

/**
   * Передача файла в рамках выданной команды.
   *
   * Живёт здесь, а не в админ-роутах: `/api/*` закрыт авторизацией DSH (нужна
   * кука владельца), а узел приходит с Bearer-токеном и ничего другого не имеет.
   */
  async function handleTransfer (req, res, kind) {
    try {
      const node = authNode(req)
      const seq = query(req.url).get('seq')
      const method = kind === 'upload' ? 'copyFromDevice' : 'copyToDevice'
      const command = requireCommand({ queue, node, method, seq })
      if (kind === 'upload') {
        const mode = commandMode(command, req.headers['x-mode'])
        const result = await receive({ stream: req, headers: req.headers, command, mode, config })
        return json(res, 200, { code: 'stored', ...result })
      }
      const info = inspect(commandPath(command))
      const answer = fileResponse(info)
      res.writeHead(200, answer.headers)
      answer.stream.pipe(res)
      answer.stream.on('error', () => res.destroy())
      return undefined
    } catch (error) {
      const status = error instanceof TransferError ? error.status : 500
      const code = error instanceof TransferError ? error.code : 'internal'
      // текст отказа важен: модель читает его и понимает, что именно не так
      return json(res, status, { code, message: error.message ?? String(error) })
    }
  }

/**
   * Событие устройства: кнопка в уведомлении, готовность, что угодно.
   *
   * Узел присылает минимум — номер сессии, текст и (если есть) метку кнопки.
   * Имя устройства, время и трактовку добавляет сервер: клиенту нельзя давать
   * право говорить за человека.
   */
  async function handleDeviceEvent (req, res) {
    try {
      const node = authNode(req)
      const body = await readJson(req, maxBody)
      const sessionId = String(body.session ?? '').trim()
      const text = String(body.text ?? '').trim()
      if (!sessionId) return json(res, 400, { code: 'bad_request', message: 'нужен номер сессии: без него событие некуда положить' })
      if (!text) return json(res, 400, { code: 'bad_request', message: 'нужен текст события' })
      if (node.events_enabled === 0) {
        return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
      }
      const rendered = renderDeviceEvent({
        node: node.name,
        button: body.button ? String(body.button).slice(0, 64) : null,
        text,
        purpose: body.purpose ? String(body.purpose).slice(0, 500) : null,
        at: new Date().toLocaleString('ru-RU'),
      })
      const outcome = await deliverEvent({
        ctx: services,
        sessionId,
        text: rendered,
        source: { node: node.name, nodeId: node.id, button: body.button ?? null, eventId: body.id ?? null },
      })
      if (!outcome.ok) return json(res, outcome.status, { code: 'not_delivered', message: outcome.message })
      log('info', 'device-event', { node: node.id, session: sessionId, button: body.button ?? null })
      return json(res, 200, { delivered: true, session: sessionId, device: node.name })
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { code: error.code, message: error.message })
      return json(res, 500, { code: 'internal', message: String(error?.message ?? error) })
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
          // uuid не секрет: токен по заявке получает только тот, кто знает nonce
          nonce: typeof body.nonce === 'string' && body.nonce ? body.nonce.slice(0, 200) : null,
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
        // uuid лежит в конфиге и светится в логах, поэтому токен получает только
        // тот, кто знает nonce, присланный при заявке
        const nonce = params.get('nonce') ?? req.headers['x-dshnc-nonce'] ?? null
        if (!store.enrollmentNonceFits(row.uuid, nonce)) {
          log('warn', 'enroll-nonce-mismatch', { uuid: row.uuid })
          return json(res, 403, { code: 'bad_request', message: 'заявка принадлежит другому клиенту' })
        }
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
        // тот же телефон может прийти снова (переустановка, новый код): его
        // узнаём по uuid и переподключаем — имя и алиасы остаются прежними,
        // а дубликата в списке узлов не появляется
        const known = body.uuid ? store.nodeByUuid(String(body.uuid)) : null
        if (known) {
          const token = store.reissueToken(known.id)
          log('info', 'pair-reconnect', { node: known.id, uuid: String(body.uuid) })
          return json(res, 200, { node: known.id, name: known.name, token })
        }
        const alias = store.freeAlias(name)
        const { node, token } = store.createNode({ name: alias, uuid: body.uuid ? String(body.uuid) : null })
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
        return json(res, 200, { token, node: node.id, name: node.name, alias, aliases: [alias, ...applied], base: `${prefix}` })
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
        if (typeof body.workdir === 'string' && body.workdir.trim()) {
          try {
            store.updateNode(node.id, { workdir: body.workdir.trim().slice(0, 1024) })
          } catch {}
        }
        // потолок прав и разрешение спрашивать задаёт владелец узла у себя
        const patch = {}
        if (typeof body.access === 'string' && ['ro', 'rw', 'full'].includes(body.access)) {
          patch.access = body.access === 'ro' ? 'read-only' : body.access === 'rw' ? 'workspace-write' : 'danger-full-access'
        }
        if (typeof body.base === 'string' && ['ro', 'rw', 'full'].includes(body.base)) {
          patch.base = body.base
        }
        if (typeof body.allowEscalation === 'boolean') patch.allow_escalation = body.allowEscalation ? 1 : 0
        // `approver: local` — обещание, что узел умеет `session.approve`. Без
        // этого метода объявление не принимаем: иначе сервер поставит в очередь
        // команду, которую узел не исполнит, и человек не увидит вопроса.
        if (typeof body.approver === 'string') {
          patch.approver = body.approver
          if (body.approver === 'local' && !announcesApprove(body.apis)) {
            patch.approver = 'none'
            patch.allow_escalation = 0
            console.warn('[dsh-nodes] узел объявил approver=local, но не анонсировал session.approve: считаю none')
          }
        }
        // аптайм: клиент говорит, сколько прошло с запуска, мы переводим это в
        // свой clock — чужие часы нас не интересуют
        if (Number.isFinite(Number(body.uptimeSeconds)) && Number(body.uptimeSeconds) >= 0) {
          patch.boot_at = Date.now() - Math.round(Number(body.uptimeSeconds) * 1000)
        }
        if (Object.keys(patch).length) {
          try {
            store.updateNode(node.id, patch)
          } catch {}
        }
        const result = store.announce(node.id, body.apis)
        for (const warning of result.warnings) log('warn', 'apidef-conflict', { node: node.id, warning })
        const apis = result.apis.map((id) => {
          const def = store.api(id)
          return { id, name: def?.name ?? String(id), version: def?.version ?? null }
        })
        return json(res, 200, { apis, warnings: result.warnings, epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/events' && method === 'POST') return await handleDeviceEvent(req, res)
      if (path === '/v1/upload-file' && method === 'POST') return await handleTransfer(req, res, 'upload')
      if (path === '/v1/download-file' && method === 'POST') return await handleTransfer(req, res, 'download')
      if (path === '/v1/state' && method === 'GET') {
        return json(res, 200, { node: node.id, online: online(node), epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/commands' && method === 'GET') {
        // никакого `after`: выдача идёт с головы очереди, взятое помечается
        // `processing` и больше не выдаётся никогда
        const limit = Number(params.get('limit') ?? 0) || undefined
        return json(res, 200, queue.take(node.id, { limit }))
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
      // в журнал сервиса: без стека такие ошибки ищутся наугад
      console.error('[dsh-nodes] handler-crash', path, error?.stack ?? error)
      return json(res, 500, { code: 'internal', message: 'internal error' })
    }
  }

  return { handle, route, config }
}

/** Новый uuid для серверных нужд (тесты, локальный узел). */
export function uuid () {
  return randomUUID()
}
