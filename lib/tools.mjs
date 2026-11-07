/**
 * Тулы модели: что она видит и как это отрендерить.
 *
 * Живут отдельно от плагина, чтобы форму ответа можно было проверить тестом без
 * cordis: `render` обязан вернуть **массив** блоков, а не один блок — на этом
 * уже один раз спотыкались.
 *
 * @module dsh-nodes/tools
 */
import { randomUUID } from 'node:crypto'
import { ArgsError, checkArgs } from './args.mjs'
import { escalationReason } from './reason.mjs'
import { recordAudit } from './audit.mjs'
import { preciseNow } from './queue.mjs'

/**
 * Собрать определения тулов.
 * @param {object} deps
 * @param {import('./db.mjs').Store} deps.store
 * @param {import('./queue.mjs').Queue} deps.queue
 * @param {(nodeId: number) => void} [deps.notify]
 * @param {object} deps.config
 * @param {number} deps.epoch
 * @param {(session: unknown) => object|undefined} [deps.sandboxFor]
 */
/** Идентификатор сессии из контекста исполнения тула. */
let sessionShapeLogged = false
function sessionId (execution) {
  const agent = execution?.agent
  if (!agent) return null
  // поля называются по-разному в разных слоях, поэтому пробуем по порядку
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

/** Наш словарь режимов → словарь DSH: так сервер и клиент говорят об одном. */
const SANDBOX_TO_DSH = { ro: 'read-only', rw: 'workspace-write', full: 'danger-full-access' }

/** Насколько широко узел позволяет: что владелец узла поставил потолком. */
// `none` — узел ещё не объявил потолок: до объявления считаем самым узким,
// иначе человеку предлагают эскалацию до полного доступа на пустом месте
const NODE_MAX = { 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'full', none: 'ro' }

/** Куда можно повышать режим: строго шире, как в DSH. */
const WIDER = { ro: ['rw', 'full'], rw: ['full'], full: [] }

/** Отчёт песочницы из результата команды: клиент кладёт его последним блоком. */
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
 * Записать в аудит, чем закончилось исполнение команды.
 *
 * Пишем только то, что важно человеку: полный доступ (режим `full`), отказ
 * песочницы и эскалацию. Обычные чтения в `ro` не пишем — иначе витрина
 * забьётся мусором.
 */
/**
 * Дописать к ответу на `session.ping` измерения.
 *
 * Клиент возвращает отметку сервера (`sentAt`) и своё время (`pong`). Отсюда:
 *  - `rttMs` — сколько прошло от постановки команды до получения ответа, то
 *    есть вместе с очередью и сетью;
 *  - `clockSkewMs` — насколько часы узла ушли вперёд относительно сервера,
 *    с поправкой на половину отклика.
 *
 * @param {object} outcome результат команды
 * @param {object} args аргументы вызова
 * @returns {object} тот же результат с добавленным блоком
 */
export function annotatePing (outcome, args) {
  if (args?.method !== 'ping') return outcome
  const blocks = outcome?.results ?? []
  const last = blocks[blocks.length - 1]
  if (!last || typeof last.text !== 'string') return outcome
  let payload
  try {
    payload = JSON.parse(last.text)
  } catch {
    return outcome
  }
  if (typeof payload?.sentAt !== 'number' || typeof payload?.pong !== 'number') return outcome
  const now = preciseNow()
  // Единственное место, где сервер дописывает измерение: узел объявляет поле
  // `rttMs` в ответе, но ставит null — считать ему нечем, часов между машинами
  // он не знает. Правку делаем на месте, без лишнего блока: модель получает
  // ровно то, что узел обещал вернуть, только с заполненным полем.
  const filled = {
    ...payload,
    rttMs: Math.round((now - payload.sentAt) * 1000) / 1000,
    clockSkewMs: Math.round((payload.pong - payload.sentAt - (now - payload.sentAt) / 2) * 1000) / 1000,
  }
  return {
    ...outcome,
    results: [...blocks.slice(0, -1), { type: 'text', text: JSON.stringify(filled) }],
  }
}

/** Текст команды для аудита: строка как есть, остальное — JSON. */
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

export function createTools ({ store, queue, notify, config, epoch, sandboxFor, approval }) {
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
            description: 'Запросить более узкий режим песочницы; шире потолка узла не поднимется',
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
        // Узел адресуется алиасом (так модель не путает номера), но число тоже
        // принимаем: ядро может привести числовой аргумент к строке.
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
        // Пинг — проверка связи, а не работа: если узел завис, ждать его
        // таймаут бессмысленно. Потолок в 15 секунд, меньше — можно.
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
          session: sessionId(execution),
        })
        if (seq === null) return promise
        notify?.(node.id)
        execution?.signal?.addEventListener?.('abort', () => queue.cancel(node.id, seq), { once: true })
        let outcome = await promise
        recordOutcome({ store, config, node, args, execution, outcome })
        // Пинг: считаем отклик и разницу часов сами — модели недоступны часы,
        // а по двум отметкам это арифметика, которую лучше сделать здесь.
        outcome = annotatePing(outcome, args)
        const escalated = await escalate({ node, def, args, execution, outcome, requested: sandboxFor(execution?.agent?.session), approval, queue, notify, store, config })
        if (escalated) outcome = escalated
        return { node: node.id, api: def.id, method: args.method, ...outcome }
      },
    },
  ]
}

