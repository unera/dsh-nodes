/**
 * dsh-nodes — сервер плагина: узлы объявляют API, модель зовёт их команды.
 *
 * Тонкая обёртка: вся логика в lib/. Здесь только конфиг, хранение, монтирование
 * маршрутов на webServer и тулы модели.
 *
 * @module @dr-co/dsh-nodes
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

// CommonJS-зависимость тянем синхронно: `apply` обязан быть синхронным
const require = createRequire(import.meta.url)

import { Store, newToken } from './lib/db.mjs'
import { Queue } from './lib/queue.mjs'
import { createNodesServer } from './lib/server.mjs'
import { ArgsError, checkArgs } from './lib/args.mjs'
import { createPresence } from './lib/ws.mjs'
import { renderAdmin } from './lib/admin.mjs'
import { handleAdmin, handleAdminOp } from './lib/admin-api.mjs'
import { PROMPT_TEXT, SECTION_NAME, SECTION_ORDER } from './lib/prompt.mjs'
import { createTools } from './lib/tools.mjs'

export const name = 'dsh-nodes'
// cordis: `inject` — это карта «имя сервиса → конфиг». К `ctx.<service>` можно
// обращаться только если сервис в ней объявлен, иначе
// `Error: cannot get property "connection" without inject` и плагин не поднимется.
export const inject = { systemPrompt: null, tools: null, webServer: null, connection: null }

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


/**
 * Плагин.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply (ctx, config) {
  // Сначала — маршруты админки, и строго до первого await: cordis привязывает
  // регистрацию к текущему волокну, а после await оно уже не то, и маршруты
  // молча не появляются (панель получает 404). Сервис `connection` приходит
  // позже плагина, поэтому ждём его явно.
  console.log('[dsh-nodes] apply: старт, typeof ctx.inject =', typeof ctx?.inject, ', typeof ctx.effect =', typeof ctx?.effect)
  let store = null
  let queue = null
  let presence = null
  mountAdminRoutes({ ctx, config, getDeps: () => ({ store, queue, config, prefix: config.routePrefix, presence }) })

  const dir = resolveDataDir(config)
  mkdirSync(dir, { recursive: true })
  store = new Store(join(dir, 'dsh-nodes.sqlite'))
  const epoch = store.bumpEpoch()
  queue = new Queue({
    epoch,
    defaultTimeout: config.defaultTimeout,
    maxBatch: config.maxBatch,
    maxQueue: config.maxQueuePerNode,
    commandTtl: config.commandTtl,
  })
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
  try {
    // `ws` — CommonJS, и берём его синхронно: `apply` не должен быть async,
    // иначе cordis уводит выполнение в чужое волокно и регистрации не видно.
    const { WebSocketServer } = require('ws')
    presence = createPresence({ WebSocketServer, prefix: config.routePrefix, store, queue, log })
  } catch (error) {
    log('warn', `WebSocket недоступен (${error.message}); присутствие только по HTTP`)
  }

  const server = createNodesServer({ store, queue, config, log, presence })

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
      if (!policy?.mode) {
        // не смогли узнать режим — работаем по самому узкому, а не без песочницы:
        // «неизвестно» не должно означать «полный доступ»
        console.warn('[dsh-nodes] sandboxPolicy без режима: считаю read-only')
        return { mode: 'read-only' }
      }
      console.log('[dsh-nodes] sandboxPolicy:', policy.mode, 'root:', policy.workspaceRoot ?? '-')
      return { mode: policy.mode, ...(policy.workspaceRoot ? { root: policy.workspaceRoot } : {}) }
    } catch (error) {
      console.warn(`[dsh-nodes] sandboxPolicy не разрешился (${error.message}): считаю read-only`)
      return { mode: 'read-only' }
    }
  }

  const tools = createTools({
    store,
    queue,
    notify: (nodeId) => presence?.notify(nodeId),
    config,
    epoch,
    sandboxFor,
    // `ctx.approval` напрямую нельзя: сервис не объявлен в inject, cordis
    // бросит «cannot get property "approval" without inject». Через get — можно,
    // и в хосте без апрувов плагин остаётся живым.
    approval: typeof ctx.get === 'function' ? ctx.get('approval') : null,
  })

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







/**
 * Зарегистрировать owner-гейтовые маршруты админки.
 *
 * Сервис `connection` лежит прямо на контексте плагина — так его берёт dsh-im
 * (`ctx.connection.fetch.register`), и регистрация идёт синхронно в activate.
 * Регистрация внутри `effect` до дела не доходит: маршрутов не появляется, а
 * панель получает 404.
 */
function mountAdminRoutes ({ ctx, config, getDeps }) {
  const mount = (connection) => {
    if (connection === null || typeof connection?.fetch?.register !== 'function') {
      console.warn('[dsh-nodes] connection без fetch.register(): админка не отдаётся')
      return
    }
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    const depsOf = (request) => {
      const deps = getDeps()
      if (!deps.store) return null
      const origin = deps.config.publicUrl?.replace(/\/$/, '') ??
        `${request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host')}`
      return { ...deps, origin }
    }

    const routes = [
      {
        path: '/api/dsh-nodes/admin',
        methods: ['GET'],
        run: async () => new Response(renderAdmin(), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        }),
        raw: true,
      },
      { path: '/api/dsh-nodes/nodes', methods: ['GET'], run: (deps) => handleAdmin(deps, 'GET', '/nodes', {}) },
      { path: '/api/dsh-nodes/catalog', methods: ['GET'], run: (deps) => handleAdmin(deps, 'GET', '/catalog', {}) },
      { path: '/api/dsh-nodes/pending', methods: ['GET'], run: (deps) => handleAdmin(deps, 'GET', '/pending', {}) },
      { path: '/api/dsh-nodes/op', methods: ['POST'], run: (deps, body) => handleAdminOp(deps, body) },
    ]

    let count = 0
    for (const route of routes) {
      try {
        connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const deps = depsOf(request)
              if (!deps) return json(503, { code: 'starting', message: 'плагин ещё поднимается' })
              if (route.raw) return route.run(request)
              const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
              const result = await route.run(deps, body)
              return json(result.status, result.body)
            } catch (error) {
              return json(500, { code: 'internal', message: String(error?.message ?? error) })
            }
          },
        })
        count += 1
      } catch (error) {
        console.warn(`[dsh-nodes] маршрут ${route.path} ${route.methods.join('/')} не встал: ${error?.message ?? error}`)
      }
    }
    console.log(`[dsh-nodes] админ-маршрутов зарегистрировано: ${count}`)
  }

  const direct = ctx?.connection ?? null
  if (direct && typeof direct?.fetch?.register === 'function') {
    mount(direct)
    return
  }

  console.warn('[dsh-nodes] ctx.connection нет, ждём сервис через inject')
  if (typeof ctx?.inject !== 'function') return
  ctx.inject(['connection'], (connCtx) => {
    mount(connCtx?.connection ?? connCtx?.get?.('connection') ?? null)
  })
}

