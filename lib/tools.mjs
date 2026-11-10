/**
 * Model tools: what it sees and how to render it.
 *
 * They live apart from the plugin so that the shape of the answer can be checked by a test
 * without cordis: `render` must return an **array** of blocks, not one block — we
 * already tripped over that once.
 *
 * @module dsh-nodes/tools
 */
import { statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ArgsError, checkArgs } from './args.mjs'
import { escalationReason } from './reason.mjs'
import { recordAudit } from './audit.mjs'
import { APPROVAL_PRIORITY, CONTROL_API, CONTROL_APPROVE, preciseNow } from './queue.mjs'
import { flushPhases, RULES } from './special-rules.mjs'
import { copyStream, selfHash, selfReadChunk, selfWriteChunk } from './copy.mjs'

/**
 * Build the tool definitions.
 * @param {object} deps
 * @param {import('./db.mjs').Store} deps.store
 * @param {import('./queue.mjs').Queue} deps.queue
 * @param {(nodeId: number) => void} [deps.notify]
 * @param {object} deps.config
 * @param {number} deps.epoch
 * @param {(session: unknown) => object|undefined} [deps.sandboxFor]
 * @param {(level: string, event: string, details: object) => void} [deps.log]
 */
/** Session identifier from the tool execution context. */
let sessionShapeLogged = false
/**
 * The identifiers by which the approval tool understands "within what" the question is.
 *
 * `rootCallId` is the root call of the turn, that is, the question of the human (or of the
 * top-level agent) inside which the model issues commands. By it the dialog can
 * remember "answer yes until the end of the question", by `session` — until the end of the session.
 */
export function questionOf (execution) {
  if (!execution) return null
  const rootCallId = execution.rootCallId ?? execution.callId ?? null
  if (!rootCallId) return null
  return { rootCallId: String(rootCallId), callId: execution.callId ? String(execution.callId) : null }
}

function sessionId (execution) {
  const agent = execution?.agent
  if (!agent) return null
  // the fields have different names in different layers, so we try them in order
  const candidates = [agent.sessionId, agent.session?.id, agent.session?.sessionId, agent.session, agent.id]
  for (const value of candidates) {
    if (typeof value === 'string' && value) {
      if (!sessionShapeLogged) {
        sessionShapeLogged = true
        console.log('[dsh-nodes] session из контекста:', value)
      }
      return value
    }
  }
  if (!sessionShapeLogged) {
    sessionShapeLogged = true
    console.warn('[dsh-nodes] не нашёл session в контексте, ключи агента:', Object.keys(agent).slice(0, 12).join(','))
  }
  return null
}

/** Our mode vocabulary → the DSH vocabulary: that way the server and the client mean the same. */
const SANDBOX_TO_DSH = { ro: 'read-only', rw: 'workspace-write', full: 'danger-full-access' }

/** How wide the node allows: what the node owner set as the ceiling. */
// `none` — the node has not declared a ceiling yet: until it does we count as the narrowest,
// otherwise the human is offered an escalation to full access out of nowhere
const NODE_MAX = { 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'full', none: 'ro' }

/** Where the mode may be raised to: strictly wider, as in DSH. */
const WIDER = { ro: ['rw', 'full'], rw: ['full'], full: [] }

/** Sandbox report from the command result: the client puts it in as the last block. */
export function sandboxReport (outcome) {
  const blocks = Array.isArray(outcome?.results) ? outcome.results : []
  for (let i = blocks.length - 1; i >= 0; i--) {
    const text = blocks[i]?.text
    if (typeof text !== 'string' || !text.startsWith('{')) continue
    try {
      const parsed = JSON.parse(text)
      if (parsed?.sandbox) return { ...parsed.sandbox, code: parsed.code }
    } catch {}
  }
  return null
}

/**
 * Write into the audit how the command execution ended.
 *
 * We write only what matters to the human: full access (mode `full`), a sandbox
 * denial and an escalation. Ordinary reads in `ro` are not written — otherwise the shop
 * window would fill up with garbage.
 */
/**
 * Ask the human **before** the start if the mode asked for is wider than the start mode.
 *
 * `sandboxStrict` exists for jobs: with `exec` the kernel refusal comes in the result,
 * and the server does manage to ask after the fact, while the job simply fails inside itself.
 * That is why we ask in advance — and the permission applies exactly to this run.
 *
 * @returns {Promise<{approvedId?: string, escalation?: number, error?: object}>}
 */
