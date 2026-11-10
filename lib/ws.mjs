/**
 * WebSocket presence: `hello` with a generation check, `alive`, the `state` frame.
 *
 * The module does not depend on the harness: `WebSocketServer` is passed in from outside (from
 * the `ws` package), and the face is an ordinary `upgrade` handler for node:http. That way it
 * can be checked by a test without cordis.
 *
 * The token comes NOT in the URL: browser and node WebSocket can pass a
 * subprotocol, and it travels in the `Sec-WebSocket-Protocol` header, that is, it gets
 * neither into proxy logs nor into history.
 *
 * @module dsh-nodes/ws
 */

// Ping is off by default: while we debug the event scheme, extra traffic gets in
// the way. It is turned on by the `wsPingSeconds` setting, and the count of
// misses is turned on at the same time.
const PING_MS = 20_000

const HELLO_MS = 10_000
const MISSED_LIMIT = 3

/** Get the token out of the subprotocol: `new WebSocket(url, [token])`. */
export function tokenFromProtocols (header) {
  if (typeof header !== 'string' || !header) return null
  const first = header.split(',')[0]?.trim()
  return first && first !== 'null' ? first : null
}

/**
 * Node presence.
 * @param {object} options
 * @param {new (options: object) => object} options.WebSocketServer constructor from `ws` (noServer: true)
 * @param {string} options.prefix plugin base path
 * @param {import('./db.mjs').Store} options.store
 * @param {import('./queue.mjs').Queue} options.queue
 * @param {(level: string, message: string, extra?: object) => void} [options.log]
 * @param {number} [options.helloTimeoutMs]
 */
