/**
 * Очередь команд и промисы ожидающих — состояние жизни процесса.
 *
 * Всё, что здесь лежит, не переживает рестарт сервера: счётчик `state`, watermark
 * счётчики и сами команды обнуляются, а поколение различает epoch (план §4.7).
 * Ждущий — живой промис модели, после рестарта ждать некому.
 *
 * @module dsh-nodes/queue
 */

/** Время с точностью лучше миллисекунды: для измерения отклика. */
export function preciseNow () {
  return Math.round((performance.timeOrigin + performance.now()) * 1000) / 1000
}

/** Поднять кадр команды в вид, который едет на узел (план §4.3). */
/** Режимы DSH → режимы клиента: `read-only`/`workspace-write`/`danger-full-access`. */
const MODE_TO_WIRE = { 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'full' }

function wireSandbox (sandbox) {
  if (!sandbox || typeof sandbox !== 'object') return sandbox ?? null
  const mode = MODE_TO_WIRE[sandbox.mode] ?? sandbox.mode ?? null
  return { ...sandbox, mode }
}

function wire (command) {
  const out = {
    seq: command.seq,
    api: command.api,
    method: command.method,
    args: command.args,
    timeout: command.timeout,
    sandbox: wireSandbox(command.sandbox) ?? { mode: 'full' },
  }
  if (command.approved) out.approved = command.approved
  // метаданные сессии: клиент по ним заводит рабочий каталог сессии.
  // Поле необязательное — старые клиенты его просто не читают.
  if (command.session) out.session = command.session
  // в рамках какого вопроса человека (корневого вызова хода) идёт команда:
  // по этим двум id инструмент апрува может запомнить «до конца вопроса»
  if (command.question) out.question = command.question
  // когда сервер поставил команду: по этой отметке клиент мерит отклик, а мы —
  // разницу часов между машинами
  if (command.issuedAt) out.issuedAt = command.issuedAt
  if (command.escalation) out.escalation = command.escalation
  return out
}

/**
 * Очередь на все узлы.
 */
/** Псевдо-API для служебных команд: узлу не надо объявлять его в announce. */
export const CONTROL_API = -1
/**
 * Имя управляющей команды отмены.
 *
 * Решётка в начале — не украшение: такой метод не может объявить клиент,
 * значит подделать управляющую команду из узла нельзя. Проверка объявлений
 * отсекает имена с `#`.
 */
export const CONTROL_CANCEL = '#INTERNAL.CANCEL'
/**
 * Барьер: «то, что было до меня, уже закончилось».
 *
 * Ставится сервером вокруг команды, объявившей правило `flushBefore`,
 * `flushAfter` или `flushAround` (spec/SPECIAL-RULES.md). Исполняется только на
 * пустом пуле и, пока не ответит, держит всё, что стоит за ним в очереди.
 */
export const CONTROL_FLUSH = '#INTERNAL.FLUSH'
/** Имена-барьеры: идут по одному и останавливают выдачу за собой. */
const BARRIERS = new Set([CONTROL_FLUSH])

/** Барьер ли это: служебная команда, которая держит очередь. */
export function isBarrier (command) {
  return command?.api === CONTROL_API && BARRIERS.has(command.method)
}
/** Срок жизни служебной команды: сутки — «дойдёт когда-нибудь» это норма. */
const CONTROL_TTL_SECONDS = 24 * 60 * 60
/** Приоритет управляющих команд: обгоняют пользовательскую работу. */
export const CONTROL_PRIORITY = 10

export class Queue {
  /**
   * @param {object} options
   * @param {number} options.epoch поколение сервера
   * @param {number} [options.defaultTimeout] секунды, если у узла и вызова нет своих
   * @param {number} [options.maxBatch] сколько команд отдаётся за один запрос
   * @param {number} [options.maxQueue] потолок невыданных пользовательских команд на узел
   * @param {number} [options.commandTtl] секунды жизни невыданной команды
   */
  constructor ({ epoch, defaultTimeout = 60, maxBatch = 5, maxQueue = 1000, commandTtl = 300, barrierTimeout = 1800 }) {
    this.epoch = epoch
    this.defaultTimeout = defaultTimeout
    this.maxBatch = maxBatch
    this.maxQueue = maxQueue
    this.commandTtl = commandTtl
    /** Сколько ждать ответа сверх таймаута команды, прежде чем счесть её потерянной. */
    this.leaseGraceSeconds = 30
    /**
     * Сколько живёт барьер. Он ждёт, пока узел домостёт пул, то есть не дольше
     * самой длинной команды в работе; если ответа нет и за это время — барьер
     * потерян, и об этом надо сказать громко, а не держать очередь сутки.
     */
    this.barrierTimeout = barrierTimeout
    /** @type {Map<number, {state:number, queue:object[], waiting:Map<number,object>, closed?:Set<number>}>} */
    this.nodes = new Map()
  }

