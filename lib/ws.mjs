/**
 * WebSocket presence: two frames in, two frames out, and the epoch as the identity token.
 *
 * The module does not depend on the harness: `WebSocketServer` is passed in from outside (from
 * the `ws` package), and the face is an ordinary `upgrade` handler for node:http. That way it
 * can be checked by a test without cordis.
 *
 * There is no handshake frame. The client connects, announces over HTTP (that is where its
 * generation is settled), and says `state` when it starts waiting. Everything the node tells
 * about itself lives in announce; the socket carries one number and nothing else.
 *
 * The token comes NOT in the URL: browser and node WebSocket can pass a
 * subprotocol, and it travels in the `Sec-WebSocket-Protocol` header, that is, it gets
 * neither into proxy logs nor into history.
 *
 * @module dsh-nodes/ws
 */
import { createConnStats } from './conn-stats.mjs'

// Ping is off by default: while we debug the event scheme, extra traffic gets in
// the way. It is turned on by the `wsPingSeconds` setting, and the count of
// misses is turned on at the same time.
const PING_MS = 20_000

const MISSED_LIMIT = 3

/** Close codes this module owns. 4xxx is the application range of the protocol. */
export const CLOSE_EPOCH = 4409
export const CLOSE_CLIENT_EPOCH = 4001
const CLOSE_BAD_FRAME = 4400

/** Get the token out of the subprotocol: `new WebSocket(url, [token])`. */
export function tokenFromProtocols (header) {
  if (typeof header !== 'string' || !header) return null
  const first = header.split(',')[0]?.trim()
  return first && first !== 'null' ? first : null
}

