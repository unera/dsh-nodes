/**
 * Тулы модели: что она видит и как это отрендерить.
 *
 * Живут отдельно от плагина, чтобы форму ответа можно было проверить тестом без
 * cordis: `render` обязан вернуть **массив** блоков, а не один блок — на этом
 * уже один раз спотыкались.
 *
 * @module dsh-nodes/tools
 */
import { ArgsError, checkArgs } from './args.mjs'
import { escalationReason } from './reason.mjs'

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
const NODE_MAX = { 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'full', none: 'full' }

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
        const { seq, promise } = queue.enqueue({
          nodeId: node.id,
          api: def.id,
          method: args.method,
          args: args.data ?? {},
          timeout: args.timeout ?? node.default_timeout ?? undefined,
          sandbox: requestedSandbox,
          session: sessionId(execution),
        })
        if (seq === null) return promise
        notify?.(node.id)
        execution?.signal?.addEventListener?.('abort', () => queue.cancel(node.id, seq), { once: true })
        let outcome = await promise
        const escalated = await escalate({ node, def, args, execution, outcome, requested: sandboxFor(execution?.agent?.session), approval, queue, notify })
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
async function escalate ({ node, def, args, execution, outcome, requested, approval, queue, notify }) {
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
  const nodeMax = NODE_MAX[node.access] ?? 'full'
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
  if (!approval || typeof approval.request !== 'function') {
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `узел ${node.name} (${node.id}): отказ песочницы (${report.signature ?? 'нет доступа'}), `
        + 'спросить человека негде: команда не выполнена.',
      results: outcome.results,
    }
  }

  const target = ladder[0]
  let verdict = 'rejected'
  try {
    verdict = await approval.request({
      agent: execution?.agent,
      toolName: execution?.name ?? 'nodes_call',
      callId: execution?.callId,
      reason: escalationReason({ node, args, report, current, target }),
      signal: execution?.signal,
    })
  } catch {
    verdict = 'unavailable'
  }
  // словарь службы апрувов ядра: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'.
  // 'approved' не приходит никогда — на этом я и попался: человек нажал
  // «разрешить», пришло 'allowed-once', а я счёл это отказом.
  if (verdict !== 'allowed-once') {
    return {
      status: 'error',
      code: 'sandbox_denied',
      message: `человек отказал в повышении прав: узел ${node.name} (${node.id}) остаётся в режиме ${current}. `
        + 'Команда не выполнена, повторять её не надо.' + (verdict === 'rejected' ? '' : ` (${verdict})`),
      results: outcome.results,
    }
  }

  const retry = queue.enqueue({
    nodeId: node.id,
    api: def.id,
    method: args.method,
    args: args.data ?? {},
    timeout: args.timeout ?? node.default_timeout ?? undefined,
    sandbox: { ...(requested ?? {}), mode: target === 'ro' ? 'read-only' : target === 'rw' ? 'workspace-write' : 'danger-full-access', approved: true },
    session: sessionId(execution),
  })
  if (retry.seq === null) return null
  notify?.(node.id)
  return retry.promise
}

/**
 * Человеческий текст запроса апрува.
 *
 * В диалоге видно только `reason`, поэтому в него надо уложить всё, по чему
 * человек принимает решение: кто отказал, что именно просят выполнить, чем
 * текущий режим отличается от запрашиваемого и на что действует разрешение.
 */

function renderNodes ({ nodes }) {
  if (!nodes.length) return 'узлов нет'
  return nodes.map((node) => {
    const fresh = node.online ? 'online' : node.lastSeen ? `offline ${ago(node.lastSeen)}` : 'никогда не выходил на связь'
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
