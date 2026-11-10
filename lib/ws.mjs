/**
 * WebSocket-присутствие: `hello` со сверкой поколений, `alive`, кадр `state`.
 *
 * Модуль не зависит от harness: `WebSocketServer` передаётся снаружи (из
 * пакета `ws`), а морда — обычный `upgrade`-обработчик для node:http. Так его
 * можно проверить тестом без cordis.
 *
 * Токен приходит НЕ в URL: браузерный и нодовый WebSocket умеют передавать
 * подпротокол, а он едет заголовком `Sec-WebSocket-Protocol`, то есть не
 * попадает ни в логи прокси, ни в историю.
 *
 * @module dsh-nodes/ws
 */

// Пинг по умолчанию выключен: пока отлаживаем событийную схему, лишний трафик
// мешает. Включается настройкой `wsPingSeconds`, тогда же включается и подсчёт
// пропусков.
const PING_MS = 20_000

const HELLO_MS = 10_000
const MISSED_LIMIT = 3

/** Достать токен из подпротокола: `new WebSocket(url, [token])`. */
export function tokenFromProtocols (header) {
  if (typeof header !== 'string' || !header) return null
  const first = header.split(',')[0]?.trim()
  return first && first !== 'null' ? first : null
}

/**
 * Присутствие узлов.
 * @param {object} options
 * @param {new (options: object) => object} options.WebSocketServer конструктор из `ws` (noServer: true)
 * @param {string} options.prefix базовый путь плагина
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

  /** Кадр «есть работа»: только текущее число, ничего больше. */
  function pushState (nodeId) {
    const session = sessions.get(nodeId)
    if (!session) return
    const info = queue.info(nodeId)
    send(session, { t: 'state', max_commandno: info.max_commandno, epoch: queue.epoch })
    session.waiting = false
    session.lastPushAt = Date.now()
  }

  /**
   * Уведомить узел, что счётчик вырос. Шлём только если узел спрашивал
   * (флаг `waiting`), иначе он узнает по следующему `alive` — так сообщения
   * схлопываются и back-pressure достаётся бесплатно (план §4.2).
   */
  function notify (nodeId) {
    const session = sessions.get(nodeId)
    if (!session || !session.hello) return
    // Кадр уходит ТОЛЬКО если узел сказал «я жду» своим `alive`. Клиент,
    // который не ждёт (работает над пачкой), не получает ничего: он сам
    // пришлёт `alive` с новым номером, когда освободится.
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
    // Номер соединения: клиент увеличивает его перед каждым подключением.
    // Правит не порядок прихода пакетов, а счётчик — иначе два цикла на одном
    // устройстве выбивают друг друга и в журнале видно `open` без `close`.
    const conn = Number.isFinite(Number(frame.conn)) ? Number(frame.conn) : null
    const current = sessions.get(node.id)
    if (conn !== null && current && current !== session && Number(current.conn) > conn) {
      // пришло устаревшее соединение: закрываем его, живое оставляем
      log('info', 'ws-stale-conn', { node: node.id, got: conn, kept: current.conn })
      return drop(node.id, 4409, 'устаревшее соединение')
    }
    session.conn = conn
    if (conn !== null && current === session) {
      // это соединение новее предыдущего: старое вытесняем осознанно
      for (const [id, other] of sessions) {
        if (id === node.id && other !== session && Number(other.conn ?? -1) < conn) {
          log('info', 'ws-newer-conn', { node: node.id, got: conn, dropped: other.conn })
        }
      }
    }
    // клиент сообщает рабочий каталог: показываем его в админке и знаем,
    // где лежат каталоги сессий
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
    // обещание «умею спрашивать человека» приходит и по WebSocket: держим в
    // одном месте с announce, иначе после реконнекта оно отстанет
    if (typeof frame.approver === 'string') {
      try {
        // `local` — обещание узла спросить человека. Проверять объявление
        // нечего: вопрос идёт служебной командой, а не методом API
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
    // поколение сменилось: у клиента своя копия состояния, ему достаточно
    // сообщить `reconnect`. Сервер ничего не «сбрасывает» — выдача идёт с
    // головы очереди, и старых курсоров в протоколе больше нет.
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
    // `alive` — старое имя кадра, понимаем его ради уже работающих клиентов
    if (frame.t === 'check_state' || frame.t === 'alive') {
      session.lastAlive = Date.now()
      session.missed = 0
      store.touch(node.id)
      // Клиент присылает, до какого номера он в курсе. Если у нас больше —
      // отвечаем тем же кадром сразу, чтобы он не сидел в ожидании. Если
      // столько же — молчим и ставим флаг: ответ уйдёт, когда появится работа.
      // Так на пустой очереди трафик нулевой, и никакого опроса не нужно.
      // `known: null` — клиент не знает состояния вообще, то есть перезапустился.
      // Всё, что ему выдали, умерло вместе с ним: закрываем эти команды ошибкой,
      // иначе модель ждёт таймаута и не понимает, почему.
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
    // Прикладной пинг по сокету: клиент проверяет, что сервер жив и слышит его.
    // Отвечаем тем же id, чтобы клиент не путал ответы.
    // пинг — тоже признак жизни: узел, который держит канал и пингует, живой,
    // даже если команд нет и HTTP-запросов не было
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
    // одно соединение на узел: новое вытесняет старое (§7)
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
      // сокет мог быть уже вытеснен новым — тогда не трогаем новую сессию
      if (current === session) {
        sessions.delete(node.id)
        if (session.alive) clearInterval(session.alive)
        log('info', 'ws-closed', { node: node.id, code: 1000 })
      }
    })
    socket.on('error', (error) => log('warn', 'ws-error', { node: node.id, error: error.message }))

    // пинг выключен по умолчанию: сокет живёт на TCP, а не на наших кадрах
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
   * Обработчик upgrade для `webServer.registerUpgrade`.
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
    // закрыть сессию узла: нужно при отзыве токена, иначе узел светится online
    drop,
    online: (nodeId) => sessions.has(nodeId),
    sessions,
    close () {
      for (const nodeId of [...sessions.keys()]) drop(nodeId, 1001, 'server closing')
      wss.close()
    },
  }
}