/** An integer or nothing: a generation is a count, not a float and not a string. */
function generation (value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

/**
 * Node presence.
 * @param {object} options
 * @param {new (options: object) => object} options.WebSocketServer constructor from `ws` (noServer: true)
 * @param {string} options.prefix plugin base path
 * @param {import('./db.mjs').Store} options.store
 * @param {import('./queue.mjs').Queue} options.queue
 * @param {(level: string, message: string, extra?: object) => void} [options.log]
 * @param {ReturnType<typeof createConnStats>} [options.connStats] live frame counters, shared with the admin API
 */
export function createPresence ({ WebSocketServer, prefix, store, queue, log = () => {}, pingSeconds = 0, connStats = createConnStats() }) {
  const path = `${prefix.replace(/\/$/, '')}/v1/ws`
  const wss = new WebSocketServer({ noServer: true })
  /** @type {Map<number, {socket: object, waiting: boolean, lastAlive: number, missed: number, alive: object, clientEpoch: number|null}>} */
  const sessions = new Map()

  function send (session, payload) {
    try {
      session.socket.send(JSON.stringify(payload))
      // counted where the frame really leaves, so the number cannot drift from the wire
      connStats.bumpOut(session.nodeId, payload.t)
    } catch (error) {
      log('warn', 'ws-send-failed', { error: error.message })
    }
  }

  /** The "there is work" frame: the generation and the current number, nothing else. */
  function pushState (nodeId) {
    const session = sessions.get(nodeId)
    if (!session) return
    const info = queue.info(nodeId)
    session.waiting = false
    send(session, { t: 'state', epoch: queue.epoch, max_commandno: info.max_commandno })
  }

  /**
   * Notify the node that the counter grew. We send only if the node asked
   * (the `waiting` flag), otherwise it learns from the next fetch — that way messages
   * collapse and back-pressure comes for free (plan §4.2).
   */
  function notify (nodeId) {
    const session = sessions.get(nodeId)
    if (!session) return
    // The frame goes out ONLY if the node said "I am waiting" with its `state` frame. A client
    // that is not waiting (working through a batch) gets nothing: it will send
    // `state` with a new number itself when it is free.
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

  /**
   * The one frame a client sends on purpose: "I am waiting, and I know up to N".
   *
   * Two checks guard it, and both are about identity rather than about the number:
   * the server generation must be the current one, and the client's own generation must
   * not be older than the one already known for this node. A wrong generation means the
   * client is talking from a life of the server (or of itself) that no longer exists; the
   * socket is closed and the client reconnects from scratch, announcing `epoch: null`.
   */
  function onState (node, session, frame) {
    session.lastAlive = Date.now()
    session.missed = 0
    store.touch(node.id)

    const epoch = generation(frame.epoch)
    if (epoch === null || epoch !== queue.epoch) {
      log('warn', 'ws-epoch-mismatch', { node: node.id, got: frame.epoch ?? null, current: queue.epoch })
      return drop(node.id, CLOSE_EPOCH, 'epoch')
    }

    const clientEpoch = generation(frame.client_epoch)
    if (clientEpoch !== null) {
      const known = store.clientEpoch(node.id)
      if (known !== null && clientEpoch < known) {
        log('warn', 'ws-client-epoch-stale', { node: node.id, got: clientEpoch, known })
        return drop(node.id, CLOSE_CLIENT_EPOCH, 'client-epoch')
      }
      // a different number than the one we knew is a new life of the node: the frames
      // counted so far belong to the previous one and are thrown away
      if (clientEpoch !== session.clientEpoch) connStats.reset(node.id)
      session.clientEpoch = clientEpoch
    }

    // The client states the number it knows. A mismatch changes nothing yet: the reaction
    // is undecided, so we only leave a trace with both numbers.
    const claimed = generation(frame.max_commandno)
    const info = queue.info(node.id)
    if (claimed !== null && claimed !== info.max_commandno) {
      log('warn', 'ws-max-commandno-mismatch', { node: node.id, claimed, actual: info.max_commandno })
    }

    // If the server already knows more, answer at once instead of making the client wait
    // for the next command. If the numbers agree, stay silent and remember the wait: the
    // answer will be pushed when work appears, and an idle node costs no traffic.
    if (claimed !== null && info.max_commandno > claimed) return pushState(node.id)
    session.waiting = true
  }

  function onFrame (node, frame) {
    const session = sessions.get(node.id)
    if (!session) return
    // `state` is both "I am alive" and "I am waiting": there is no separate handshake
    if (frame.t === 'state') return onState(node, session, frame)
    // An application-level ping over the socket: the client checks that the server is alive and
    // hears it. We answer with the same number so that the client does not mix up answers.
    // A ping is also a sign of life: a node that holds the channel and pings is alive,
    // even if there were no commands and no HTTP requests.
    if (frame.t === 'ping') {
      session.missed = 0
      store.touch(node.id)
      return send(session, { t: 'pong', no: frame.no ?? null })
    }
    // Nothing else exists on this socket: an unknown frame is a client that speaks another
    // protocol, and pretending to understand it would hide the divergence
    log('warn', 'ws-unknown-frame', { node: node.id, t: frame.t })
    return drop(node.id, CLOSE_BAD_FRAME, 'unknown-frame')
  }

  function accept (node, socket) {
    // counters belong to one server generation: a restart of the server's own counters
    // must not be mixed with what an old socket counted
    connStats.syncGeneration(queue.epoch)
    // one connection per node: a new one pushes the old one out (§7)
    if (sessions.has(node.id)) drop(node.id, 4001, 'replaced')
    const session = {
      nodeId: node.id,
      socket,
      waiting: false,
      lastAlive: Date.now(),
      missed: 0,
      alive: null,
      clientEpoch: store.clientEpoch(node.id),
    }
    sessions.set(node.id, session)

    socket.on('message', (raw) => {
      let frame
      try {
        frame = JSON.parse(raw.toString('utf8'))
      } catch {
        return drop(node.id, CLOSE_BAD_FRAME, 'bad-json')
      }
      if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') {
        return drop(node.id, CLOSE_BAD_FRAME, 'no-t')
      }
      // counted here, next to the parse and before any decision: an unknown frame
      // closes the socket, and the panel must still show that it arrived
      connStats.bumpIn(node.id, frame.t)
      onFrame(node, frame)
    })
    socket.on('pong', () => { session.missed = 0 })
    socket.on('close', () => {
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
        if (session.missed > MISSED_LIMIT) return drop(node.id, 4401, 'silent')
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
