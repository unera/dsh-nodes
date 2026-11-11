/**
 * Command queue and waiter promises — process live state.
 *
 * Nothing kept here survives a server restart: the `state` counter, the watermark
 * counters and the commands themselves are zeroed, and epoch tells the generation apart
 * (§4.7 of the plan). A waiter is a live model promise; after a restart there is nobody to wait for.
 *
 * @module dsh-nodes/queue
 */

/**
 * Wall clock in milliseconds — the only clock a node and the server can compare.
 *
 * `performance.now()` is monotonic and does not advance while the machine is suspended:
 * on a laptop that had been asleep the client reported a clock nine hours behind, and the
 * `timing` rule reported a skew of -33 191 739 ms on a machine whose clock was correct.
 * A whole millisecond is enough for what we measure.
 */
export function preciseNow () {
  return Date.now()
}

/** Raise a command frame into the form that travels to the node (plan §4.3). */
/** DSH modes → client modes: `read-only`/`workspace-write`/`danger-full-access`. */
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
  // session metadata: the client uses it to set up the session working directory.
  // The field is optional — old clients simply do not read it.
  if (command.session) out.session = command.session
  // which human question (the root call of the turn) the command belongs to:
  // by these two ids the approval tool can remember "until the end of the question"
  if (command.question) out.question = command.question
  // when the server queued the command: by this mark the client measures response, and we
  // measure the clock difference between the machines
  if (command.issuedAt) out.issuedAt = command.issuedAt
  if (command.escalation) out.escalation = command.escalation
  return out
}

/**
 * The queue for all nodes.
 */
/** Pseudo-API for service commands: the node does not have to declare it in announce. */
export const CONTROL_API = -1
/**
 * The name of the control cancel command.
 *
 * The hash at the start is not decoration: a client cannot declare such a method,
 * so a control command cannot be faked from a node. The declaration check
 * cuts off names with `#`.
 */
export const CONTROL_CANCEL = '#INTERNAL.CANCEL'
/**
 * Barrier: "what was before me has already finished".
 *
 * Put by the server around a command that declared the rule `flushBefore`,
 * `flushAfter` or `flushAround` (spec/SPECIAL-RULES.md). It runs only on an
 * empty pool and, until it answers, holds everything queued behind it.
 */
export const CONTROL_FLUSH = '#INTERNAL.FLUSH'
/** Barrier names: they go one at a time and stop issuing behind themselves. */
const BARRIERS = new Set([CONTROL_FLUSH])

/** Whether this is a barrier: a service command that holds the queue. */
export function isBarrier (command) {
  return command?.api === CONTROL_API && BARRIERS.has(command.method)
}
/** Service command lifetime: a day — "will get there eventually" is normal. */
const CONTROL_TTL_SECONDS = 24 * 60 * 60
/** Control command priority: they overtake user work. */
export const CONTROL_PRIORITY = 10
/**
 * Ask the human. Also a service command: it is not declared in an API, and it no
 * longer depends on the `session` contract.
 *
 * The priority is below cancel (10) and above user work (0): we show the question
 * to the human earlier than the machine takes on the next task, but
 * it can always be cancelled.
 */
export const CONTROL_APPROVE = '#INTERNAL.APPROVE'
/** Priority of the question to the human. */
export const APPROVAL_PRIORITY = 5

