/**
 * Очередь команд и промисы ожидающих — состояние жизни процесса.
 *
 * Всё, что здесь лежит, не переживает рестарт сервера: счётчик `state`, watermark
 * `served` и сами команды обнуляются, а поколение различает epoch (план §4.7).
 * Ждущий — живой промис модели, после рестарта ждать некому.
 *
 * @module dsh-nodes/queue
 */

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
    /** @type {Map<number, {state:number, served:number, queue:object[], waiting:Map<number,object>}>} */
    this.nodes = new Map()
  }

  #node (nodeId) {
    let state = this.nodes.get(nodeId)
    if (!state) {
      state = { state: 0, served: 0, cursor: null, queue: [], waiting: new Map() }
      this.nodes.set(nodeId, state)
    }
    return state
  }

  /** Счётчики узла для /state и админки. */
  info (nodeId) {
    const node = this.nodes.get(nodeId)
    return {
      state: node?.state ?? 0,
      served: node?.served ?? 0,
      cursor: node?.cursor ?? null,
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
    if (node.queue.length >= this.maxQueue) {
      return {
        seq: null,
        promise: Promise.resolve({
          status: 'error',
          code: 'queue_full',
          message: `queue_full: у узла ${node.queue.length} незакрытых команд`,
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
    return { seq: command.seq, promise }
  }

  /**
   * Выдача пачки: строго больше курсора, старые первыми (план §4.3).
   * Курсор присылает узел; сервер его не двигает, но зеркалит watermark.
   */
  /**
   * Выдать пачку на исполнение.
   *
   * Команды берутся с головы очереди среди `ready`, одной пачкой переходят в
   * `processing` и больше не выдаются никогда: «взял — значит или исполнил, или
   * пытался». Аренды нет, повторной выдачи нет, дублей поэтому тоже нет.
   *
   * `cursor` — просто максимальный `seq` выданной пачки; если готовых нет,
   * курсор не двигается (клиенту он нужен лишь для самопроверки).
   *
   * @param {number} nodeId
   * @param {{limit?: number}} [options]
   * @returns {{commands: object[], cursor: number|null, ready: number, epoch: number}}
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
      return { commands: [], cursor: node.cursor ?? null, ready: 0, epoch: this.epoch }
    }
    for (const command of batch) {
      command.status = 'processing'
      command.takenAt = Date.now()
    }
    const cursor = batch[batch.length - 1].seq
    node.cursor = cursor
    node.served = Math.max(node.served ?? 0, cursor)
    return { commands: batch.map(wire), cursor, ready: this.#readyCount(node), epoch: this.epoch }
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
    // нет в очереди — либо уже закрыли (номер не больше курсора), либо такого не было
    if (index < 0) return node.cursor !== null && number <= node.cursor ? 'already' : 'unknown'
    node.queue.splice(index, 1)
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
        if (now - command.createdAt < this.commandTtl * 1000) continue
        node.queue.splice(i, 1)
        removed++
      }
    }
    return removed
  }

  /** Поднять watermark по заявлению узла: он не может опередить правду. */
  raiseServed (nodeId, value) {
    const node = this.#node(nodeId)
    const number = Number(value)
    if (Number.isFinite(number) && number > node.served) node.served = number
    return node.served
  }

  /** Сброс курсора поколения: сервер перезапустился (план §4.7). */
  resetCursor (nodeId) {
    const node = this.#node(nodeId)
    node.served = 0
    return node.served
  }

  /** Новое поколение: счётчики с нуля (план §4.7). */
  reset (epoch) {
    this.epoch = epoch
    this.nodes.clear()
  }
}