async function preflightApproval ({ node, args, requested, approval, queue, notify, store, config, execution }) {
  const target = requested?.mode ? (SANDBOX_TO_DSH[requested.mode] ?? requested.mode) : null
  const order = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
  const short = { 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'full' }
  if (!target || !(target in order)) {
    return { error: { status: 'error', code: 'bad_args', message: 'sandboxStrict требует явный sandbox', results: null } }
  }
  const nodeMax = NODE_MAX[node.access] ?? 'ro'
  const nodeBase = node.base ?? 'ro'
  const want = short[target]
  // wider than the ceiling — an immediate no, there is nothing to ask about
  if (order[target] > order[nameToDsh(nodeMax)]) {
    return { error: { status: 'error', code: 'sandbox_denied', message: `узел ${node.name} (${node.id}): потолок ${nodeMax}, режим ${want} недоступен`, results: null } }
  }
  // within the start mode — an ordinary run, no question needed
  if (order[target] <= order[nameToDsh(nodeBase)]) return {}

  if (node.approver === 'none') {
    return { error: { status: 'error', code: 'sandbox_denied', message: `узел ${node.name} (${node.id}): вопросы выключены (approver: none), режим шире ${nodeBase} недоступен`, results: null } }
  }
  const reason = `Узел ${node.name} (${node.id}): запрошен режим ${want} сразу, без понижения до ${nodeBase}.\n`
    + `Команда: ${commandText(args)}\n`
    + `Сейчас: ${nodeBase} — стартовый режим узла.\n`
    + `Запрашивается: ${want}.\n`
    + 'Разрешение разовое и только для этого запуска. Если это задание, оно стартует только после согласия.'

  const approvalId = `dsh-${randomUUID()}`
  // A question to the human is a service command, not a node method: it need not be declared,
  // it does not depend on the `session` contract and is the same for all clients.
  // Declared `approver: local` — means implemented it; did not implement — it answers
  // `unknown_method`, and that is an honest refusal.
  if (node.approver === 'local') {
    const ttlSeconds = Number(config.approvalTtlSeconds ?? 86400)
    const pending = queue.enqueue({
      nodeId: node.id,
      api: CONTROL_API,
      method: CONTROL_APPROVE,
      args: { id: approvalId, text: reason, mode: want },
      // the question lives as long as the config says and does not fade by itself:
      // the human will answer or type /stop
      timeout: ttlSeconds,
      priority: APPROVAL_PRIORITY,
      sandbox: { mode: 'danger-full-access' },
      session: sessionId(execution),
      question: questionOf(execution),
    })
    if (pending.seq === null) return { error: { status: 'error', code: 'queue_full', message: 'очередь узла переполнена', results: null } }
    notify?.(node.id)
    // We wait for the answer as long as stated. Cancelling the call (including /stop) removes
    // the command — then the promise wakes up with `cancelled`, and everything moves on.
    const onAbort = () => queue.cancel(node.id, pending.seq)
    execution?.signal?.addEventListener?.('abort', onAbort, { once: true })
    const answer = await pending.promise
    execution?.signal?.removeEventListener?.('abort', onAbort)
    if (answer?.status === 'timeout' || answer?.code === 'cancelled') {
      queue.cancel(node.id, pending.seq)
      recordAudit({ store, config, event: { kind: 'approve', node: node.id, session: sessionId(execution), mode: want, command: commandText(args), escalation: 1, approved: approvalId, outcome: 'pending' } })
      return { error: { status: 'error', code: 'sandbox_denied', message: `узел ${node.name} (${node.id}): человек не ответил — команда не запущена`, results: null } }
    }
    const approved = (answer.results ?? []).some((block) => {
      try {
        return JSON.parse(block.text)?.approved === true
      } catch {
        return false
      }
    })
    recordAudit({ store, config, event: { kind: 'approve', node: node.id, session: sessionId(execution), mode: want, command: commandText(args), escalation: 1, approved: approvalId, outcome: approved ? 'approved' : 'rejected' } })
    if (!approved) {
      return { error: { status: 'error', code: 'sandbox_denied', message: `человек отказал: режим ${want} на узле ${node.name} (${node.id}) не разрешён`, results: null } }
    }
    return { approvedId: approvalId, escalation: 1 }
  }

  if (!approval || typeof approval.request !== 'function') {
    return { error: { status: 'error', code: 'sandbox_denied', message: `узел ${node.name} (${node.id}): спросить человека негде`, results: null } }
  }
  let verdict = 'rejected'
  try {
    verdict = await approval.request({ agent: execution?.agent, toolName: execution?.name ?? 'nodes_call', callId: execution?.callId, reason, signal: execution?.signal })
  } catch {
    verdict = 'unavailable'
  }
  recordAudit({ store, config, event: { kind: 'approve', node: node.id, session: sessionId(execution), mode: want, command: commandText(args), escalation: 1, approved: approvalId, outcome: verdict === 'allowed-once' ? 'approved' : 'rejected' } })
  if (verdict !== 'allowed-once') {
    return { error: { status: 'error', code: 'sandbox_denied', message: `человек отказал: режим ${want} на узле ${node.name} (${node.id}) не разрешён`, results: null } }
  }
  return { approvedId: approvalId, escalation: 1 }
}

