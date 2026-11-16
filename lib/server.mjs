/**
 * The HTTP surface of dsh-nodes without harness dependencies: an ordinary handler
 * for node:http. The plugin (§ index.mjs) only mounts it on webServer, while tests
 * start http.createServer directly — that way the slice is checked as a whole.
 *
 * @module dsh-nodes/server
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createConnStats } from './conn-stats.mjs'
import { newToken } from './db.mjs'
import { parseApplyRules } from './special-rules.mjs'
import { deliverEvent, renderDeviceEvent } from './devices.mjs'
import { bugReportOf, eventTypeOf, receiveVoiceUpload } from './voice-upload.mjs'
import { commandMode, commandPath, discardPipe, fileResponse, finalizePipe, inspect, receive, requireCommand, TransferError } from './transfer.mjs'

/** We answer nothing before the timeout: the body is read with a ceiling. */
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
 * Build the handlers.
 * @param {object} options
 * @param {import('./db.mjs').Store} options.store
 * @param {import('./queue.mjs').Queue} options.queue
 * @param {object} options.config parsed plugin config
 * @param {(level: string, message: string, extra?: object) => void} [options.log]
 * @param {ReturnType<typeof createConnStats>} [options.connStats] live counters, shared with the admin API
 */

/**
 * Read the "I want to talk" shape out of an event body, or null when it is an ordinary event.
 *
 * A device cannot push a recording by itself: the transfer endpoint only accepts an answer to
 * a `copyFromDevice` command. So the phone says it wants to talk, and the host — a plugin
 * listening for this — asks for the recording. Nothing of this reaches a session.
 *
 * @param body - the parsed request body.
 * @returns `{mode}` for a voice request, otherwise null.
 */
export function voiceWantOf (body) {
  if (!body?.voice || typeof body.voice !== 'object') return null
  if (body.voice.want !== 'record') return null
  return { mode: body.voice.mode === 'toggle' ? 'toggle' : 'ptt' }
}

/**
 * Answer a voice request: either the device may not send events at all, or the host is told.
 *
 * @param args - the authenticated node, the request, the session it named (if any).
 * @returns an HTTP status and payload, ready for `json()`.
 */
