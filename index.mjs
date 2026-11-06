/**
 * dsh-nodes — сервер плагина: узлы объявляют API, модель зовёт их команды.
 *
 * Тонкая обёртка: вся логика в lib/. Здесь только конфиг, хранение, монтирование
 * маршрутов на webServer и тулы модели.
 *
 * @module @dr-co/dsh-nodes
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

import { Store, newToken } from './lib/db.mjs'
import { Queue } from './lib/queue.mjs'
import { createNodesServer } from './lib/server.mjs'
import { ArgsError, checkArgs } from './lib/args.mjs'
import { createPresence } from './lib/ws.mjs'
import { renderAdmin } from './lib/admin.mjs'
import { PROMPT_TEXT, SECTION_NAME, SECTION_ORDER } from './lib/prompt.mjs'

export const name = 'dsh-nodes'
export const inject = ['tools', 'webServer']

/** Конфиг плагина (план §10). */
export const Config = z.object({
  routePrefix: z.string().default('/dsh-nodes').description('Базовый путь API'),
  dataDir: z.string().description('Каталог состояния; по умолчанию $DSH_HOME/storages'),
  adminToken: z.string().description('Админ-токен; если пусто — генерируется в admin.token'),
  defaultTimeout: z.natural().default(60).description('Таймаут команды в секундах, если у узла нет своего'),
  commandTtl: z.natural().default(300).description('Сколько секунд невыданная команда ещё живёт'),
  maxBatch: z.natural().default(5).description('Сколько команд отдаётся за один запрос'),
  maxQueuePerNode: z.natural().default(100).description('Потолок незакрытых команд на узел'),
  maxBodyBytes: z.natural().default(1048576).description('Потолок тела запроса'),
  aliveTimeoutSeconds: z.natural().default(60).description('Сколько без обращений считать узел живым'),
  maxPendingEnroll: z.natural().default(50).description('Потолок списка заявок на регистрацию'),
  adminTokenFile: z.string().description('Где лежит сгенерированный админ-токен'),
})

/** Где живёт состояние, если каталог не задан явно. */
function resolveDataDir (config) {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
  return config.dataDir ?? join(home, 'storages')
}

