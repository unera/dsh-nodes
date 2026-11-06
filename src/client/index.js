/**
 * Клиентская половина dsh-nodes: секция «Узлы» в настройках DSH.
 *
 * Панель нативная, как у остальных наших плагинов: React-компонент внутри слота
 * `settings.section`, данные — с `/api/dsh-nodes/*` (owner-гейт ядра, кука
 * владельца уходит сама, токенов в браузере нет). Никаких iframe: они дают
 * вторую полосу прокрутки, чужую тему и лишний слой.
 *
 * Сборка: scripts/build-client.mjs.
 */
import { createElement as h, useEffect, useState } from 'react'

const BASE = '/api/dsh-nodes'

async function request (path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    ...options,
  })
  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(parsed?.message ?? `${response.status}`)
  return parsed
}

const op = (payload) => request('/admin', { method: 'POST', body: JSON.stringify(payload) })

const STYLE_ID = 'dsh-nodes-styles'
const CSS = `
.dshn { display: flex; flex-direction: column; gap: 18px; font-size: 14px; }
.dshn h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; font-weight: 600; }
.dshn table { width: 100%; border-collapse: collapse; }
.dshn th, .dshn td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
.dshn th { font-size: 12px; opacity: .6; font-weight: 600; }
.dshn code { font: 12px ui-monospace, SFMono-Regular, monospace; }
.dshn button { font: inherit; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
.dshn button:hover { border-color: currentColor; }
.dshn button.primary { border-color: #3b82f6; color: #3b82f6; }
.dshn button.danger { border-color: #ef4444; color: #ef4444; }
.dshn input { font: inherit; padding: 4px 7px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
.dshn .off { opacity: .6; }
.dshn .msg { min-height: 18px; font-size: 13px; }
.dshn .msg.bad { color: #ef4444; }
.dshn .msg.good { color: #16a34a; }
.dshn .secret { font: 12px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59e0b; border-radius: 8px; margin-top: 8px; }
.dshn .empty { opacity: .6; padding: 8px 0; }
`

function mountStyles () {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => element.remove()
}

