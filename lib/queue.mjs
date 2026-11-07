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
  // когда сервер поставил команду: по этой отметке клиент мерит отклик, а мы —
  // разницу часов между машинами
  if (command.issuedAt) out.issuedAt = command.issuedAt
  if (command.escalation) out.escalation = command.escalation
  return out
}

/**
 * Очередь на все узлы.
 */
export class Queue {
  /**
   * @param {object} options
   * @param {number} options.epoch поколение сервера
   * @param {number} [options.defaultTimeout] секунды, если у узла и вызова нет своих
   * @param {number} [options.maxBatch] сколько команд отдаётся за один запрос
   * @param {number} [options.maxQueue] потолок незакрытых команд на узел
   * @param {number} [options.commandTtl] секунды жизни невыданной команды
   */
  constructor ({ epoch, defaultTimeout = 60, maxBatch = 5, maxQueue = 100, commandTtl = 300 }) {
    this.epoch = epoch
    this.defaultTimeout = defaultTimeout
    this.maxBatch = maxBatch
    this.maxQueue = maxQueue
    this.commandTtl = commandTtl
    /** Сколько ждать ответа сверх таймаута команды, прежде чем счесть её потерянной. */
    this.leaseGraceSeconds = 30
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
      // `state` — последний выданный номер; клиенту он нужен, чтобы понять,
      // отстал ли он. Курсора и watermark больше нет: они были нужны схеме с
      // повторной выдачей, которой не стало.
      state: node?.state ?? 0,
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
  enqueue ({ nodeId, api, method, args, timeout, sandbox, approved, session, escalation }) {
    const node = this.#node(nodeId)
    // считаем только невыданные: взятая в работу команда уже не наша забота,
    // иначе поломка одного узла запирает очередь для всех остальных
    const readyCount = node.queue.reduce((sum, item) => sum + (item.status === 'ready' ? 1 : 0), 0)
    if (readyCount >= this.maxQueue) {
      return {
        seq: null,
        promise: Promise.resolve({
          status: 'error',
          code: 'queue_full',
          message: `queue_full: у узла ${readyCount} невыданных команд`,
          results: null,
        }),
      }
    }
    const seconds = Number(timeout) > 0 ? Number(timeout) : this.defaultTimeout
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
      escalation: escalation ?? 0,
      issuedAt: preciseNow(),
      status: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + seconds * 1000,
    }
    node.queue.push(command)
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        node.waiting.delete(command.seq)
        const index = node.queue.indexOf(command)
        if (index >= 0) node.queue.splice(index, 1)
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
   * @param {number} nodeId
   * @param {{limit?: number}} [options]
   * @returns {{commands: object[], ready: number, epoch: number}}
   */
  take (nodeId, { limit } = {}) {
    const node = this.#node(nodeId)
    const size = Math.min(Math.max(Number(limit) || this.maxBatch, 1), this.maxBatch)
    const batch = []
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.status !== 'ready') continue
      batch.push(command)
    }
    if (!batch.length) {
      return { commands: [], ready: 0, epoch: this.epoch }
    }
    for (const command of batch) {
      command.status = 'processing'
      command.takenAt = Date.now()
    }
    return { commands: batch.map(wire), ready: this.#readyCount(node), epoch: this.epoch }
  }

  /** Сколько команд ждёт выдачи. */
  #readyCount (node) {
    return node.queue.reduce((sum, command) => sum + (command.status === 'ready' ? 1 : 0), 0)
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
    node.queue.splice(index, 1)
    node.closed ??= new Set()
    node.closed.add(number)
    // кольцо на 1000 номеров: больше нужно только для диагностики повторов
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
    const waiter = node.waiting.get(number)
    if (waiter) {
      clearTimeout(waiter.timer)
      node.waiting.delete(number)
      waiter.resolve(payload.ok
        ? { status: 'ok', code: null, message: null, results: payload.results ?? [] }
        : { status: 'error', code: payload.code ?? 'internal', message: payload.message ?? 'error', results: null })
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
    node.queue.splice(index, 1)
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
    for (const node of this.nodes.values()) {
      for (let i = node.queue.length - 1; i >= 0; i--) {
        const command = node.queue[i]
        if (command.status === 'processing') {
          const limitMs = (command.timeout + this.leaseGraceSeconds) * 1000
          if (now - (command.takenAt ?? command.createdAt) < limitMs) continue
          node.queue.splice(i, 1)
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