  #node (nodeId) {
    let state = this.nodes.get(nodeId)
    if (!state) {
      state = { state: 0, queue: [], waiting: new Map() }
      this.nodes.set(nodeId, state)
    }
    return state
  }

  /** Счётчики узла для /state и админки. */
  info (nodeId) {
    const node = this.nodes.get(nodeId)
    return {
      // `max_commandno` — последний израсходованный номер команды. Номера
      // честный автоинкремент и не переиспользуются, поэтому «я знаю до N»
      // означает «всё новое будет ≥ N+1», даже если часть номеров ушла на
      // команды, которых узел так и не увидел (отмена, протухание).
      max_commandno: node?.state ?? 0,
      queued: node?.queue.length ?? 0,
      ready: node ? this.#readyCount(node) : 0,
      waiting: node?.waiting.size ?? 0,
      epoch: this.epoch,
    }
  }

  /**
   * Поставить команду и получить промис на её исход.
   * @param {object} command
   * @param {number} command.nodeId
   * @param {number} command.api
   * @param {string} command.method
   * @param {object} command.args
   * @param {number} [command.timeout] секунды
   * @param {object} [command.sandbox] `{mode, root}` из сессии модели
   * @returns {{seq: number|null, promise: Promise<object>}}
   */
  /**
   * Управляющая команда узлу: отмена, уборка, что угодно служебное.
   *
   * Особенности: не занимает место в очереди ожидания (ответ никто не ждёт),
   * живёт сутки — «дойти когда-нибудь» это нормальный сценарий, а не ошибка.
   * Результат, если он придёт, попадает в лог.
   */
  control (nodeId, method, args = {}) {
    const { seq, promise } = this.enqueue({
      nodeId,
      api: CONTROL_API,
      method,
      args,
      timeout: CONTROL_TTL_SECONDS,
      // 10 — выше любой пользовательской команды: отмена не должна стоять
      // в очереди за работой, которую сама же и отменяет
      priority: CONTROL_PRIORITY,
    })
    // промис не ожидаем: ответ интересен только для журнала
    promise.then((outcome) => {
      if (outcome?.status !== 'ok') {
        this.#controlLog?.(nodeId, method, args, outcome)
      }
    }).catch(() => {})
    return seq
  }

  /** Куда писать журнал управляющих команд: ставится снаружи. */
  setControlLog (fn) {
    this.#controlLog = fn
  }

  /**
   * Чем будить узел: тем же, чем будится на обычную команду.
   *
   * Без этого `#INTERNAL.CANCEL` из таймаута лежал в очереди, пока клиент не
   * проснётся сам: отмена доезжала через секунды, а то и вовсе после того, как
   * команда успевала отработать.
   */
  setNotify (fn) {
    this.#notify = fn
  }

  #controlLog = null
  #notify = null

  /**
   * Поставить барьер `#INTERNAL.FLUSH`.
   *
   * Ожидающего нет: ответ интересен только журналу. Срок жизни короче суток —
   * барьер, который никто не снял, держит очередь, и держать её вечность нельзя:
   * `sweep` закроет его как потерянный и скажет об этом громко.
   *
   * @returns {number} номер барьера
   */
  #pushBarrier (node, priority = 0) {
    node.state += 1
    const command = {
      seq: node.state,
      api: CONTROL_API,
      method: CONTROL_FLUSH,
      args: {},
      timeout: this.barrierTimeout,
      sandbox: null,
      approved: null,
      session: null,
      question: null,
      escalation: 0,
      // барьер держит только то, что не выше его самого: отмена обгоняет
      priority,
      issuedAt: preciseNow(),
      status: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.barrierTimeout * 1000,
    }
    node.queue.push(command)
    return command.seq
  }

  enqueue ({ nodeId, api, method, args, timeout, sandbox, approved, session, escalation, question, flushBefore, flushAfter, rule, priority = 0 }) {
    const node = this.#node(nodeId)
    // считаем только невыданные: взятая в работу команда уже не наша забота,
    // иначе поломка одного узла запирает очередь для всех остальных
    // потолок считаем только по пользовательским командам: отмена и барьеры
    // нужны именно тогда, когда очередь забита, и терять их нельзя
    const readyCount = node.queue.reduce(
      (sum, item) => sum + (item.status === 'ready' && !(item.priority > 0) && item.api !== CONTROL_API ? 1 : 0),
      0,
    )
    if (!(priority > 0) && api !== CONTROL_API && readyCount >= this.maxQueue) {
      return {
        seq: null,
        promise: Promise.resolve({
          status: 'error',
          code: 'queue_full',
          message: `узел перегружен: ${readyCount} команд ждут выдачи (потолок ${this.maxQueue}); `
            + 'сбавь темп — канал на узел или сам узел не успевает',
          results: null,
        }),
      }
    }
    const seconds = Number(timeout) > 0 ? Number(timeout) : this.defaultTimeout
    // барьер берёт свой номер раньше команды: порядок в очереди и порядок
    // номеров не должны расходиться — по номерам клиент считает `known`
    if (flushBefore) this.#pushBarrier(node, priority)
    node.state += 1
    const command = {
      seq: node.state,
      api,
      method,
      args: args ?? {},
      timeout: seconds,
      sandbox,
      approved,
      // метаданные: клиент по ним заводит каталог сессии. Не обязательны —
      // старые клиенты поле просто игнорируют.
      session: session ?? null,
      question: question ?? null,
      escalation: escalation ?? 0,
      issuedAt: preciseNow(),
      status: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + seconds * 1000,
      // `ruleState` — внутренние отметки правила: сервер ставит их сам, когда
      // выдаёт команду и когда приходит ответ. Клиент на них не влияет
      rule,
      ruleState: rule === 'timing' ? {} : null,
      // 0 — обычная работа, больше — управляющие команды: отмена пролетает
      // вперёд, потому что иначе она стоит за той командой, которую отменяет
      priority,
    }
    node.queue.push(command)
    // будим узел сразу: управляющие команды (CANCEL) раньше не будили его вовсе
    this.#notify?.(nodeId)
    // и после неё — «за мной ничего не начинается, пока я не кончил»
    if (flushAfter) this.#pushBarrier(node, priority)
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        node.waiting.delete(command.seq)
        const index = node.queue.indexOf(command)
        if (index >= 0) node.queue.splice(index, 1)
        this.#remember(node, command.seq)
        // отменяем только взятую в работу: лежащую в очереди узел не видел,
        // её достаточно убрать (что уже сделано выше)
        if (command.api !== CONTROL_API && command.status === 'processing') {
          this.control(nodeId, CONTROL_CANCEL, { seq: command.seq, reason: 'timeout' })
        }
        resolve({ status: 'timeout', code: 'timeout', message: 'Timeout reached', results: null })
      }, seconds * 1000)
      if (typeof timer.unref === 'function') timer.unref()
      node.waiting.set(command.seq, { resolve, timer, command })
    })
    // issuedAt отдаём наружу: по нему сервер считает время раундтрипа
    return { seq: command.seq, promise, issuedAt: command.issuedAt }
  }

  /**
   * Выдать пачку на исполнение.
   *
   * Команды берутся с головы очереди среди `ready`, одной пачкой переходят в
   * `processing` и больше не выдаются никогда: «взял — значит или исполнил, или
   * пытался». Аренды нет, повторной выдачи нет, дублей поэтому тоже нет.
   *
   * Барьер (`#INTERNAL.FLUSH`) — исключение из «пачкой»: он выдаётся один,
   * потому что смысл его в пустом пуле, и держит всё, что стоит за ним, пока не
   * ответит. Иначе `flushAfter` и `flushAround` оставались бы пожеланием.
   *
   * @param {number} nodeId
   * @param {{limit?: number}} [options]
   * @returns {{commands: object[], ready: number, epoch: number}}
   */
  take (nodeId, { limit } = {}) {
    const node = this.#node(nodeId)
    const size = Math.min(Math.max(Number(limit) || this.maxBatch, 1), this.maxBatch)
    const batch = []

    // 1. Сначала всё, что выше приоритетом: отмена не должна стоять за работой,
    //    которую она отменяет. Барьер её не держит — он держит только своих.
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.status !== 'ready' || !(command.priority > 0)) continue
      batch.push(command)
    }

    // 2. Обычный поток — в порядке постановки (он же порядок номеров), и
    //    барьер по-прежнему идёт первым и один: пока он висит, за ним не выдаём.
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.priority > 0) continue
      // барьер проверяем до статуса: висящий барьер держит всё, что за ним,
      // а не «пропускается как неготовый»
      if (isBarrier(command)) {
        if (command.status === 'ready' && batch.length === 0) batch.push(command)
        break
      }
      if (command.status !== 'ready') continue
      batch.push(command)
    }

    if (!batch.length) {
      return { commands: [], ready: 0, epoch: this.epoch, max_commandno: node.state }
    }
    for (const command of batch) {
      command.status = 'processing'
      command.takenAt = Date.now()
      if (command.ruleState) command.ruleState.startedAt = preciseNow()
    }
    return { commands: batch.map(wire), ready: this.#readyCount(node), epoch: this.epoch, max_commandno: node.state }
  }

  /**
   * Запомнить закрытый номер: по нему поздний результат получает внятное
   * «уже закрыта», а не «такой команды не было».
   */
  #remember (node, seq) {
    node.closed ??= new Set()
    node.closed.add(seq)
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
  }

  /** Сколько команд ждёт выдачи. */
  #readyCount (node) {
    return node.queue.reduce((sum, command) => sum + (command.status === 'ready' ? 1 : 0), 0)
  }


  /**
   * Найти выданную команду по номеру — для роутов передачи файлов.
   *
   * Узел предъявляет `seq`: если такая команда ему выдана и ещё не закрыта,
   * значит и передача его. Отдельного билета не нужно — билетом служит сама
   * команда, а её состояние «выдана, ждёт результата» и есть разрешение.
   *
   * @param {number} nodeId
   * @param {number} seq
   * @returns {object|null}
   */
  issued (nodeId, seq) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const command = node.queue.find((item) => item.seq === number) ?? null
    if (!command) return null
    // своя копия: обработчик роута не должен править очередь
    return { ...command }
  }

  /**
   * Закрыть команду результатом от узла.
   * @returns {'closed'|'already'|'unknown'}
   */
  close (nodeId, seq, payload) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const index = node.queue.findIndex((command) => command.seq === number)
    // нет в очереди: либо уже закрыли, либо такой номер не выдавали вовсе.
    // Смотрим кольцо последних закрытых, а не курсор: курсор говорит только о
    // выдаче, и по нему «уже закрыта» превращалось в догадку.
    if (index < 0) return node.closed?.has(number) ? 'already' : 'unknown'
    const [command] = node.queue.splice(index, 1)
    // барьер не кому отвечать: его исход попадает только в журнал, и молчать про
    // неудачу нельзя — за ним стоят команды, которых он держал
    if (isBarrier(command) && payload.ok !== true) {
      this.#controlLog?.(nodeId, command.method, { seq: number }, {
        status: 'error',
        code: payload.code ?? 'internal',
        message: payload.message ?? 'error',
        results: null,
      })
    }
    node.closed ??= new Set()
    node.closed.add(number)
    // кольцо на 1000 номеров: больше нужно только для диагностики повторов
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
    const waiter = node.waiting.get(number)
    if (waiter) {
      clearTimeout(waiter.timer)
      node.waiting.delete(number)
      // отметки и часы узла нужны правилу `timing`. Это внутренние поля —
      // наружу они не уходят: модель получает только то, что положит правило
      if (command.ruleState) command.ruleState.finishedAt = preciseNow()
      const internal = {
        rule: command.rule ?? null,
        ruleState: command.ruleState ? { ...command.ruleState } : null,
        nodeNow: Number.isFinite(Number(payload.now)) ? Number(payload.now) : null,
        issuedAt: command.issuedAt ?? null,
        takenAt: command.takenAt ?? null,
      }
      waiter.resolve(payload.ok
        ? { status: 'ok', code: null, message: null, results: payload.results ?? [], internal }
        : { status: 'error', code: payload.code ?? 'internal', message: payload.message ?? 'error', results: null, internal })
    }
    return 'closed'
  }

  /**
   * Оборвать все ожидания узла — только для внутренних событий (удаление узла).
   * Разрыв сокета команды не рвёт: судьбу решает timeout (план §7).
   */
  abort (nodeId, outcome) {
    const node = this.nodes.get(nodeId)
    if (!node) return
    for (const [seq, waiter] of node.waiting) {
      clearTimeout(waiter.timer)
      node.waiting.delete(seq)
      waiter.resolve(outcome)
    }
    node.queue.length = 0
  }

  /** Снять команду из очереди — отмена вызова (план §4.4.1). */
  cancel (nodeId, seq) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const index = node.queue.findIndex((command) => command.seq === number)
    if (index < 0) return false
    const [cancelled] = node.queue.splice(index, 1)
    this.#remember(node, number)
    // взятая в работу команда живёт на узле: убрать её из очереди мало, надо
    // попросить узел остановиться, иначе процесс доработает до конца впустую
    if (cancelled.api !== CONTROL_API && cancelled.status === 'processing') {
      this.control(nodeId, CONTROL_CANCEL, { seq: number, reason: 'cancelled' })
    }
    node.closed ??= new Set()
    node.closed.add(number)
    // кольцо на 1000 номеров: больше нужно только для диагностики повторов
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
    const waiter = node.waiting.get(number)
    if (waiter) {
      clearTimeout(waiter.timer)
      node.waiting.delete(number)
      waiter.resolve({ status: 'error', code: 'cancelled', message: 'cancelled', results: null })
    }
    return true
  }

  /** Убрать команды, которые никто не забрал за commandTtl. */
  /**
   * Потерять всё, что узел якобы исполняет.
   *
   * Вызывается, когда узел заявил «я не знаю состояния» — значит он
   * перезапустился и всё, что ему выдали, умерло вместе с ним. Модель должна
   * получить внятную ошибку, а не ждать своего таймаута.
   *
   * @param {number} nodeId
   * @param {string} [code]
   * @returns {number} сколько команд закрыли
   */
  failInFlight (nodeId, code = 'node_restarted') {
    const pending = this.#node(nodeId)
    for (const command of [...pending.queue]) {
      // в работе — просим узел прекратить; просто ждущие уходят молча
      if (command.api !== CONTROL_API && command.status === 'processing') {
        this.control(nodeId, CONTROL_CANCEL, { seq: command.seq, reason: code })
      }
    }
    const node = this.nodes.get(nodeId)
    if (!node) return 0
    let closed = 0
    for (let i = node.queue.length - 1; i >= 0; i--) {
      const command = node.queue[i]
      if (command.status !== 'processing') continue
      node.queue.splice(i, 1)
      node.closed ??= new Set()
      node.closed.add(command.seq)
      const waiter = node.waiting.get(command.seq)
      if (waiter) {
        clearTimeout(waiter.timer)
        node.waiting.delete(command.seq)
        waiter.resolve({
          status: 'error',
          code,
          message: 'узел перезапустился: результат не сохранился, команду надо повторить',
          results: null,
        })
      }
      closed++
    }
    return closed
  }

  /**
   * Убрать мусор.
   *
   * Две разные вещи: невыданные команды просто стареют (`commandTtl`), а взятые
   * в работу — те, по которым узел так и не ответил, — закрываются как `lost`,
   * чтобы модель получила внятный ответ, а не ждала своего таймаута.
   */
  sweep (now = Date.now()) {
    let removed = 0
    for (const [nodeId, node] of this.nodes) {
      for (let i = node.queue.length - 1; i >= 0; i--) {
        const command = node.queue[i]
        if (command.status === 'processing') {
          const limitMs = (command.timeout + this.leaseGraceSeconds) * 1000
          if (now - (command.takenAt ?? command.createdAt) < limitMs) continue
          node.queue.splice(i, 1)
          this.#remember(node, command.seq)
          // потерянный барьер — это порванная гарантия: за ним стояли команды,
          // которые он должен был придержать. Молчать про это нельзя
          if (isBarrier(command)) {
            this.#controlLog?.(nodeId, command.method, { seq: command.seq }, {
              status: 'error',
              code: 'lost',
              message: 'барьер взят узлом и не ответил: порядок команд больше не гарантирован',
              results: null,
            })
          }
          const waiter = node.waiting.get(command.seq)
          if (waiter) {
            clearTimeout(waiter.timer)
            node.waiting.delete(command.seq)
            waiter.resolve({
              status: 'error',
              code: 'lost',
              message: 'узел взял команду и не ответил: результат потерян',
              results: null,
            })
          }
          removed++
          continue
        }
        // диалог апрува ждёт человека: срок жизни команды к нему не относится,
        // иначе вопрос исчезнет раньше, чем его прочитают
        if (command.method === 'approve') continue
        if (now - command.createdAt < this.commandTtl * 1000) continue
        node.queue.splice(i, 1)
        this.#remember(node, command.seq)
        if (isBarrier(command)) {
          this.#controlLog?.(nodeId, command.method, { seq: command.seq }, {
            status: 'error',
            code: 'expired',
            message: 'барьер не был взят узлом за отведённое время: порядок команд больше не гарантирован',
            results: null,
          })
        }
        const waiter = node.waiting.get(command.seq)
        if (waiter) {
          clearTimeout(waiter.timer)
          node.waiting.delete(command.seq)
          waiter.resolve({
            status: 'error',
            code: 'expired',
            message: 'команда не была взята узлом за отведённое время',
            results: null,
          })
        }
        removed++
      }
    }
    return removed
  }

  /** Новое поколение: счётчики с нуля (план §4.7). */
  reset (epoch) {
    this.epoch = epoch
    this.nodes.clear()
  }
}