/** Short mode name → the DSH vocabulary. */
function nameToDsh (mode) {
  return { ro: 'read-only', rw: 'workspace-write', full: 'danger-full-access' }[mode] ?? mode
}


/**
 * The `timing` rule: compute the measurement and put it where it was told.
 *
 * A rule is a wrapper, and everything it can do it knows by itself:
 *
 * - `durationMs` — how long the command took. Computed from the server's marks
 *   (`ruleState.startedAt` on issue and `ruleState.finishedAt` on answer),
 *   so it does not depend on the node at all: the node may send nothing;
 * - `clockSkewMs` — how far the node clock is ahead of the server one. Here the node cannot
 *   be avoided: its time is needed (`now` in the answer envelope). Did not send it — we do not
 *   compute and do not invent.
 *
 * Where to put the computed value is decided by the binding's `retNames`: canonical name →
 * field in the answer. No name — the value lands nowhere (computing "into the drawer"
 * is legitimate, but inventing a field name on behalf of the node is not).
 *
 * The `startedAt`/`finishedAt` marks are the rule's internal business: they never
 * get into the answer.
 *
 * @param {object} outcome command outcome with the internal `internal` fields
 * @param {{opts?: {retNames?: Record<string, string>}|null, log?: Function}} [options]
 * @returns {object} outcome with the measurement fields filled in
 */
