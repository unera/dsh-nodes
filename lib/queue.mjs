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
function wire (command) {
  const out = {
    seq: command.seq,
    api: command.api,
    method: command.method,
    args: command.args,
    timeout: command.timeout,
    sandbox: command.sandbox ?? { mode: 'danger-full-access' },
  }
  if (command.approved) out.approved = command.approved
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
    /** @type {Map<number, {state:number, served:number, queue:object[], waiting:Map<number,object>}>} */
    this.nodes = new Map()
  }

  #node (nodeId) {
    let state = this.nodes.get(nodeId)
    if (!state) {
      state = { state: 0, served: 0, queue: [], waiting: new Map() }
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
      queued: node?.queue.length ?? 0,
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
  enqueue ({ nodeId, api, method, args, timeout, sandbox, approved }) {
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
  take (nodeId, { after = 0, limit } = {}) {
    const node = this.#node(nodeId)
    const size = Math.min(Math.max(Number(limit) || this.maxBatch, 1), this.maxBatch)
    if (Number(after) > node.served) node.served = Number(after)
    const batch = []
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.seq <= Number(after)) continue
      batch.push(command)
    }
    if (batch.length) {
      const last = batch[batch.length - 1].seq
      if (last > node.served) node.served = last
    }
    return { state: node.state, served: node.served, epoch: this.epoch, commands: batch.map(wire) }
  }

  /**
   * Закрыть команду результатом от узла.
   * @returns {'closed'|'already'|'unknown'}
   */
  close (nodeId, seq, payload) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const index = node.queue.findIndex((command) => command.seq === number)
    if (index < 0) return number <= node.served ? 'already' : 'unknown'
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
  sweep (now = Date.now()) {
    let removed = 0
    for (const node of this.nodes.values()) {
      for (let i = node.queue.length - 1; i >= 0; i--) {
        const command = node.queue[i]
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