export function acceptVoiceWant ({ node, want, sessionId, services, log = () => {} }) {
  if (node?.events_enabled === 0) {
    return {
      status: 403,
      payload: { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` },
    }
  }
  const event = {
    node: node.id,
    nodeName: node.name,
    mode: want.mode,
    sessionId: sessionId || null,
  }
  services?.emit?.('dsh-nodes/voice-want', event)
  log('info', 'voice-want', event)
  return { status: 202, payload: { accepted: true, device: node.name, mode: want.mode } }
}

export function createNodesServer ({ store, queue, config, log = () => {}, presence, services = null, connStats = createConnStats() }) {
  const prefix = (config.routePrefix ?? '/dsh-nodes').replace(/\/$/, '')
  // The result body may carry a file chunk in base64: a million is not enough.
  // Only JSON bodies are capped by this — announce, results, admin calls. A file transfer
  // is a stream (`lib/transfer.mjs`) and is never read here: its one ceiling is
  // `maxTransferBytes`, because a stream goes to a file and memory is bounded by the
  // stream itself, not by its length. Anything above the limit is refused with 413.
  const maxBody = config.maxBodyBytes ?? 4 * 1024 * 1024
  const aliveMs = (config.aliveTimeoutSeconds ?? 60) * 1000

  /**
   * Pipe streams still waiting for the verdict of their command, keyed `nodeId:seq`.
   *
   * A chunked `pipeFromDevice` body is written to `<hostPath>.inprogress` and renamed only by
   * the command's result. The map remembers the temporary path, and `closePipe` is the single
   * place that empties it: on the result, and — through `queue.setAbandon` — when the command
   * is closed without one (timeout, `lost`, expiry, cancel, node restart). Otherwise a node
   * that disappears mid-stream leaves up to `maxTransferBytes` of garbage on disk, and the
   * map grows for as long as the server runs.
   */
  const pendingPipes = new Map()

  /**
   * Close the temporary file of a pipe command: rename it on success, drop it otherwise.
   *
   * `command` is `{seq, method, args}`: the issued command, or what is left of it when the
   * queue already closed it. The path comes from the command, never from the request body.
   *
   * @returns the finished file (`{path, bytes}`) or null when there was nothing to close.
   */
  function closePipe (nodeId, command, { ok = false, code = null, abandoned = false }) {
    const key = `${nodeId}:${command?.seq}`
    const fromCommand = command?.method === 'pipeFromDevice' && typeof command.args?.hostPath === 'string'
      ? `${command.args.hostPath}.inprogress`
      : null
    const part = pendingPipes.get(key) ?? fromCommand
    if (!part) return null
    pendingPipes.delete(key)
    if (ok) {
      const done = finalizePipe(part)
      log('info', 'pipe-finalized', { node: nodeId, seq: command?.seq, bytes: done.bytes })
      return done
    }
    discardPipe(part)
    // a command abandoned without a verdict is a warning: the model was told "lost", and the
    // half-written file it left behind is what this line is about
    log(abandoned ? 'warn' : 'info', abandoned ? 'pipe-abandoned' : 'pipe-discarded', {
      node: nodeId, seq: command?.seq, code, path: part,
    })
    return null
  }

  // The queue knows nothing about files; it only says "this command is closed without a
  // result". Cleaning up a leftover file must never break the sweep either.
  queue?.setAbandon?.((nodeId, command, code) => {
    try {
      closePipe(nodeId, command, { ok: false, code, abandoned: true })
    } catch (error) {
      log('warn', 'pipe-abandon-failed', { node: nodeId, seq: command?.seq, code, error: error?.message ?? String(error) })
    }
  })

  /** Path parsing: prefix + the rest, without query. */
  function route (url) {
    const path = (url ?? '/').split('?')[0]
    if (path !== prefix && !path.startsWith(prefix + '/')) return null
    return path.slice(prefix.length) || '/'
  }

  function query (url) {
    return new URL(url ?? '/', 'http://x').searchParams
  }

  /** Node token from the header; otherwise 401 without details. */
  function authNode (req) {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (.+)$/.exec(header.trim())
    if (!match) throw new HttpError(401, 'unauthorized', 'нужен Bearer-токен')
    const node = store.nodeByToken(match[1])
    if (!node) throw new HttpError(401, 'unauthorized', 'токен не подходит')
    store.touch(node.id)
    return node
  }

  /** External address: config beats headers, after it — what came from the proxy. */
  function origin (req) {
    if (config.publicUrl) return String(config.publicUrl).replace(/\/$/, '')
    const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http'
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
    return `${proto}://${host}`
  }

  /**
   * "Online" is about an open channel, not about how fresh a timestamp is.
   *
   * There used to be a fallback here, "last_seen not older than a minute", and it lied:
   * a node with a stretched ping (15 s × 10 = 150 s) stays silent longer than a minute although
   * the channel is open. Now the socket decides presence, while the time of the last link
   * is returned in a separate `lastSeen` field — let the consumer look for itself.
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
      clientVersion: node.client_version,
      platform: node.platform ?? null,
      access: node.access,
      workdir: node.workdir,
      allowEscalation: Boolean(node.allow_escalation),
      ...queue.info(node.id),
    }
  }

  /**
   * A generation from the wire: an integer, or `null` when the client said nothing.
   *
   * `null` is a statement of its own — "I do not know" — and the empty string and the
   * literal `null` a query can carry mean the same. Anything else that is not a whole
   * number is a broken request rather than a guess we should make for the client.
   */
  function generation (value, field) {
    if (value === null || value === undefined || value === '' || value === 'null') return null
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0) {
      throw new HttpError(400, 'bad_request', `${field} должен быть целым числом`)
    }
    return number
  }

  /**
   * Refuse a client that names another generation, before anything is written.
   *
   * `epoch` is the server's own generation: a different one means the client is talking
   * from another life of the server, and its numbers have nothing to do with ours.
   * `client_epoch` is the client's counter: lower than the one already known for this node
   * means an older instance is talking, and it must not push the newer one out.
   *
   * A mismatch is a refusal, not a repair: the client reconnects from scratch and announces
   * `epoch: null`, which is the only statement that closes in-flight commands.
   */
  function guardGenerations (node, { epoch, clientEpoch }) {
    if (epoch !== null && epoch !== queue.epoch) {
      log('warn', 'epoch-mismatch', { node: node.id, got: epoch, current: queue.epoch })
      throw new HttpError(409, 'epoch-mismatch',
        `поколение сервера ${queue.epoch}, у клиента ${epoch}: объявись заново с epoch: null`)
    }
    const known = store.clientEpoch(node.id)
    if (clientEpoch !== null && known !== null && clientEpoch < known) {
      log('warn', 'client-epoch-stale', { node: node.id, got: clientEpoch, known })
      throw new HttpError(409, 'client-epoch-stale',
        `поколение клиента ${clientEpoch} старше известного ${known}: это старый экземпляр узла`)
    }
  }

  /** The number a node claims to know is only logged: the reaction is not decided yet. */
  function warnCommandno (node, claimed) {
    if (claimed === null) return
    const info = queue.info(node.id)
    if (claimed !== info.max_commandno) {
      log('warn', 'max-commandno-mismatch', { node: node.id, claimed, actual: info.max_commandno })
    }
  }

  /**
   * The shape of every declared api — checked before anything is written.
   *
   * A malformed declaration is a broken request, not a partial one: the whole
   * announcement is refused and the node keeps exactly the state it had. That is why
   * this runs before the node fields are touched, not in the middle of the writes.
   */
  function checkApis (apis) {
    if (!Array.isArray(apis)) throw new HttpError(400, 'bad_request', 'нужен массив apis')
    for (const api of apis) {
      const name = api?.name
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'bad_request', 'у каждого api нужно name')
      // the contract version is a string, or null when the api belongs to the node alone
      if (api.version !== undefined && api.version !== null && typeof api.version !== 'string') {
        throw new HttpError(400, 'bad_request', `у api «${name.trim()}» version должен быть строкой или null`)
      }
      if (!Array.isArray(api.methods) || !api.methods.length) {
        throw new HttpError(400, 'bad_request', `у api «${name.trim()}» нет методов`)
      }
      for (const m of api.methods) {
        if (typeof m?.method !== 'string' || !m.method.trim()) {
          throw new HttpError(400, 'bad_request', `у api «${name.trim()}» метод без имени`)
        }
        if (!m.args || typeof m.args !== 'object') {
          throw new HttpError(400, 'bad_request', `метод «${m.method}» без схемы args`)
        }
      }
    }
  }

  /**
   * The platform the client reports: `desktop`, `android`.
   *
   * A display fact, so a broken value never refuses the announcement — it is ignored
   * and logged. Says nothing (absent, not a string) — the old value stays: an older
   * client that does not know the field must not null out what a newer one told us.
   */
  function platformPatch (value, nodeId) {
    if (typeof value !== 'string') return null
    const platform = value.trim()
    if (!platform || platform.length > 32) {
      log('warn', 'platform-ignored', { node: nodeId, value: String(value).slice(0, 64) })
      return null
    }
    return platform
  }

/**
   * File transfer within an issued command.
   *
   * Lives here, not in the admin routes: `/api/*` is closed by DSH authorization (the owner
   * cookie is needed), while a node comes with a Bearer token and has nothing else.
   *
   * The body is never read here: it goes straight into `receive`, which streams it to a file.
   * Do not add `readJson` on this path — that would put the JSON limit on top of a stream and
   * a long pipe would die with 413. The transfer ceiling is `maxTransferBytes`.
   */
  /**
   * A recording the device pushed on its own.
   *
   * No `seq`, no command: authorisation is the node token, the path is chosen here, and the
   * whole file is either stored or refused. The event is what a voice plugin listens to.
   */
  /** Say once, not per event, that a device sends events without a `type`. */
  let warnedMissingEventType = false
  function warnMissingEventType (message) {
    if (warnedMissingEventType) return
    warnedMissingEventType = true
    log('warn', 'event-type-missing', { message })
  }

  async function handleVoiceUpload (req, res, params) {
    try {
      const node = authNode(req)
      if (node.events_enabled === 0) {
        return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
      }
      const answer = await receiveVoiceUpload({
        stream: req,
        headers: req.headers,
        node,
        query: params,
        config,
        services,
        log,
      })
      return json(res, 202, answer)
    } catch (error) {
      const status = error instanceof TransferError ? error.status : 500
      const code = error instanceof TransferError ? error.code : 'internal'
      return json(res, status, { code, message: error.message ?? String(error) })
    }
  }

  async function handleTransfer (req, res, kind) {
    try {
      const node = authNode(req)
      const seq = query(req.url).get('seq')
      // upload serves both a file transfer by the node and the stream of its command
      // A voice command carries exactly one file, and its path comes from `args.path` like any
      // other — so it is allowed to serve that file. Without this the device could never download
      // the audio an answer points at: the only live ticket is the command itself.
      const method = kind === 'upload'
        ? ['copyFromDevice', 'pipeFromDevice']
        : ['copyToDevice', 'pipeToDevice', 'voice.answer', 'voice.play']
      const command = requireCommand({ queue, node, method, seq, store })
      if (kind === 'upload') {
        const mode = commandMode(command, req.headers['x-mode'])
        const result = await receive({ stream: req, headers: req.headers, command, mode, config })
        if (result?.pending) {
          // The command may have died while the body was on its way: cancelled, swept as
          // `lost`, or the node restarted. Then no verdict will ever come for this file —
          // and filing it under `pendingPipes` would be the leak this map exists to avoid.
          // Nothing is stored and the device is told honestly.
          if (!queue.issued(node.id, seq)) {
            try {
              discardPipe(result.path)
            } catch {}
            return json(res, 409, { code: 'command_closed', message: `команда ${seq} уже закрыта: файл не принят` })
          }
          pendingPipes.set(`${node.id}:${seq}`, result.path)
        }
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
      // the refusal text matters: the model reads it and understands what exactly is wrong
      return json(res, status, { code, message: error.message ?? String(error) })
    }
  }

/**
   * A device event: a button in a notification, readiness, anything.
   *
   * The node sends a minimum — the session number, the text and (if any) the button mark.
   * The device name, the time and the interpretation are added by the server: the client must not
   * be given the right to speak for the human.
   */
  async function handleDeviceEvent (req, res) {
    try {
      const node = authNode(req)
      const body = await readJson(req, maxBody)
      // What kind of event this is, in the vocabulary of docs/device-events.md. A body without a
      // type, or with the old `notify`, is read by its own fields and the host says so once.
      // The old "I want to talk" shape: no text, no type. It stays before the type check for the
      // same reason it exists — the clients that send it are still installed.
      const want = voiceWantOf(body)
      if (want) {
        // No session here on purpose: this shape predates the vocabulary and never carried one.
        // Reading the notify branch's `sessionId` above its declaration was a 500 for every
        // installed client that still sends it.
        const wantSession = String(body.session ?? '').trim() || null
        const answer = acceptVoiceWant({ node, want, sessionId: wantSession, services, log })
        return json(res, answer.status, answer.payload)
      }
      const typed = eventTypeOf(body, { warnOnce: warnMissingEventType })
      if (typed.error) return json(res, typed.error.status, { code: typed.error.code, message: typed.error.message })
      if (typed.type === 'voice-warmup') {
        // The person opened the voice screen. Nothing to deliver and nobody to answer: the plugin
        // that listens may warm its model up, and this endpoint stays a pure acknowledgement.
        if (node.events_enabled === 0) {
          return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
        }
        services?.emit?.('dsh-nodes/voice-warmup', { node: node.id, nodeName: node.name })
        log('info', 'device-event', { node: node.id, type: typed.type })
        return json(res, 202, { accepted: true })
      }
      if (typed.type === 'bug-report') {
        // A fact about the app, not a message from a person: it starts nothing here, only the
        // plugin that listens decides what to do with it.
        if (node.events_enabled === 0) {
          return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
        }
        const report = bugReportOf(body)
        services?.emit?.('dsh-nodes/bug-report', { node: node.id, nodeName: node.name, ...report })
        log('info', 'bug-report', { node: node.id, kind: report.kind, id: report.id })
        return json(res, 202, { accepted: true, id: report.id })
      }
      if (typed.type === 'new-session') {
        // "Start a new conversation": no text, no session, nothing to deliver. The voice plugin
        // forgets which session this device was talking to, and the next input begins a new one.
        if (node.events_enabled === 0) {
          return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
        }
        services?.emit?.('dsh-nodes/voice-new-session', { node: node.id, nodeName: node.name })
        log('info', 'device-event', { node: node.id, type: typed.type })
        return json(res, 202, { accepted: true, device: node.name })
      }
      // a button press comes with the notification number: then both the session and the
      // "why" are taken from the server record, not from the device's words
      const notification = body.notification ? store.notification(String(body.notification)) : null
      const sessionId = String(notification?.session ?? body.session ?? '').trim()
      const text = String(body.text ?? '').trim()
      if (notification?.answered_at) {
        return json(res, 200, { delivered: false, already: true, message: 'эта кнопка уже была нажата' })
      }
      if (node.events_enabled === 0) {
        return json(res, 403, { code: 'events_disabled', message: `для устройства ${node.name} события выключены в админке` })
      }
      if (notification) store.answerNotification(notification.id, body.button ?? 'ответ', body.id ? String(body.id) : null)
      // we take the button label from our own record: the client sends only "b1",
      // and the human must see "yes", not a machine number
      const label = notification
        ? (notification.buttons?.find((item) => item.id === body.button)?.label ?? body.button ?? null)
        : (body.button ? String(body.button).slice(0, 64) : null)
      const rendered = renderDeviceEvent({
        node: node.name,
        button: label,
        // on a press the text is composed by the server: the client's "a button was pressed"
        // is not a human message but a service line
        text: notification ? '' : text,
        purpose: notification?.purpose ?? (body.purpose ? String(body.purpose).slice(0, 500) : null),
        at: new Date().toLocaleString('ru-RU'),
      })
      const outcome = await deliverEvent({
        ctx: services,
        sessionId,
        text: rendered,
        source: { node: node.name, nodeId: node.id, button: body.button ?? null, eventId: body.id ?? null },
      })
      if (!outcome.ok) return json(res, outcome.status, { code: 'not_delivered', message: outcome.message })
      log('info', 'device-event', { node: node.id, type: typed.type, session: sessionId, button: body.button ?? null })
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
      // ── public: enrollment requests (§9.1) ──────────────────────────
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
          clientVersion: body.clientVersion ?? body.client_version ?? null,
          ip: req.socket.remoteAddress ?? null,
          // the uuid is not a secret: only whoever knows the nonce gets the token on enrollment
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
        // the token is given out once: after that only a reissue in the admin panel
        if (row.handed_at) return json(res, 409, { status: 'handed' })
        // the uuid lies in the config and shows up in logs, so the token goes only to
        // whoever knows the nonce sent at enrollment
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

      // ── exchange of a pairing code for a token (public) ──────────────────────
      if (path === '/v1/pair' && method === 'POST') {
        const body = await readJson(req, maxBody)
        const code = typeof body.code === 'string' ? body.code.trim() : ''
        if (!code) throw new HttpError(400, 'bad_request', 'нужен код из ссылки')
        const row = store.consumePairing(code)
        if (!row) throw new HttpError(404, 'bad_request', 'код не подходит')
        if (row.error === 'used') throw new HttpError(409, 'bad_request', 'код уже использован')
        if (row.error === 'expired') throw new HttpError(410, 'bad_request', 'код истёк')
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : `node-${(body.uuid ?? '').slice(0, 8) || 'new'}`
        // the same phone may come again (reinstall, new code): we recognise it
        // by uuid and reconnect it — the name and aliases stay as they were,
        // and no duplicate appears in the node list
        const known = body.uuid ? store.nodeByUuid(String(body.uuid)) : null
        if (known) {
          const token = store.reissueToken(known.id)
          log('info', 'pair-reconnect', { node: known.id, uuid: String(body.uuid) })
          return json(res, 200, { node: known.id, name: known.name, token })
        }
        const alias = store.freeAlias(name)
        const { node, token } = store.createNode({ name: alias, uuid: body.uuid ? String(body.uuid) : null })
        // the client may bring several names at once: "nbw", "laptop", "notebook"
        const extra = Array.isArray(body.aliases) ? body.aliases.filter((value) => typeof value === 'string' && value.trim()) : []
        const applied = []
        for (const candidate of extra.slice(0, 8)) {
          const wanted = candidate.trim().slice(0, 64)
          if (wanted.toLowerCase() === alias.toLowerCase()) continue
          const free = store.freeAlias(wanted)
          store.setAlias(node.id, free)
          applied.push(free)
        }
        // the protocol version is gone from the wire: only the client version is stored
        store.db.prepare('UPDATE node SET client_version = ? WHERE id = ?')
          .run(body.clientVersion ?? null, node.id)
        store.markPairingUsed(code, node.id)
        log('info', 'pairing-used', { node: node.id, alias })
        return json(res, 200, { token, node: node.id, name: node.name, alias, aliases: [alias, ...applied], base: `${prefix}` })
      }

      // ── admin ────────────────────────────────────────────────────────
      if (path === '/admin' || path === '/admin/') {
        // the admin panel lives behind DSH authorization; people come here only by an old link
        res.writeHead(302, { location: '/api/dsh-nodes/admin', 'cache-control': 'no-store' })
        return res.end()
      }

      // ── node ─────────────────────────────────────────────────────────────
      const node = authNode(req)

      if (path === '/v1/announce' && method === 'PUT') {
        const body = await readJson(req, maxBody)
        // Generations come first, before any write: a mismatch must leave the node exactly
        // as it was — same apis, same ceiling, same in-flight commands
        const epoch = generation(body.epoch, 'epoch')
        const clientEpoch = generation(body.client_epoch, 'client_epoch')
        guardGenerations(node, { epoch, clientEpoch })
        // `epoch: null` is the only statement of "I lost my state": the client restarted and
        // everything issued to it died with it. This is where in-flight commands are closed —
        // no socket frame may do it, because a socket comes and goes without the node dying.
        if (epoch === null) {
          const lost = queue.failInFlight(node.id, 'node_restarted')
          if (lost) log('warn', 'node-restarted', { node: node.id, lost })
        }
        if (!Array.isArray(body.apis)) throw new HttpError(400, 'bad_request', 'нужен массив apis')
        // Everything is checked before anything is written: generations are already done,
        // the shape of the declaration comes next, then the rules, then the contract
        // conflicts. Only after all of it does one transaction write the node fields,
        // the apis and the bindings together — a refusal at any step leaves the node
        // exactly as it was.
        checkApis(body.apis)
        // the node's own fields: the declaration is one fact, its fields are part of it
        const patch = {}
        // the client's generation lives on disk: it must survive a server restart, otherwise
        // a stale instance would look newest after every restart
        // A number different from the stored one is a new life of the node: the counters of
        // the previous one mean nothing. The reset happens only after the write succeeds:
        // a refused announcement must change nothing at all.
        const clientEpochChanged = clientEpoch !== null && clientEpoch !== store.clientEpoch(node.id)
        if (clientEpoch !== null) patch.client_epoch = clientEpoch
        // the protocol version is gone from the wire: only the client version is stored,
        // and it is not nulled out by a client that forgot to send it
        const clientVersion = body.clientVersion ?? body.client_version ?? null
        if (clientVersion) patch.client_version = clientVersion
        if (typeof body.workdir === 'string' && body.workdir.trim()) {
          patch.workdir = body.workdir.trim().slice(0, 1024)
        }
        // the permission ceiling and the right to ask are set by the node owner on their side
        if (typeof body.access === 'string' && ['ro', 'rw', 'full'].includes(body.access)) {
          patch.access = body.access === 'ro' ? 'read-only' : body.access === 'rw' ? 'workspace-write' : 'danger-full-access'
        }
        if (typeof body.base === 'string' && ['ro', 'rw', 'full'].includes(body.base)) {
          patch.base = body.base
        }
        if (typeof body.allowEscalation === 'boolean') patch.allow_escalation = body.allowEscalation ? 1 : 0
        // `approver: local` is a promise that the node can ask the human.
        // There is nothing left to check in the declaration: the question goes as a service command
        // `#INTERNAL.APPROVE`, not as an API method. Did not implement it — it answers
        // `unknown_method`, and that is an honest refusal.
        if (typeof body.approver === 'string') patch.approver = body.approver
        // what the client runs on: cosmetic, so a bad value is ignored rather than refused
        const platform = platformPatch(body.platform, node.id)
        if (platform) patch.platform = platform
        // uptime: the client says how much has passed since start, we translate it into
        // our own clock — someone else's clock is none of our business
        if (Number.isFinite(Number(body.uptimeSeconds)) && Number(body.uptimeSeconds) >= 0) {
          patch.boot_at = Date.now() - Math.round(Number(body.uptimeSeconds) * 1000)
        }
        // we parse the rules BEFORE writing and from the request body: otherwise the refusal would come
        // after the apis are already fixed, and the node would stay half declared.
        // The bindings do not need API numbers — the transaction will issue them.
        const rules = parseApplyRules(body.applyRules, {
          resolve: (name, version, method) => {
            const candidates = (body.apis ?? []).filter(
              (api) => api?.name === name && (version === null || (api.version ?? null) === version),
            )
            if (!candidates.length) return null
            // without a version we take the one where the method is really declared
            const withMethod = candidates.find((api) => (api.methods ?? []).some((item) => item?.method === method))
            return { def: withMethod ?? candidates[0] }
          },
        })
        if (rules.errors.length) {
          for (const problem of rules.errors) log('error', 'apply-rules-invalid', { node: node.id, problem })
          throw new HttpError(400, 'apply-rules-invalid', rules.errors.join('; '))
        }
        // a contract that another node already declared with other methods is refused here,
        // by a pure read: the node is still untouched, so nothing has to be rolled back.
        // The same check runs again inside the transaction as the last line.
        const conflicts = store.apidefConflicts(node.id, body.apis)
        if (conflicts.length) {
          for (const conflict of conflicts) {
            log('error', 'apidef-conflict', {
              node: node.id, api: conflict.api, version: conflict.version, holders: conflict.holders,
            })
          }
          throw new HttpError(400, 'apidef-conflict', conflicts[0].message)
        }

        let result
        try {
          // the node fields, the apis and the rule bindings are one transaction: all or nothing
          result = store.announce(node.id, body.apis, rules.bindings, patch)
        } catch (error) {
          if (error?.code === 'apidef-conflict') {
            // the schema of the (name, version) pair is already taken by another node with other
            // methods: silently taking someone else's schema means executing commands against a
            // contract the node never promised. We refuse the declaration
            log('error', 'apidef-conflict', { node: node.id, api: error.api, version: error.version, holders: error.holders })
            throw new HttpError(400, 'apidef-conflict', error.message)
          }
          throw error
        }
        for (const warning of rules.warnings) {
          log('warn', 'apply-rules-warning', { node: node.id, warning })
          result.warnings.push(warning)
        }
        // the declaration is written: only now is the node's new life a fact
        if (clientEpochChanged) connStats.reset(node.id)

        const apis = result.apis.map((id) => {
          const def = store.api(id)
          return { id, name: def?.name ?? String(id), version: def?.version ?? null }
        })
        return json(res, 200, { apis, warnings: result.warnings, epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/events' && method === 'POST') return await handleDeviceEvent(req, res)
      if (path === '/v1/upload-file' && method === 'POST') {
        // A voice recording arrives without a command: the device pushes, the host receives.
        // Everything else on this route is still an answer to copyFromDevice/pipeFromDevice.
        // `type=voice` names the route by itself; an `action` a client may still send is ignored.
        if (params.get('type') === 'voice') return await handleVoiceUpload(req, res, params)
        return await handleTransfer(req, res, 'upload')
      }
      if (path === '/v1/download-file' && method === 'POST') return await handleTransfer(req, res, 'download')
      if (path === '/v1/state' && method === 'GET') {
        return json(res, 200, { node: node.id, online: online(node), epoch: queue.epoch, ...queue.info(node.id) })
      }

      if (path === '/v1/commands' && method === 'GET') {
        // the generations travel as query parameters: the client states where it stands
        // before it takes work, and a mismatch is a refusal instead of a batch from a life
        // the client does not belong to
        const epoch = generation(params.get('epoch'), 'epoch')
        const clientEpoch = generation(params.get('client_epoch'), 'client_epoch')
        guardGenerations(node, { epoch, clientEpoch })
        // the counters belong to one server generation: a refused request is not counted
        // either, it never reached the queue
        connStats.syncGeneration(queue.epoch)
        connStats.bumpCommands(node.id)
        // the number the client claims to know is logged only: whatever the decision will be,
        // it is not taken here
        warnCommandno(node, generation(params.get('max_commandno'), 'max_commandno'))
        // no `after`: issuing goes from the head of the queue, what is taken is marked
        // `processing` and never issued again
        const limit = Number(params.get('limit') ?? 0) || undefined
        return json(res, 200, queue.take(node.id, { limit }))
      }

      const resultMatch = /^\/v1\/commands\/(\d+)\/result$/.exec(path)
      if (resultMatch && method === 'POST') {
        const seq = Number(resultMatch[1])
        const body = await readJson(req, maxBody)
        // we look at the command BEFORE close: close takes it out of the queue, and the path
        // would stay unknown
        const known = queue.issued(node.id, seq) ?? null
        // `now` is the node clock in the answer envelope: from it the timing rule computes
        // the skew without relying on the result contents
        const outcome = queue.close(node.id, seq, body)
        if (outcome === 'unknown') return json(res, 404, { code: 'bad_request', message: `нет команды ${seq}` })
        if (outcome === 'already') {
          log('info', 'late-result', { node: node.id, seq })
          return json(res, 409, { code: 'bad_request', message: `команда ${seq} уже закрыта` })
        }
        // the counters belong to one server generation, exactly as in the fetch route: a
        // result that arrived after a restart counts in the new life, not the old one
        connStats.syncGeneration(queue.epoch)
        connStats.bumpResults(node.id)
        // Pipe: while there is no verdict, the output lies under .inprogress. On success we
        // rename, on refusal we delete, so that half a file does not look like
        // a finished result. `known` may be gone already — the path then comes from `seq`
        // and the command the queue still had when we looked at it.
        try {
          closePipe(node.id, { seq, method: known?.method, args: known?.args }, {
            // the same truthiness the queue used: a client that sends `ok: 1` is not a failure
            ok: Boolean(body.ok),
            code: body.code ?? null,
          })
        } catch (error) {
          log('warn', 'pipe-finish-failed', { node: node.id, seq, error: error.message })
        }
        return json(res, 200, { seq, ok: Boolean(body.ok) })
      }

      return json(res, 404, { code: 'bad_request', message: `${method} ${path} не поддержан` })
    } catch (error) {
      if (error instanceof HttpError) {
        return json(res, error.status, { code: error.code, message: error.message })
      }
      log('error', 'handler-crash', { error: error?.message ?? String(error), path })
      // into the service log: without a stack such errors are hunted blindly
      console.error('[dsh-nodes] handler-crash', path, error?.stack ?? error)
      return json(res, 500, { code: 'internal', message: 'internal error' })
    }
  }

  // `pendingPipes` is exposed for tests only: the leak it used to have (an entry per lost
  // pipe, for the lifetime of the process) can only be checked by looking at the map.
  return { handle, route, config, pendingPipes }
}

/** A new uuid for server needs (tests, the local node). */
export function uuid () {
  return randomUUID()
}