export class Queue {
  /**
   * @param {object} options
   * @param {number} options.epoch server generation
   * @param {number} [options.defaultTimeout] seconds, if neither the node nor the call has its own
   * @param {number} [options.maxBatch] how many commands are returned per request
   * @param {number} [options.maxQueue] ceiling of unissued user commands per node
   * @param {number} [options.commandTtl] lifetime of an unissued command, in seconds
   */
  constructor ({ epoch, defaultTimeout = 60, maxBatch = 5, maxQueue = 1000, commandTtl = 300, barrierTimeout = 1800 }) {
    this.epoch = epoch
    this.defaultTimeout = defaultTimeout
    this.maxBatch = maxBatch
    this.maxQueue = maxQueue
    this.commandTtl = commandTtl
    /** How long to wait for an answer beyond the command timeout before counting it lost. */
    this.leaseGraceSeconds = 30
    /**
     * How long a barrier lives. It waits for the node to drain the pool, that is, no longer
     * than the longest command in flight; if there is no answer even in that time — the barrier
     * is lost, and that must be said loudly instead of holding the queue for a day.
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

  /** Node counters for /state and the admin panel. */
  info (nodeId) {
    const node = this.nodes.get(nodeId)
    return {
      // `max_commandno` is the last spent command number. The numbers are
      // an honest autoincrement and are not reused, so "I know up to N"
      // means "everything new will be ≥ N+1", even if some numbers went to
      // commands the node never saw (cancel, expiry).
      max_commandno: node?.state ?? 0,
      queued: node?.queue.length ?? 0,
      ready: node ? this.#readyCount(node) : 0,
      waiting: node?.waiting.size ?? 0,
      epoch: this.epoch,
    }
  }

  /**
   * Queue a command and get a promise for its outcome.
   * @param {object} command
   * @param {number} command.nodeId
   * @param {number} command.api
   * @param {string} command.method
   * @param {object} command.args
   * @param {number} [command.timeout] seconds
   * @param {object} [command.sandbox] `{mode, root}` from the model session
   * @returns {{seq: number|null, promise: Promise<object>}}
   */
  /**
   * A control command to a node: cancel, cleanup, anything service-related.
   *
   * Particulars: it takes no place in the waiting queue (nobody waits for the answer),
   * it lives a day — "gets there eventually" is a normal scenario, not an error.
   * The result, if it arrives, goes to the log.
   */
  control (nodeId, method, args = {}) {
    const { seq, promise } = this.enqueue({
      nodeId,
      api: CONTROL_API,
      method,
      args,
      timeout: CONTROL_TTL_SECONDS,
      // 10 — above any user command: a cancel must not stand
      // in the queue behind the work it is itself cancelling
      priority: CONTROL_PRIORITY,
    })
    // we do not await the promise: the answer is only interesting for the log
    promise.then((outcome) => {
      if (outcome?.status !== 'ok') {
        this.#controlLog?.(nodeId, method, args, outcome)
      }
    }).catch(() => {})
    return seq
  }

  /** Where to write the control command log: set from outside. */
  setControlLog (fn) {
    this.#controlLog = fn
  }

  /**
   * What to wake the node with: the same thing that wakes it for an ordinary command.
   *
   * Without this, `#INTERNAL.CANCEL` from a timeout lay in the queue until the client
   * woke up by itself: the cancel arrived seconds later, or even after the
   * command had already finished.
   */
  setNotify (fn) {
    this.#notify = fn
  }

  #controlLog = null
  #notify = null

  /**
   * Queue the barrier `#INTERNAL.FLUSH`.
   *
   * There is no waiter: the answer is only interesting to the log. The lifetime is shorter than
   * a day — a barrier nobody took holds the queue, and holding it forever is not allowed:
   * `sweep` will close it as lost and say so loudly.
   *
   * @returns {number} barrier number
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
      // a barrier holds only what is not above itself: a cancel overtakes
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
    // we count only unissued ones: a command already taken is no longer our concern,
    // otherwise a failure of one node locks the queue for all the others
    // we count the ceiling only over user commands: cancel and barriers
    // are needed exactly when the queue is full, and they must not be lost
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
    // the barrier takes its number before the command: the queue order and the
    // number order must not diverge — the client's `state` frame is checked against the
    // server's own count, holes included
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
      // metadata: the client uses it to set up the session directory. Not mandatory —
      // old clients simply ignore the field.
      session: session ?? null,
      question: question ?? null,
      escalation: escalation ?? 0,
      issuedAt: preciseNow(),
      status: 'ready',
      createdAt: Date.now(),
      expiresAt: Date.now() + seconds * 1000,
      // `ruleState` — internal marks of the rule: the server sets them itself when
      // it issues the command and when the answer arrives. The client has no influence on them
      rule,
      ruleState: rule === 'timing' ? {} : null,
      // 0 — ordinary work, more — control commands: a cancel flies
      // ahead, because otherwise it stands behind the very command it cancels
      priority,
    }
    node.queue.push(command)
    // we wake the node at once: control commands (CANCEL) used not to wake it at all
    this.#notify?.(nodeId)
    // and after it — "nothing starts behind me until I am done"
    if (flushAfter) this.#pushBarrier(node, priority)
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        node.waiting.delete(command.seq)
        const index = node.queue.indexOf(command)
        if (index >= 0) node.queue.splice(index, 1)
        this.#remember(node, command.seq)
        // we cancel only what was taken in flight: a command lying in the queue was never seen by the node,
        // removing it is enough (already done above)
        if (command.method !== CONTROL_CANCEL && command.status === 'processing') {
          this.control(nodeId, CONTROL_CANCEL, { seq: command.seq, reason: 'timeout' })
        }
        resolve({ status: 'timeout', code: 'timeout', message: 'Timeout reached', results: null })
      }, seconds * 1000)
      if (typeof timer.unref === 'function') timer.unref()
      node.waiting.set(command.seq, { resolve, timer, command })
    })
    // we hand issuedAt out: the server computes round-trip time from it
    return { seq: command.seq, promise, issuedAt: command.issuedAt }
  }

  /**
   * Issue a batch for execution.
   *
   * Commands are taken from the head of the queue among `ready`, move into
   * `processing` as one batch and are never issued again: "took it — means either executed it or
   * tried". There is no lease, no re-issue, and therefore no duplicates either.
   *
   * The barrier (`#INTERNAL.FLUSH`) is an exception to "as one batch": it is issued alone,
   * because its meaning is an empty pool, and it holds everything standing behind it until it
   * answers. Otherwise `flushAfter` and `flushAround` would remain a wish.
   *
   * @param {number} nodeId
   * @param {{limit?: number}} [options]
   * @returns {{commands: object[], ready: number, epoch: number}}
   */
  take (nodeId, { limit } = {}) {
    const node = this.#node(nodeId)
    const size = Math.min(Math.max(Number(limit) || this.maxBatch, 1), this.maxBatch)
    const batch = []

    // 1. First everything with a higher priority: a cancel must not stand behind the work
    //    it cancels. The barrier does not hold it — it holds only its own.
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.status !== 'ready' || !(command.priority > 0)) continue
      batch.push(command)
    }