export function annotateTiming (outcome, { opts, log } = {}) {
  const state = outcome?.internal?.ruleState ?? null
  const names = opts?.retNames ?? null
  if (!state || typeof state.startedAt !== 'number' || typeof state.finishedAt !== 'number') {
    log?.('error', 'special-rule-violated', {
      rule: 'timing',
      problem: 'у команды нет отметок правила: команда ушла мимо очереди с правилом',
    })
    return outcome
  }
  const values = {
    durationMs: Math.round((state.finishedAt - state.startedAt) * 1000) / 1000,
    clockSkewMs: Number.isFinite(outcome?.internal?.nodeNow)
      ? Math.round((outcome.internal.nodeNow - state.finishedAt) * 1000) / 1000
      : null,
  }
  if (!names) return outcome
  const blocks = outcome.results ?? []
  const last = blocks[blocks.length - 1]
  let payload = null
  if (last && typeof last.text === 'string') {
    try {
      payload = JSON.parse(last.text)
    } catch {
      payload = null
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    log?.('error', 'special-rule-violated', {
      rule: 'timing',
      problem: 'ответ узла — не JSON-объект: замер положить некуда',
    })
    return outcome
  }
  const filled = { ...payload }
  for (const canonical of RULES.timing.outputs) {
    const field = names[canonical]
    if (!field) continue
    // there is nothing to compute — we do not substitute zeros: let the field stay as it came
    if (values[canonical] === null) continue
    filled[field] = values[canonical]
  }
  return { ...outcome, results: [...blocks.slice(0, -1), { type: 'text', text: JSON.stringify(filled) }] }
}

/**
 * Where the copy destination points: a node or the DSH host.
 * @param {object} store
 * @param {unknown} value node alias, its number or 'self'
 */
export function resolveEndpoint (store, value) {
  const raw = String(value ?? '').trim()
  if (raw === 'self' || raw === 'this') return { kind: 'self' }
  if (!raw) return null
  const node = store.nodeByAlias(raw) ?? (/^\d+$/.test(raw) ? store.node(Number(raw)) : null)
  return node ? { kind: 'node', node } : null
}

/**
 * Which host directories are available as `self`.
 *
 * The session working directory is always allowed: the model writes there with its own
 * tools anyway. `selfRoots` is an extension for those who need another place.
 */
export async function resolveSelfRoots (config, execution, sessionDir) {
  const roots = [...(config.selfRoots ?? [])]
  try {
    const dir = await sessionDir?.(execution)
    if (dir) roots.unshift(dir)
  } catch {}
  return roots.filter(Boolean)
}

/** Path on the host: a relative one counts from the session directory, leaving it is forbidden. */
export function selfPath (roots, path) {
  const candidate = String(path ?? '')
  const target = candidate.startsWith('/') ? candidate : (roots[0] ? `${roots[0]}/${candidate}` : candidate)
  if (!roots.some((root) => target === root || target.startsWith(`${root}/`))) {
    throw Object.assign(new Error(`путь ${target} вне разрешённых каталогов хоста: ${roots.join(', ') || 'нет ни одного'}`), { code: 'path_denied' })
  }
  return target
}

/** The "DSH host" side: direct file operations inside the allowed directories. */
export function selfSide (roots, path) {
  const pick = (value) => {
    const candidate = String(value ?? '')
    const target = candidate.startsWith('/') ? candidate : (roots[0] ? `${roots[0]}/${candidate}` : candidate)
    if (!roots.some((root) => target === root || target.startsWith(`${root}/`))) {
      throw Object.assign(new Error(`путь ${target} вне разрешённых каталогов хоста: ${roots.join(', ') || 'нет ни одного'}`), { code: 'path_denied' })
    }
    return target
  }
  const target = pick(path)
  return {
    stat: async () => ({ size: statSync(target).size }),
    hash: async () => selfHash(target),
    read: async (offset, size) => selfReadChunk(target, offset, size),
    write: async (offset, data, final) => selfWriteChunk(target, offset, data, final),
  }
}

/** The "node" side: the same operations, but as commands through the queue. */
export function nodeSide ({ endpoint, store, queue, notify, timeout, path: nodePath }) {
  const filesApi = (store.nodeApis(endpoint.node.id) ?? [])
    .map((id) => store.api(id))
    .find((api) => api?.name === 'files')
  if (!filesApi) {
    throw Object.assign(new Error(`узел ${endpoint.node.name} не объявил files`), { code: 'no_files_api' })
  }
  const call = async (method, data, seconds) => {
    const { seq, promise } = queue.enqueue({
      nodeId: endpoint.node.id,
      api: filesApi.id,
      method,
      args: data,
      timeout: seconds,
    })
    if (seq === null) throw Object.assign(new Error('очередь узла переполнена'), { code: 'queue_full' })
    notify?.(endpoint.node.id)
    const outcome = await promise
    const block = (outcome.results ?? []).at(-1)?.text
    let payload = null
    try {
      payload = block ? JSON.parse(block) : null
    } catch {}
    if (outcome.status !== 'ok' || !payload) {
      throw Object.assign(new Error(outcome.message ?? 'узел не ответил'), { code: outcome.code ?? 'copy_failed' })
    }
    return payload
  }
  const perChunk = Math.max(1, Number(timeout) || 120)
  return {
    stat: async () => await call('stat', { path: nodePath }, perChunk),
    hash: async () => await call('sha256', { path: nodePath }, perChunk),
    read: async (offset, size) => await call('readChunk', { path: nodePath, offset, size }, perChunk),
    write: async (offset, data, final) => await call('writeChunk', { path: nodePath, offset, data, final }, perChunk),
  }
}

function renderCopy (value) {
  const payload = Array.isArray(value?.results) ? value.results[0]?.text : null
  return payload ?? value?.message ?? 'нет результата'
}

/** Command text for the audit: a string as is, everything else as JSON. */
function commandText (args) {
  return typeof args?.data?.command === 'string' ? args.data.command : JSON.stringify(args?.data ?? {})
}

function recordOutcome ({ store, config, node, args, execution, outcome }) {
  try {
    const report = sandboxReport(outcome)
    const mode = report?.mode ?? null
    const command = typeof args.data?.command === 'string' ? args.data.command : JSON.stringify(args.data ?? {})
    const worth = report?.denied || mode === 'full' || (args.escalation ?? 0) > 0
    if (!worth) return
    recordAudit({
      store,
      config,
      event: {
        kind: report?.denied ? 'denied' : 'exec',
        node: node.id,
        session: sessionId(execution),
        mode,
        command,
        code: report?.code ?? null,
        escalation: args.escalation ?? 0,
        approved: args.approved ?? null,
        outcome: report?.denied ? (report.signature ?? 'denied') : 'ok',
      },
    })
  } catch {}
}

import { buildNotification, notificationId } from './notifications.mjs'

export function createTools ({ store, queue, notify, config, epoch, sandboxFor, approval, sessionDir, log }) {
  return [
    {
      name: 'nodes_list',
      description: 'Список узлов: алиасы, онлайн, сколько молчит, какие API держит.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: renderNodes(value) }],
      },
      async execute () {
        return {
          nodes: store.nodes().map((node) => ({
            id: node.id,
            aliases: node.aliases,
            name: node.name,
            online: Boolean(node.last_seen && Date.now() - node.last_seen < config.aliveTimeoutSeconds * 1000),
            lastSeen: node.last_seen,
            bootAt: node.boot_at ?? null,
            apis: node.apis,
            access: node.access,
          })),
          epoch,
        }
      },
    },
    {
      name: 'nodes_catalog',
      description: 'Справочник API: номер, имя, методы. С него начинается любой вызов.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: renderCatalog(value) }],
      },
      async execute () {
        return { apis: store.catalog() }
      },
    },
    {
      name: 'nodes_api',
      description: 'Методы одного API со схемами аргументов.',
      parameters: {
        type: 'object',
        properties: { api: { type: 'number' } },
        required: ['api'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: renderApi(value) }],
      },
      async execute (args) {
        const def = store.api(Number(args.api))
        if (!def) return { error: `unknown api ${args.api}` }
        return { api: def }
      },
    },
    {
      name: 'nodes_call',
      description: 'Вызвать метод API на узле. Возвращает {status, message, results}.',
      parameters: {
        type: 'object',
        properties: {
          node: { type: ['number', 'string'] },
          api: { type: 'number' },
          method: { type: 'string' },
          data: { type: 'object' },
          timeout: { type: 'number' },
          sandbox: {
            type: 'string',
            enum: ['ro', 'rw', 'full'],
            description: 'Запрошенный режим песочницы; без sandboxStrict он понижается до стартового',
          },
          sandboxStrict: {
            type: 'boolean',
            description: 'Не понижать режим до стартового: спросить человека до запуска и выполнить как запрошено',
          },
        },
        required: ['node', 'api', 'method'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: renderCall(value) }],
      },
      async execute (args, execution) {
        // A node is addressed by alias (that way the model does not mix up numbers), but we
        // accept a number too: the core may turn a numeric argument into a string.
        const raw = args.node
        const asNumber = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw ?? '')) ? Number(raw) : null)
        const node = asNumber !== null ? store.node(asNumber) : store.nodeByAlias(String(raw ?? ''))
        if (!node) return { status: 'error', code: 'unknown_node', message: `unknown node ${args.node}`, results: null }
        const def = store.api(Number(args.api))
        if (!def) return { status: 'error', code: 'unknown_api', message: `unknown api ${args.api}`, results: null }
        if (!store.nodeHasApi(node.id, def.id)) {
          return { status: 'error', code: 'unknown_api', message: `узел ${node.id} не держит api ${def.id}`, results: null }
        }
        try {
          checkArgs(def, args.method, args.data ?? {})
        } catch (error) {
          if (error instanceof ArgsError) {
            return { status: 'error', code: error.code, message: error.message, results: null }
          }
          throw error
        }
        const requestedSandbox = args.sandbox
          ? { mode: SANDBOX_TO_DSH[args.sandbox] ?? args.sandbox }
          : sandboxFor(execution?.agent?.session)
        // `sandboxStrict` — "do not lower to base": we ask the human BEFORE the start.
        // Needed where the refusal cannot be seen in the result: the job fails already
        // inside the process, and after the fact there is nobody to ask.
        let preApproved = null
        let preEscalation = 0
        if (args.sandboxStrict === true) {
          const preflight = await preflightApproval({
            node, args, requested: requestedSandbox, approval, queue, notify, store, config, execution,
          })
          if (preflight.error) return preflight.error
          preApproved = preflight.approvedId
          preEscalation = preflight.escalation
        }
        // A ping is a link check, not work: if the node hangs, waiting for its
        // timeout is pointless. The ceiling is 15 seconds, anything less is fine.
        // the rule is bound to this node's method by a separate applyRules list:
        // it is not in the API declaration, so an external source (MCP) is free
        // to send any def, knowing nothing about rules
        const binding = store.nodeRule(node.id, def.id, args.method)
        const phases = flushPhases(binding?.rule)
        const pingCap = args.method === 'ping' ? 15 : null
        const requestedTimeout = args.timeout ?? node.default_timeout ?? undefined
        const effectiveTimeout = pingCap
          ? Math.min(Number(requestedTimeout) > 0 ? Number(requestedTimeout) : pingCap, pingCap)
          : requestedTimeout
        const { seq, promise, issuedAt } = queue.enqueue({
          nodeId: node.id,
          api: def.id,
          method: args.method,
          args: args.data ?? {},
          timeout: effectiveTimeout,
          sandbox: requestedSandbox,
          ...(preApproved ? { approved: preApproved } : {}),
          ...(preEscalation ? { escalation: preEscalation } : {}),
          session: sessionId(execution),
          flushBefore: phases?.before === true,
          flushAfter: phases?.after === true,
          rule: binding?.rule ?? null,
        })
        if (seq === null) return promise
        notify?.(node.id)
        execution?.signal?.addEventListener?.('abort', () => queue.cancel(node.id, seq), { once: true })
        let outcome = await promise
        if (outcome?.status === 'ok' && binding?.rule === 'timing') {
          outcome = annotateTiming(outcome, { opts: binding.opts, log })
        }
        recordOutcome({ store, config, node, args, execution, outcome })
        // one step — one question: after a preflight approval we do not start the ladder,
        // otherwise the model would beg two permissions for one command
        const escalated = args.sandboxStrict === true
          ? null
          : await escalate({ node, def, args, execution, outcome, requested: sandboxFor(execution?.agent?.session), approval, queue, notify, store, config })
        if (escalated) outcome = escalated
        // internal marks (ruleState, node clock, issue time) do not go outside,
        // even if the outcome came from a retry after an approval
        const { internal: _internal, ...visible } = outcome ?? {}
        return { node: node.id, api: def.id, method: args.method, ...visible }
      },
    },

    {
      name: 'nodes_notify',
      description: 'Показать уведомление на устройстве с кнопками. Нажатие вернётся событием в эту же сессию.',
      parameters: {
        type: 'object',
        properties: {
          node: { type: 'string', description: 'Алиас или номер узла' },
          title: { type: 'string', description: 'Заголовок уведомления' },
          text: { type: 'string', description: 'Текст уведомления' },
          purpose: { type: 'string', description: 'Зачем это уведомление — увидит модель, когда нажмут кнопку' },
          buttons: {
            type: 'array',
            items: { type: 'string' },
            description: 'До трёх подписей кнопок; пусто — уведомление без кнопок',
          },
        },
        required: ['node', 'text'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (args, value) => [{ type: 'text', text: value.queued
          ? `уведомление ${value.id} отправлено на ${value.device}`
          : `не отправлено: ${value.message}` }],
      },
      async execute (args, execution) {
        const endpoint = resolveEndpoint(store, String(args.node ?? ''))
        if (!endpoint?.node) return { queued: false, message: `нет узла ${args.node}` }
        const session = sessionId(execution)
        if (!session) return { queued: false, message: 'не понял, в какую сессию вернуть нажатие' }
        const api = (store.nodeApis(endpoint.node.id) ?? [])
          .map((id) => store.api(id))
          .find((item) => item?.name === 'notifications')
        if (!api) {
          return { queued: false, message: `узел ${endpoint.node.name} не умеет уведомления — обнови клиент` }
        }
        const id = notificationId()
        const payload = buildNotification({
          id,
          title: args.title ?? endpoint.node.name,
          text: args.text,
          buttons: args.buttons ?? [],
          purpose: args.purpose ?? null,
        })
        // the record lives on the server: the device sends only "a button was pressed"
        store.createNotification({
          id,
          node: endpoint.node.id,
          session: String(session),
          purpose: payload.purpose,
          title: payload.title,
          text: payload.text,
          buttons: payload.buttons,
        })
        const { seq } = queue.enqueue({
          nodeId: endpoint.node.id,
          api: api.id,
          method: 'post',
          args: { id, title: payload.title, text: payload.text, buttons: payload.buttons },
          timeout: 10,
        })
        if (seq === null) return { queued: false, message: 'очередь узла переполнена' }
        notify?.(endpoint.node.id)
        return { queued: true, id, device: endpoint.node.name, buttons: payload.buttons.length }
      },
    },
  ]
}

