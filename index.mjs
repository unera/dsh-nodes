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
import { createTools } from './lib/tools.mjs'

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
  // cordis: `ctx.logger(name)` — фабрика именованного логгера, не объект с уровнями
  let logger = null
  try {
    logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-nodes') : ctx.logger ?? null
  } catch {
    logger = null
  }
  const log = (level, message, extra) => {
    const write = logger?.[level] ?? logger?.info
    if (typeof write !== 'function') return
    try {
      write.call(logger, extra === undefined ? message : `${message} ${JSON.stringify(extra)}`)
    } catch {}
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

  const tools = createTools({ store, queue, notify: (nodeId) => presence?.notify(nodeId), config, epoch, sandboxFor })

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