    // 2. The ordinary stream — in queueing order (which is also the number order), and
    //    the barrier still goes first and alone: while it hangs, we issue nothing behind it.
    for (const command of node.queue) {
      if (batch.length >= size) break
      if (command.priority > 0) continue
      // we check the barrier before the status: a hanging barrier holds everything behind it,
      // it is not "skipped as not ready"
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
   * Remember a closed number: by it a late result gets a clear
   * "already closed" instead of "there was no such command".
   */
  #remember (node, seq) {
    node.closed ??= new Set()
    node.closed.add(seq)
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
  }

  /** How many commands are waiting to be issued. */
  #readyCount (node) {
    return node.queue.reduce((sum, command) => sum + (command.status === 'ready' ? 1 : 0), 0)
  }


  /**
   * Find an issued command by number — for the file transfer routes.
   *
   * The node presents `seq`: if such a command was issued to it and is not closed yet,
   * then the transfer is its own too. No separate ticket is needed — the command itself
   * serves as the ticket, and its state "issued, waiting for a result" is the permission.
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
    // our own copy: a route handler must not edit the queue
    return { ...command }
  }

  /**
   * Close a command with the result from the node.
   * @returns {'closed'|'already'|'unknown'}
   */
  close (nodeId, seq, payload) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const index = node.queue.findIndex((command) => command.seq === number)
    // not in the queue: either it is already closed, or such a number was never issued.
    // We look at the ring of recently closed ones, not at a cursor: a cursor speaks only about
    // issuing, and through it "already closed" turned into a guess.
    if (index < 0) return node.closed?.has(number) ? 'already' : 'unknown'
    const [command] = node.queue.splice(index, 1)
    // there is nobody to answer to for a barrier: its outcome only goes to the log, and staying
    // silent about a failure is not allowed — commands it held are standing behind it
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
    // a ring of 1000 numbers: more is needed only to diagnose repeats
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
    const waiter = node.waiting.get(number)
    if (waiter) {
      clearTimeout(waiter.timer)
      node.waiting.delete(number)
      // the marks and the node clock are needed by the `timing` rule. These are internal fields —
      // they do not go outside: the model gets only what the rule puts there
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
   * Cut off all waits of a node — only for internal events (node removal).
   * A socket break does not cancel commands: the timeout decides their fate (plan §7).
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

  /** Remove a command from the queue — call cancellation (plan §4.4.1). */
  cancel (nodeId, seq) {
    const node = this.#node(nodeId)
    const number = Number(seq)
    const index = node.queue.findIndex((command) => command.seq === number)
    if (index < 0) return false
    const [cancelled] = node.queue.splice(index, 1)
    this.#remember(node, number)
    // A command taken in flight lives on the node: removing it from the queue is not enough, we must
    // ask the node to stop. We also cancel service commands — a hanging
    // question to the human (`#INTERNAL.APPROVE`) cannot be closed otherwise; there is one exception —
    // the cancel itself, otherwise we get recursion.
    if (cancelled.method !== CONTROL_CANCEL && cancelled.status === 'processing') {
      this.control(nodeId, CONTROL_CANCEL, { seq: number, reason: 'cancelled' })
    }
    node.closed ??= new Set()
    node.closed.add(number)
    // a ring of 1000 numbers: more is needed only to diagnose repeats
    if (node.closed.size > 1000) node.closed.delete(node.closed.values().next().value)
    const waiter = node.waiting.get(number)
    if (waiter) {
      clearTimeout(waiter.timer)
      node.waiting.delete(number)
      waiter.resolve({ status: 'error', code: 'cancelled', message: 'cancelled', results: null })
    }
    return true
  }

  /** Remove commands nobody picked up within commandTtl. */
  /**
   * Lose everything the node supposedly executes.
   *
   * Called from `/v1/announce` when the client sends `epoch: null`, that is, says
   * "I do not know the server's generation" — it restarted and everything issued to it
   * died with it. No WebSocket frame may trigger this any more: a socket can come and go
   * without the node losing anything, and only announce is a statement about the process.
   * The model must get a clear error instead of waiting for its own timeout.
   *
   * @param {number} nodeId
   * @param {string} [code]
   * @returns {number} how many commands were closed
   */
  failInFlight (nodeId, code = 'node_restarted') {
    const pending = this.#node(nodeId)
    for (const command of [...pending.queue]) {
      // in flight — we ask the node to stop; merely waiting ones leave silently
      if (command.method !== CONTROL_CANCEL && command.status === 'processing') {
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
   * Remove garbage.
   *
   * Two different things: unissued commands simply age out (`commandTtl`), while ones taken
   * in flight — those the node never answered — are closed as `lost`,
   * so that the model gets a clear answer instead of waiting for its own timeout.
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
          // a lost barrier is a broken guarantee: behind it stood commands
          // it was supposed to hold back. We must not stay silent about it
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

  /** New generation: counters from zero (plan §4.7). */
  reset (epoch) {
    this.epoch = epoch
    this.nodes.clear()
  }
}