/**
 * Sandbox refusal → question to the human → retry with a wider mode.
 *
 * The refusal comes from the client already after the kernel kept the command out,
 * so "pause and wait" is not needed: we ask, and on consent we
 * queue the same command again. A client whose approvals are turned off by the owner
 * refuses at once — then the question is not asked at all.
 *
 * @returns {Promise<object|null>} the retry result, or null if there was no retry
 */
async function escalate ({ node, def, args, execution, outcome, requested, approval, queue, notify, store, config }) {
  const report = sandboxReport(outcome)
  if (!report?.denied) return null

  if (!report.failed) {
    // the command finished successfully as a whole, but the kernel rejected something: that is not
    // a reason for a question, but staying silent is not allowed either
    return {
      status: 'ok',
      results: [
        ...(outcome.results ?? []),
        { type: 'text', text: `[sandbox] часть команды отвергнута: ${report.signature ?? 'нет доступа'} (режим ${report.mode})` },
      ],
    }
  }

  const current = report.mode ?? requested?.mode ?? 'ro'
  const nodeMax = NODE_MAX[node.access] ?? 'ro'
  const ladder = (WIDER[current] ?? []).filter((mode) => {
    const order = ['ro', 'rw', 'full']
    return order.indexOf(mode) <= order.indexOf(nodeMax)
  })

  if (!ladder.length) {
    // the node owner's ceiling: there is nowhere to raise to, and nothing to ask about
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}). `
        + `Потолок узла — ${nodeMax}, повышать некуда: команда не выполнена, режим не изменится от повтора.`,
      results: outcome.results,
    }
  }
  if (!node.allow_escalation) {
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}). `
        + 'Апрувы на этом узле запрещены владельцем: команда не выполнена, повторять её не надо — '
        + 'режим меняется только в конфиге узла.',
      results: outcome.results,
    }
  }
  const target = ladder[0]
  const reason = escalationReason({ node, args, report, current, target })

  // We ask the NODE ITSELF: it asks the human at the machine with its own tool
  // (`zenity`, `notify-send`, whatever is set up). The dialog lives in the queue as a separate
  // command, so the model does not wait: we hand back the refusal at once.
  // we take the number from THIS node's declarations: the catalog is shared, and session@3 at one
  // We ask the node only if it said itself that it can: `approver: local`.
  // The command is a service one, it no longer depends on the `session` contract.
  // We ask the node only if it said outright `approver: local`. Old
  // clients never sent such a field — they get the DSH dialog, and that is
  // safer than queuing a command they cannot handle
  const localApprover = node.approver === 'local'
  if (node.allow_escalation && localApprover) {
    const approvalId = randomUUID()
    const pending = queue.enqueue({
      nodeId: node.id,
      api: CONTROL_API,
      method: CONTROL_APPROVE,
      args: { id: approvalId, text: reason, mode: target },
      timeout: Number(config.approvalTtlSeconds ?? 86400),
      priority: APPROVAL_PRIORITY,
      sandbox: { mode: 'danger-full-access' },
      session: sessionId(execution),
      question: questionOf(execution),
    })
    if (pending.seq === null) return { status: 'error', code: 'queue_full', message: 'очередь узла переполнена', results: outcome.results }
    // We wait for the human's answer in the background: we execute the command once they agree.
    void pending.promise.then((answer) => {
      const approved = (answer.results ?? []).some((block) => {
        try {
          return JSON.parse(block.text)?.approved === true
        } catch {
          return false
        }
      })
      recordAudit({
        store,
        config,
        event: {
          kind: 'approve',
          node: node.id,
          session: sessionId(execution),
          mode: target,
          command: typeof args.data?.command === 'string' ? args.data.command : JSON.stringify(args.data ?? {}),
          escalation: (args.escalation ?? 0) + 1,
          approved: approvalId,
          outcome: approved ? 'approved' : 'cancelled',
        },
      })
      if (!approved) return
      const retry = queue.enqueue({
        nodeId: node.id,
        api: def.id,
        method: args.method,
        args: args.data ?? {},
        timeout: args.timeout ?? node.default_timeout ?? undefined,
        // `approved` is a separate field of the envelope, not part of sandbox: it is exactly
        // by it that the client understands the mode was confirmed by the human
        approved: approvalId,
        sandbox: { mode: target },
        escalation: (args.escalation ?? 0) + 1,
        session: sessionId(execution),
        // the method rule does not change because the command was retried after
        // consent: the barriers stay the same
        flushBefore: flushPhases(store.nodeRule(node.id, def.id, args.method)?.rule)?.before === true,
        flushAfter: flushPhases(store.nodeRule(node.id, def.id, args.method)?.rule)?.after === true,
        rule: store.nodeRule(node.id, def.id, args.method)?.rule ?? null,
      })
      if (retry.seq === null) return
      notify?.(node.id)
      // a retry after confirmation goes past the model, so its outcome must be
      // written to the audit too: otherwise the history shows "the human allowed it" but not
      // what exactly was executed
      void retry.promise.then((res) => {
        recordOutcome({
          store,
          config,
          node,
          args: { ...args, escalation: (args.escalation ?? 0) + 1, approved: approvalId },
          execution,
          outcome: res,
        })
      })
    })
    notify?.(node.id)
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}). `
        + `Спросил владельца узла: ждёт подтверждения на переход ${current} → ${target}. `
        + 'Отвечать здесь не нужно — команда выполнится сама, если разрешат.',
      results: outcome.results,
    }
  }

  // the node said outright "do not ask questions": this is the decision of the machine owner,
  // and it is stronger than any channel on the server side
  if (node.approver === 'none') {
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}). `
        + 'Владелец узла выключил вопросы (approver: none): команда не выполнена, '
        + 'режим меняется только в конфиге узла.',
      results: outcome.results,
    }
  }

  if (!approval || typeof approval.request !== 'function') {
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}), `
        + 'спросить человека негде: команда не выполнена.',
      results: outcome.results,
    }
  }

  let verdict = 'rejected'
  try {
    verdict = await approval.request({
      agent: execution?.agent,
      toolName: execution?.name ?? 'nodes_call',
      callId: execution?.callId,
      reason,
      signal: execution?.signal,
    })
  } catch {
    verdict = 'unavailable'
  }

  // The core answers 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'.
  // Everything except the first is a refusal: without this check the command would be executed
  // despite "Reject", that is, the approval would mean nothing.
  if (verdict !== 'allowed-once') {
    recordAudit({
      store,
      config,
      event: {
        kind: 'approve',
        node: node.id,
        session: sessionId(execution),
        mode: target,
        command: commandText(args),
        escalation: (args.escalation ?? 0) + 1,
        outcome: verdict === 'rejected' ? 'rejected' : verdict,
      },
    })
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `человек отказал в повышении прав: узел ${node.name} (${node.id}) остаётся в режиме ${current}. `
        + 'Команда не выполнена, повторять её не надо.' + (verdict === 'rejected' ? '' : ` (${verdict})`),
      results: outcome.results,
    }
  }

  const approvalId = `dsh-${randomUUID()}`
  recordAudit({
    store,
    config,
    event: {
      kind: 'approve',
      node: node.id,
      session: sessionId(execution),
      mode: target,
      command: commandText(args),
      escalation: (args.escalation ?? 0) + 1,
      approved: approvalId,
      outcome: 'approved',
    },
  })
  const retry = queue.enqueue({
    nodeId: node.id,
    api: def.id,
    method: args.method,
    args: args.data ?? {},
    timeout: args.timeout ?? node.default_timeout ?? undefined,
    // approved at the top level: the client reads exactly that, not sandbox.approved
    approved: approvalId,
    escalation: (args.escalation ?? 0) + 1,
    sandbox: { mode: target === 'ro' ? 'read-only' : target === 'rw' ? 'workspace-write' : 'danger-full-access' },
    session: sessionId(execution),
    flushBefore: flushPhases(store.nodeRule(node.id, def.id, args.method)?.rule)?.before === true,
    flushAfter: flushPhases(store.nodeRule(node.id, def.id, args.method)?.rule)?.after === true,
    rule: store.nodeRule(node.id, def.id, args.method)?.rule ?? null,
  })
  if (retry.seq === null) return null
  notify?.(node.id)
  void retry.promise.then((res) => {
    recordOutcome({ store, config, node, args: { ...args, escalation: (args.escalation ?? 0) + 1, approved: approvalId }, execution, outcome: res })
  })
  return retry.promise
}

/** Human uptime: 3h 12m, 5m, 40s. */
export function humanUptime (ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function renderNodes ({ nodes }) {
  if (!nodes.length) return 'узлов нет'
  return nodes.map((node) => {
    const uptime = node.bootAt && node.online ? `, uptime ${humanUptime(Date.now() - node.bootAt)}` : ''
    const fresh = node.online
      ? `online${uptime}`
      : node.lastSeen ? `offline ${ago(node.lastSeen)}` : 'никогда не выходил на связь'
    return `${node.id} — ${node.aliases.join(', ')} (${fresh}), access: ${node.access}, apis: ${node.apis.join(', ') || '—'}`
  }).join('\n')
}

function renderCatalog ({ apis }) {
  if (!apis.length) return 'справочник пуст: ни один узел ещё не объявлял API'
  return apis.map((api) => {
    const name = api.version ? `${api.name} (${api.version})` : api.name
    const methods = api.methods.map((m) => m.method).join(', ')
    return `${api.id} — ${name} (${methods}), держит узлов: ${api.refcount}`
  }).join('\n')
}

function renderApi ({ api, error }) {
  if (error) return error
  const lines = [`${api.id} — ${api.name}${api.version ? ' ' + api.version : ''}`]
  for (const m of api.methods ?? []) {
    const args = Object.entries(m.args?.properties ?? {}).map(([key, rule]) => `${key}: ${rule.type ?? 'any'}`)
    lines.push(`  ${m.method}(${args.join(', ')})${m.description ? ' — ' + m.description : ''}`)
  }
  return lines.join('\n')
}

function renderCall (value) {
  const head = `${value.status}${value.code ? ' (' + value.code + ')' : ''}`
  const text = (value.results ?? []).map((block) => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
  if (value.status === 'ok') return text ? `${head}\n${text}` : head
  // On an error the results are needed too: they carry the exit code and the command stderr.
  // Without them the model sees only a retelling and cannot tell "the kernel kept it out"
  // from "the command failed by itself".
  const reason = `${head}: ${value.message ?? ''}`
  return text ? `${reason}\n${text}` : reason
}

function ago (ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