/**
 * Отказ песочницы → вопрос человеку → повтор с более широким режимом.
 *
 * Отказ приходит от клиента уже после того, как ядро не пустило команду,
 * поэтому «приостановить и подождать» не нужно: спрашиваем, и при согласии
 * ставим ту же команду заново. Клиент, у которого апрувы выключены владельцем,
 * отказывает сразу — тогда вопрос не задаётся вовсе.
 *
 * @returns {Promise<object|null>} результат повтора или null, если повтора не было
 */
async function escalate ({ node, def, args, execution, outcome, requested, approval, queue, notify, store, config }) {
  const report = sandboxReport(outcome)
  if (!report?.denied) return null

  if (!report.failed) {
    // команда в целом завершилась успешно, но ядро что-то отвергло: это не
    // повод для вопроса, но и молчать нельзя
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
    // потолок владельца узла: повышать некуда, и спрашивать не о чем
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

  // Спрашиваем САМ УЗЕЛ: он задаёт вопрос человеку за машиной своим инструментом
  // (`zenity`, `notify-send`, что настроено). Диалог живёт в очереди отдельной
  // командой, поэтому модель не ждёт: отдаём отказ сразу.
  const sessionApi = (store.catalog?.() ?? []).find((api) => api.name === 'session')
  // спрашиваем узел только если он сам объявил, что умеет: `approver: local`
  const localApprover = node.approver ? node.approver === 'local' : Boolean(sessionApi && node.allow_escalation)
  if (sessionApi && node.allow_escalation && localApprover) {
    const approvalId = randomUUID()
    const pending = queue.enqueue({
      nodeId: node.id,
      api: sessionApi.id,
      method: 'approve',
      args: { id: approvalId, text: reason, mode: target },
      timeout: config.approvalTtlSeconds ?? 86400,
      sandbox: { mode: 'danger-full-access' },
      session: sessionId(execution),
    })
    if (pending.seq === null) return { status: 'error', code: 'queue_full', message: 'очередь узла переполнена', results: outcome.results }
    // Ждём ответа человека в фоне: команду исполним, когда он согласится.
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
        // `approved` — отдельное поле конверта, а не часть sandbox: клиент
        // именно по нему понимает, что режим подтверждён человеком
        approved: approvalId,
        sandbox: { mode: target },
        escalation: (args.escalation ?? 0) + 1,
        session: sessionId(execution),
      })
      if (retry.seq === null) return
      notify?.(node.id)
      // повтор после подтверждения идёт мимо модели, поэтому и его исход надо
      // записать в аудит: иначе в истории видно «человек разрешил», но не видно,
      // что именно выполнилось
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

  // узел прямо сказал «вопросов не задавать»: это решение владельца машины,
  // и оно сильнее любого канала на стороне сервера
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

  // Ядро отвечает 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'.
  // Всё, кроме первого, — отказ: без этой проверки команда исполнялась бы
  // вопреки «Отклонить», то есть апрув ничего бы не значил.
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
    // approved — верхним уровнем: клиент читает именно его, а не sandbox.approved
    approved: approvalId,
    escalation: (args.escalation ?? 0) + 1,
    sandbox: { mode: target === 'ro' ? 'read-only' : target === 'rw' ? 'workspace-write' : 'danger-full-access' },
    session: sessionId(execution),
  })
  if (retry.seq === null) return null
  notify?.(node.id)
  void retry.promise.then((res) => {
    recordOutcome({ store, config, node, args: { ...args, escalation: (args.escalation ?? 0) + 1, approved: approvalId }, execution, outcome: res })
  })
  return retry.promise
}

/** Человеческий аптайм: 3h 12m, 5m, 40s. */
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
  // На ошибке результаты тоже нужны: в них код возврата и stderr команды.
  // Без них модель видит только пересказ и не может отличить «ядро не пустило»
  // от «команда упала сама».
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
