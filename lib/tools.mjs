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
export function createTools ({ store, queue, notify, config, epoch, sandboxFor }) {
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
        const { seq, promise } = queue.enqueue({
          nodeId: node.id,
          api: def.id,
          method: args.method,
          args: args.data ?? {},
          timeout: args.timeout ?? node.default_timeout ?? undefined,
          sandbox: sandboxFor(execution?.agent?.session),
        })
        if (seq === null) return promise
        notify?.(node.id)
        execution?.signal?.addEventListener?.('abort', () => queue.cancel(node.id, seq), { once: true })
        const outcome = await promise
        return { node: node.id, api: def.id, method: args.method, ...outcome }
      },
    },
  ]
}

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
  if (value.status === 'ok') {
    const text = (value.results ?? []).map((block) => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
    return `${head}\n${text}`
  }
  return `${head}: ${value.message ?? ''}`
}

function ago (ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