export function createPresence ({ WebSocketServer, prefix, store, queue, log = () => {}, helloTimeoutMs = HELLO_MS, pingSeconds = 0 }) {
  const path = `${prefix.replace(/\/$/, '')}/v1/ws`
  const wss = new WebSocketServer({ noServer: true })
  /** @type {Map<number, {socket: object, waiting: boolean, lastAlive: number, missed: number, alive: object}]} */
  const sessions = new Map()

  function send (session, payload) {
    try {
      session.socket.send(JSON.stringify(payload))
    } catch (error) {
      log('warn', 'ws-send-failed', { error: error.message })
    }
  }

  /** The "there is work" frame: only the current number, nothing else. */
  function pushState (nodeId) {
    const session = sessions.get(nodeId)
    if (!session) return
    const info = queue.info(nodeId)
    send(session, { t: 'state', max_commandno: info.max_commandno, epoch: queue.epoch })
    session.waiting = false
    session.lastPushAt = Date.now()
  }

  /**
   * Notify the node that the counter grew. We send only if the node asked
   * (the `waiting` flag), otherwise it learns from the next `alive` — that way messages
   * collapse and back-pressure comes for free (plan §4.2).
   */
  function notify (nodeId) {
    const session = sessions.get(nodeId)
    if (!session || !session.hello) return
    // The frame goes out ONLY if the node said "I am waiting" with its `alive`. A client
    // that is not waiting (working through a batch) gets nothing: it will send
    // `alive` with a new number itself when it is free.
    if (session.waiting) pushState(nodeId)
  }

  function drop (nodeId, code = 1000, reason = '') {
    const session = sessions.get(nodeId)
    if (!session) return
    sessions.delete(nodeId)
    if (session.alive) clearInterval(session.alive)
    try {
      session.socket.close(code ?? 1000, reason ?? '')
    } catch {}
    log('info', 'ws-closed', { node: nodeId, code })
  }

  function onHello (node, session, frame) {
    // Connection number: the client increments it before every connect.
    // What rules is not the order packets arrive in but the counter — otherwise two loops on one
    // device knock each other out and the log shows `open` without `close`.
    const conn = Number.isFinite(Number(frame.conn)) ? Number(frame.conn) : null
    const current = sessions.get(node.id)
    if (conn !== null && current && current !== session && Number(current.conn) > conn) {
      // a stale connection arrived: we close it and keep the live one
      log('info', 'ws-stale-conn', { node: node.id, got: conn, kept: current.conn })
      return drop(node.id, 4409, 'устаревшее соединение')
    }
    session.conn = conn
    if (conn !== null && current === session) {
      // this connection is newer than the previous one: we push the old one out deliberately
      for (const [id, other] of sessions) {
        if (id === node.id && other !== session && Number(other.conn ?? -1) < conn) {
          log('info', 'ws-newer-conn', { node: node.id, got: conn, dropped: other.conn })
        }
      }
    }
    // the client reports its working directory: we show it in the admin panel and know
    // where the session directories lie
    if (typeof frame.access === 'string' && ['ro', 'rw', 'full'].includes(frame.access)) {
      try {
        store.updateNode(node.id, {
          access: frame.access === 'ro' ? 'read-only' : frame.access === 'rw' ? 'workspace-write' : 'danger-full-access',
        })
      } catch {}
    }
    if (Number.isFinite(Number(frame.uptimeSeconds)) && Number(frame.uptimeSeconds) >= 0) {
      try {
        store.updateNode(node.id, { boot_at: Date.now() - Math.round(Number(frame.uptimeSeconds) * 1000) })
      } catch {}
    }
    if (typeof frame.base === 'string' && ['ro', 'rw', 'full'].includes(frame.base)) {
      try {
        store.updateNode(node.id, { base: frame.base })
      } catch {}
    }
    if (typeof frame.allowEscalation === 'boolean') {
      try {
        store.updateNode(node.id, { allow_escalation: frame.allowEscalation ? 1 : 0 })
      } catch {}
    }
    // the promise "I can ask the human" also arrives over WebSocket: we keep it in
    // one place together with announce, otherwise it would lag after a reconnect
    if (typeof frame.approver === 'string') {
      try {
        // `local` is the node's promise to ask the human. There is nothing to check in the
        // declaration: the question goes as a service command, not as an API method
        store.updateNode(node.id, { approver: frame.approver === 'local' ? 'local' : 'none' })
      } catch {}
    }
    if (typeof frame.workdir === 'string' && frame.workdir.trim() && frame.workdir !== node.workdir) {
      try {
        store.updateNode(node.id, { workdir: frame.workdir.trim().slice(0, 1024) })
      } catch {}
    }
    const knownEpoch = frame.epoch ?? null
    const reconnect = knownEpoch !== null && knownEpoch !== queue.epoch
    const info = queue.info(node.id)
    // the generation changed: the client has its own copy of the state, telling it
    // `reconnect` is enough. The server "resets" nothing — issuing goes from
    // the head of the queue, and there are no old cursors in the protocol any more.
    if (reconnect) log('info', 'ws-epoch-mismatch', { node: node.id, known: knownEpoch, current: queue.epoch })
    send(session, { t: 'hello-ok', epoch: queue.epoch, boot: frame.boot ?? null, max_commandno: info.max_commandno, reconnect })
    session.hello = true
    session.waiting = false
  }

  function onFrame (node, frame) {
    const session = sessions.get(node.id)
    if (!session) return
    if (frame.t === 'hello' && !session.hello) return onHello(node, session, frame)
    if (!session.hello) return
    // `alive` is the old frame name, we understand it for clients already in the field
    if (frame.t === 'check_state' || frame.t === 'alive') {
      session.lastAlive = Date.now()
      session.missed = 0
      store.touch(node.id)
      // The client sends up to which number it is aware of. If ours is bigger —
      // we answer with the same frame at once, so that it does not sit waiting. If it is
      // the same — we stay silent and set the flag: the answer will go out when work appears.
      // That way traffic on an empty queue is zero, and no polling is needed.
      // `known: null` — the client does not know the state at all, that is, it restarted.
      // Everything issued to it died with it: we close those commands with an error,
      // otherwise the model waits for a timeout and does not understand why.
      if (frame.known === null || frame.known === undefined) {
        const lost = queue.failInFlight(node.id, 'node_restarted')
        if (lost) log('warn', 'node-restarted', { node: node.id, lost })
        return pushState(node.id)
      }
      const known = Number(frame.known)
      const info = queue.info(node.id)
      if (info.max_commandno > known) return pushState(node.id)
      session.waiting = true
      return
    }
    // An application-level ping over the socket: the client checks that the server is alive and
    // hears it. We answer with the same id so that the client does not mix up answers.
    // a ping is also a sign of life: a node that holds the channel and pings is alive,
    // even if there were no commands and no HTTP requests
    if (frame.t === 'ping') {
      session.missed = 0
      store.touch(node.id)
      return send(session, { t: 'pong', id: frame.id ?? null })
    }
    if (frame.t === 'pong') {
      session.missed = 0
      store.touch(node.id)
    }
  }

  function accept (node, socket) {
    // one connection per node: a new one pushes the old one out (§7)
    if (sessions.has(node.id)) drop(node.id, 4001, 'replaced')
    const session = { socket, hello: false, waiting: false, lastAlive: Date.now(), missed: 0, alive: null, conn: null }
    sessions.set(node.id, session)
    const helloTimer = setTimeout(() => {
      const current = sessions.get(node.id)
      if (current === session && !session.hello) drop(node.id, 4400, 'нет hello')
    }, helloTimeoutMs)
    if (typeof helloTimer.unref === 'function') helloTimer.unref()

    socket.on('message', (raw) => {
      let frame
      try {
        frame = JSON.parse(raw.toString('utf8'))
      } catch {
        return drop(node.id, 4400, 'кадр не разбирается')
      }
      if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') {
        return drop(node.id, 4400, 'кадр без t')
      }
      onFrame(node, frame)
    })
    socket.on('pong', () => { session.missed = 0 })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      const current = sessions.get(node.id)
      // the socket may have been pushed out by a new one already — then we do not touch the new session
      if (current === session) {
        sessions.delete(node.id)
        if (session.alive) clearInterval(session.alive)
        log('info', 'ws-closed', { node: node.id, code: 1000 })
      }
    })
    socket.on('error', (error) => log('warn', 'ws-error', { node: node.id, error: error.message }))

    // ping is off by default: the socket lives on TCP, not on our frames
    if (pingSeconds > 0) {
      session.alive = setInterval(() => {
        session.missed += 1
        if (session.missed > MISSED_LIMIT) return drop(node.id, 4401, 'молчит')
        try {
          socket.ping()
        } catch {}
      }, pingSeconds * 1000)
      if (typeof session.alive.unref === 'function') session.alive.unref()
    }
  }

  /**
   * The upgrade handler for `webServer.registerUpgrade`.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:stream').Duplex} socket
   * @param {Buffer} head
   */
  function upgrade (req, socket, head) {
    const url = (req.url ?? '/').split('?')[0]
    if (url !== path) {
      socket.destroy()
      return
    }
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol'])
    const node = token ? store.nodeByToken(token) : null
    if (!node) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => accept(node, ws))
  }

  return {
    path,
    upgrade,
    notify,
    // close the node session: needed when a token is revoked, otherwise the node shows as online
    drop,
    online: (nodeId) => sessions.has(nodeId),
    sessions,
    close () {
      for (const nodeId of [...sessions.keys()]) drop(nodeId, 1001, 'server closing')
      wss.close()
    },
  }
}