function ago (ms) {
  if (!ms) return 'никогда'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}с`
  if (s < 3600) return `${Math.round(s / 60)}м`
  if (s < 86400) return `${Math.round(s / 3600)}ч`
  return `${Math.round(s / 86400)}д`
}

/** Одна строка устройства: алиасы правятся здесь же. */
function NodeRow ({ node, busy, onAliases, onToken, onDelete }) {
  const [aliases, setAliases] = useState(node.aliases.join(', '))
  const signature = node.aliases.join(',')
  useEffect(() => { setAliases(node.aliases.join(', ')) }, [signature])

  return h('tr', null, [
    h('td', { key: 'id' }, h('code', null, node.id)),
    h('td', { key: 'name' }, [
      h('div', { key: 'n' }, node.name),
      h('div', { key: 'a', className: 'row', style: { marginTop: 4 } }, [
        h('input', {
          key: 'i',
          value: aliases,
          placeholder: 'алиасы через запятую',
          style: { width: 220 },
          onChange: (event) => setAliases(event.target.value),
        }),
        h('button', {
          key: 'b',
          disabled: busy,
          onClick: () => onAliases(node.id, aliases.split(',').map((v) => v.trim()).filter(Boolean)),
        }, 'сохранить'),
      ]),
    ]),
    h('td', { key: 'state' }, [
      h('span', { key: 'p', className: `pill ${node.online ? 'on' : 'off'}` }, node.online ? 'online' : 'offline'),
      h('span', { key: 't', className: 'muted' }, node.online ? '' : ` ${ago(node.lastSeen)}`),
      node.queued ? h('div', { key: 'q', className: 'muted', style: { fontSize: 12 } }, `в очереди ${node.queued}`) : null,
    ]),
    h('td', { key: 'apis' },
      node.apis.length
        ? node.apis.map((api) => h('code', { key: api.id, style: { marginRight: 8 } }, `${api.name}${api.version ? ' @' + api.version : ''}`))
        : h('span', { className: 'muted' }, '—')),
    h('td', { key: 'access' }, [
      h('div', { key: 'a' }, node.access),
      node.clientVersion ? h('div', { key: 'v', className: 'muted', style: { fontSize: 12 } }, node.clientVersion) : null,
    ]),
    h('td', { key: 'actions' }, h('div', { className: 'row' }, [
      h('button', { key: 't', disabled: busy, onClick: () => onToken(node.id) }, 'токен'),
      h('button', { key: 'd', className: 'danger', disabled: busy, onClick: () => onDelete(node.id) }, 'удалить'),
    ])),
  ])
}

/** Секция целиком. */
function NodesPanel () {
  const [nodes, setNodes] = useState([])
  const [pending, setPending] = useState([])
  const [epoch, setEpoch] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', kind: '' })
  const [secret, setSecret] = useState(null)
  const [link, setLink] = useState(null)
  const [ttl, setTtl] = useState(600)
  const [newName, setNewName] = useState('')

  const say = (text, kind = '') => setMessage({ text, kind })

  async function load () {
    try {
      const [list, waiting] = await Promise.all([request('/nodes'), request('/pending')])
      setNodes(list.nodes ?? [])
      setEpoch(list.epoch ?? null)
      setPending(waiting.pending ?? [])
    } catch (error) {
      say(error.message, 'bad')
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  async function run (payload, okText) {
    setBusy(true)
    try {
      const result = await op(payload)
      say(okText, 'good')
      if (result?.token) setSecret(result.token)
      if (result?.rejected?.length) say(`заняты другими узлами: ${result.rejected.join(', ')}`, 'bad')
      await load()
    } catch (error) {
      say(error.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return h('div', { className: 'dshn' }, [
    h('div', { key: 'msg', className: `msg ${message.kind}` },
      message.text || (epoch != null ? `epoch ${epoch}, устройств ${nodes.length}` : '')),
    secret ? h('div', { key: 'secret', className: 'secret' }, `токен (показывается один раз): ${secret}`) : null,

    h('section', { key: 'pair' }, [
      h('h3', { key: 'h' }, 'Подключить клиента'),
      h('div', { key: 'r', className: 'row' }, [
        h('input', { key: 'ttl', type: 'number', value: ttl, style: { width: 90 }, onChange: (e) => setTtl(Number(e.target.value) || 600) }),
        h('button', {
          key: 'b',
          className: 'primary',
          disabled: busy,
          onClick: async () => {
            try {
              const result = await op({ op: 'pair', body: { ttlSeconds: ttl } })
              setLink(result.url)
              say('ссылка готова', 'good')
            } catch (error) { say(error.message, 'bad') }
          },
        }, 'сгенерировать ссылку'),
        h('span', { key: 't', className: 'muted' }, 'секунды жизни ссылки'),
      ]),
      link ? h('div', { key: 'l', className: 'secret' }, link) : null,
      h('div', { key: 'hint', className: 'muted', style: { fontSize: 12, marginTop: 6 } },
        'На узле: dshnc connect <ссылка>. Подтверждать здесь ничего не нужно, код одноразовый.'),
    ]),

    h('section', { key: 'pending' }, [
      h('h3', { key: 'h' }, `Заявки без кода (${pending.length})`),
      pending.length === 0
        ? h('div', { key: 'e', className: 'empty' }, 'нет')
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'n' }, 'имя'), h('th', { key: 'i' }, 'id'), h('th', { key: 'a' }, 'адрес'),
            h('th', { key: 'w' }, 'висит'), h('th', { key: 'x' }, ''),
          ])),
          h('tbody', { key: 'body' }, pending.map((row) => h('tr', { key: row.uuid }, [
            h('td', { key: 'n' }, row.name),
            h('td', { key: 'i' }, h('code', null, row.short)),
            h('td', { key: 'a' }, row.ip ?? '—'),
            h('td', { key: 'w' }, `${row.waiting} с`),
            h('td', { key: 'x' }, h('div', { className: 'row' }, [
              h('button', { key: 'y', className: 'primary', disabled: busy, onClick: () => run({ op: 'approve', id: row.uuid }, 'допущен') }, 'допустить'),
              h('button', { key: 'r', className: 'danger', disabled: busy, onClick: () => run({ op: 'reject', id: row.uuid }, 'отклонён') }, 'отклонить'),
            ])),
          ]))),
        ]),
    ]),

    h('section', { key: 'nodes' }, [
      h('h3', { key: 'h' }, `Устройства (${nodes.length})`),
      nodes.length === 0
        ? h('div', { key: 'e', className: 'empty' }, 'нет')
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'i' }, 'id'), h('th', { key: 'n' }, 'имя / алиасы'), h('th', { key: 's' }, 'состояние'),
            h('th', { key: 'a' }, 'API'), h('th', { key: 'd' }, 'доступ'), h('th', { key: 'x' }, ''),
          ])),
          h('tbody', { key: 'body' }, nodes.map((node) => h(NodeRow, {
            key: node.id,
            node,
            busy,
            onAliases: (id, aliases) => run({ op: 'update', id, body: { aliases } }, 'алиасы сохранены'),
            onToken: (id) => run({ op: 'token', id }, 'токен перевыпущен'),
            onDelete: (id) => {
              if (typeof window !== 'undefined' && !window.confirm(`удалить узел ${id}?`)) return
              run({ op: 'delete', id }, 'удалён')
            },
          }))),
        ]),
    ]),

    h('section', { key: 'create' }, [
      h('h3', { key: 'h' }, 'Новый узел вручную'),
      h('div', { key: 'r', className: 'row' }, [
        h('input', { key: 'i', value: newName, placeholder: 'имя, например nbw', style: { width: 220 }, onChange: (e) => setNewName(e.target.value) }),
        h('button', {
          key: 'b',
          disabled: busy || !newName.trim(),
          onClick: () => { run({ op: 'create', body: { name: newName.trim() } }, 'узел создан'); setNewName('') },
        }, 'создать и выдать токен'),
      ]),
    ]),
  ])
}

/** Имя клиентского плагина: по нему host пишет диагностику. */
export const name = 'dsh-nodes'
/** Сервисы, без которых панель не смонтировать. */
export const inject = ['slots']

/**
 * Точка входа клиентского плагина.
 *
 * Всё в try/catch: ошибка в панели не должна ронять загрузку всего клиента —
 * host показывает «Failed to load plugins» и человек теряет весь интерфейс.
 * Поэтому падаем мягко, но громко в консоль.
 */
export function apply (ctx) {
  try {
    const disposeStyles = mountStyles()
    if (typeof ctx?.effect === 'function') ctx.effect(() => disposeStyles)

    const slots = ctx?.slots
    if (!slots?.register) {
      console.warn('[dsh-nodes] слоты недоступны: панель не смонтирована')
      return
    }
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'dsh-nodes', order: 35, label: () => 'Узлы' },
      NodesPanel,
    ))
  } catch (error) {
    console.warn('[dsh-nodes] клиентская половина не смонтировалась:', error)
  }
}