/** Админ-токен: из конфига, иначе из файла, иначе новый в файл с 0600. */
function resolveAdminToken (config, dir) {
  if (config.adminToken) return config.adminToken
  const file = config.adminTokenFile ?? join(dir, 'dsh-nodes-admin.token')
  if (existsSync(file)) {
    const value = readFileSync(file, 'utf8').trim()
    if (value) return value
  }
  const token = newToken()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, token + '\n', { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {}
  return token
}

/**
 * Плагин.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export async function apply (ctx, config) {
  const dir = resolveDataDir(config)
  mkdirSync(dir, { recursive: true })
  const store = new Store(join(dir, 'dsh-nodes.sqlite'))
  const epoch = store.bumpEpoch()
  const queue = new Queue({
    epoch,
    defaultTimeout: config.defaultTimeout,
    maxBatch: config.maxBatch,
    maxQueue: config.maxQueuePerNode,
    commandTtl: config.commandTtl,
  })
  const adminToken = resolveAdminToken(config, dir)
  const log = (level, message, extra) => {
    const logger = ctx.logger?.[level] ?? ctx.logger?.info
    if (typeof logger === 'function') logger.call(ctx.logger, `[dsh-nodes] ${message}`, extra ?? '')
  }
  log('info', `состояние: ${join(dir, 'dsh-nodes.sqlite')}, epoch ${epoch}`)

  // Присутствие по WebSocket. Пакет `ws` нужен только серверу; без него
  // плагин работает, но узлы считаются живыми по последнему HTTP-обращению.
  let presence = null
  try {
    const { WebSocketServer } = await import('ws')
    presence = createPresence({ WebSocketServer, prefix: config.routePrefix, store, queue, log })
  } catch (error) {
    log('warn', `WebSocket недоступен (${error.message}); присутствие только по HTTP`)
  }

  const server = createNodesServer({ store, queue, config, log, adminToken, presence })

  const disposers = []
  const register = (route) => {
    const dispose = ctx.webServer.register(route)
    disposers.push(dispose)
  }
  ctx.effect(() => {
    register({ kind: 'prefix', path: config.routePrefix, handler: (req, res) => server.handle(req, res) })
    if (presence) {
      const disposeUpgrade = ctx.webServer.registerUpgrade({ path: presence.path, handler: presence.upgrade })
      disposers.push(disposeUpgrade)
    }
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.()
        } catch {}
      }
    }
  })

  // Та же страница за owner-гейтом ядра: /api/dsh-nodes/admin пускает только
  // владельца DSH, публичный /dsh-nodes/admin — по админ-токену.
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['connection'], (connCtx) => {
        const connection = connCtx?.connection ?? connCtx?.get?.('connection') ?? null
        if (!connection || typeof connection.fetch?.register !== 'function') {
          log('warn', 'connection без fetch.register(): owner-гейтовой копии админки не будет')
          return
        }
        const registerAdmin = () => connection.fetch.register({
          path: '/api/dsh-nodes/admin',
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => new Response(renderAdmin({ apiBase: `${config.routePrefix}/v1/admin` }), {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          }),
        })
        if (typeof connCtx?.effect === 'function') connCtx.effect(() => registerAdmin())
        else disposers.push(registerAdmin())
      })
    } catch (error) {
      log('warn', `owner-гейтовая админка не подключилась: ${error.message}`)
    }
  }

  const sweep = setInterval(() => queue.sweep(), 30_000)
  if (typeof sweep.unref === 'function') sweep.unref()
  ctx.effect(() => () => clearInterval(sweep))
  if (presence) ctx.effect(() => () => presence.close())

  // ── секция системного промпта: как обращаться с узлами ───────────────────
  const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') ?? null : ctx.systemPrompt ?? null
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    try {
      const disposeSection = systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: PROMPT_TEXT })
      if (typeof ctx.effect === 'function') ctx.effect(() => disposeSection)
      else disposers.push(disposeSection)
    } catch (error) {
      log('warn', `секция промпта не зарегистрировалась: ${error.message}`)
    }
  } else {
    log('warn', 'systemPrompt недоступен: модель не получит инструкций про узлы')
  }

  // ── тулы модели (план §5) ────────────────────────────────────────────────
  const sandboxFor = (session) => {
    try {
      const policy = ctx.sandboxPolicy?.resolve?.({ session })
      if (!policy?.mode) return undefined
      return { mode: policy.mode, ...(policy.workspaceRoot ? { root: policy.workspaceRoot } : {}) }
    } catch {
      return undefined
    }
  }

  const tools = [
    {
      name: 'nodes_list',
      description: 'Список узлов: алиасы, онлайн, сколько молчит, какие API держит.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => ({ type: 'text', text: renderNodes(value) }),
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
        render: (_args, value) => ({ type: 'text', text: renderCatalog(value) }),
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
        render: (_args, value) => ({ type: 'text', text: renderApi(value) }),
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
        render: (_args, value) => ({ type: 'text', text: renderCall(value) }),
      },
      async execute (args, execution) {
        const node = typeof args.node === 'number' ? store.node(args.node) : store.nodeByAlias(String(args.node))
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
        presence?.notify(node.id)
        execution?.signal?.addEventListener?.('abort', () => queue.cancel(node.id, seq), { once: true })
        const outcome = await promise
        return { node: node.id, api: def.id, method: args.method, ...outcome }
      },
    },
  ]

  let unregister = []
  for (const tool of tools) {
    try {
      unregister.push(ctx.tools.register(tool))
    } catch (error) {
      log('warn', `не удалось зарегистрировать ${tool.name}: ${error.message}`)
    }
  }
  ctx.effect(() => () => {
    for (const dispose of unregister) {
      try {
        dispose?.()
      } catch {}
    }
    unregister = []
    store.close()
  })
}

// ── рендер для модели ──────────────────────────────────────────────────────

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
