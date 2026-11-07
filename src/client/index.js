/**
 * Клиентская половина dsh-nodes: секция «Узлы» в настройках DSH.
 *
 * Панель нативная, как у остальных наших плагинов: React-компонент внутри слота
 * `settings.section`, данные — с `/api/dsh-nodes/*` (owner-гейт ядра, кука
 * владельца уходит сама, токенов в браузере нет).
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
  const type = response.headers.get('content-type') ?? ''
  let parsed = null
  if (text && type.includes('json')) {
    parsed = JSON.parse(text)
  } else if (text) {
    throw new Error(`${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  if (!response.ok) throw new Error(parsed?.message ?? `${response.status}`)
  return parsed
}

const op = (payload) => request('/op', { method: 'POST', body: JSON.stringify(payload) })

const STYLE_ID = 'dsh-nodes-styles'
const CSS = `
.dshn { display: flex; flex-direction: column; gap: 16px; font-size: 14px; }
.dshn h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; font-weight: 600; }
.dshn table { width: 100%; border-collapse: collapse; }
.dshn th, .dshn td { text-align: left; padding: 7px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
.dshn th { font-size: 12px; opacity: .6; font-weight: 600; }
.dshn code { font: 12px ui-monospace, SFMono-Regular, monospace; }
.dshn button { font: inherit; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
.dshn button:hover { border-color: currentColor; }
.dshn button.primary { border-color: #3b82f6; color: #3b82f6; }
.dshn button.danger { color: #ef4444; }
.dshn button.glyph { padding: 4px 6px; display: inline-flex; align-items: center; justify-content: center; border-color: transparent; }
.dshn button.glyph:hover { background: rgba(128,128,128,.15); border-color: rgba(128,128,128,.4); }
.dshn input, .dshn textarea { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; box-sizing: border-box; width: 100%; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); margin-left: 6px; white-space: nowrap; }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
.dshn .off { color: #ef4444; border-color: #ef444488; }
.dshn .msg { min-height: 18px; font-size: 13px; }
.dshn .msg.bad { color: #ef4444; }
.dshn .msg.good { color: #16a34a; }
.dshn .secret { font: 12px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59e0b; border-radius: 8px; margin-top: 8px; }
.dshn .empty { opacity: .6; padding: 8px 0; }
.dshn .aliases { font-size: 12px; opacity: .6; margin-top: 2px; }
.dshn .chips { display: flex; flex-wrap: wrap; gap: 4px; max-width: 240px; }
.dshn .chip { font: 12px ui-monospace, monospace; padding: 1px 6px; border-radius: 4px; background: rgba(128,128,128,.15); white-space: nowrap; }
.dshn .editor { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshn .editor label { font-size: 12px; opacity: .7; display: block; margin-bottom: 4px; }
.dshn .actions { display: flex; gap: 2px; justify-content: flex-end; }
.dshn .tipbox { position: fixed; z-index: 40; padding: 3px 8px; border-radius: 5px; font-size: 12px; white-space: nowrap; background: rgba(28,28,30,.97); color: #fff; border: 1px solid rgba(255,255,255,.18); pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
`

function mountStyles () {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => element.remove()
}

/** Разобрать список алиасов: запятая, точка с запятой и перевод строки равны. */
function splitAliases (value) {
  return String(value ?? '').split(/[,\n;]+/).map((part) => part.trim()).filter(Boolean)
}

/** Аптайм узла: 3h 12m, 5m, 40s. */
function uptimeText (seconds) {
  if (seconds == null) return null
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}с`
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${minutes}м`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours}ч ${rest}м` : `${hours}ч`
  return `${Math.floor(hours / 24)}д ${hours % 24}ч`
}

function ago (ms) {
  if (!ms) return 'никогда'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}с`
  if (s < 3600) return `${Math.round(s / 60)}м`
  if (s < 86400) return `${Math.round(s / 3600)}ч`
  return `${Math.round(s / 86400)}д`
}

/** Глифы свои, без внешних библиотек. */
function Glyph ({ kind }) {
  const paths = {
    edit: 'M4 20h4l10-10-4-4L4 16v4zm12.7-12.7 1.6-1.6a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.6 1.6 3 3z',
    unplug: 'M8.5 7.5 6 10a4.5 4.5 0 0 0 0 6.4l1.6 1.6M15.5 16.5 18 14a4.5 4.5 0 0 0 0-6.4l-1.6-1.6M9 15l6-6',
    trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z',
  }
  return h('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: kind === 'unplug' ? 'none' : 'currentColor',
    stroke: kind === 'unplug' ? 'currentColor' : 'none',
    strokeWidth: kind === 'unplug' ? 1.8 : 0,
    strokeLinecap: 'round',
    'aria-hidden': 'true',
  }, h('path', { d: paths[kind] }))
}

/**
 * Кнопка-глиф. Подсказку показывает контейнер по делегированным событиям:
 * список перерисовывается каждые 5 секунд, и подсказка, привязанная к самой
 * кнопке, гасла вместе со её пересозданием.
 */
function GlyphButton ({ kind, title, onClick, disabled, className }) {
  return h('button', {
    className: `glyph ${className ?? ''}`,
    // position: fixed у подсказки — потому что панель настроек обрезает всё,
    // что выходит за её границы
    'data-tip': title,
    'aria-label': title,
    disabled: Boolean(disabled),
    onClick,
  }, h(Glyph, { kind }))
}

/** Форма правки узла: имя и алиасы. Открывается над списком. */
function NodeEditor ({ node, busy, error, onSave, onCancel }) {
  const outside = () => node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase())
  const [name, setName] = useState(node.name)
  const [aliases, setAliases] = useState(outside().join(', '))

  useEffect(() => {
    setName(node.name)
    setAliases(node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase()).join(', '))
  }, [node.id, node.name, node.aliases.join(',')])

  const submit = () => onSave(node.id, { name: name.trim(), aliases: splitAliases(aliases) })

  return h('div', { className: 'editor' }, [
    h('div', { key: 'title', className: 'row' }, [
      h('strong', { key: 't' }, `Узел ${node.id}`),
      h('span', { key: 'n', className: 'muted' }, 'правка имени и алиасов'),
    ]),
    h('div', { key: 'name' }, [
      h('label', { key: 'l' }, 'Имя узла'),
      h('input', {
        key: 'i',
        value: name,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter') submit() },
      }),
    ]),
    h('div', { key: 'aliases' }, [
      h('label', { key: 'l' }, 'Алиасы через запятую (по любому из них узел можно позвать)'),
      h('textarea', {
        key: 't',
        rows: 2,
        value: aliases,
        onChange: (event) => setAliases(event.target.value),
      }),
    ]),
    error
      ? h('div', { key: 'error', className: 'msg bad', style: { minHeight: 0 } }, error)
      : null,
    h('div', { key: 'actions', className: 'row' }, [
      h('button', { key: 'save', className: 'primary', disabled: busy || !name.trim(), onClick: submit }, 'сохранить'),
      h('button', { key: 'cancel', disabled: busy, onClick: onCancel }, 'отмена'),
    ]),
  ])
}

function NodeRow ({ node, busy, onEdit, onRevoke, onDelete }) {
  return h('tr', null, [
    h('td', { key: 'id' }, h('code', null, node.id)),
    h('td', { key: 'name' }, [
      h('div', { key: 'n' }, [
        h('span', { key: 'name' }, node.name),
        h('span', { key: 'pill', className: `pill ${node.online ? 'on' : 'off'}` }, node.online ? 'online' : `offline · ${ago(node.lastSeen)}`),
      ]),
      h('div', { key: 'a', className: 'aliases' }, node.aliases.filter((alias) => alias !== node.name).join(', ') || 'без алиасов'),
      // аптайм отдельной строкой под именем: видно, работает ли узел с ночи или
      // только что перезапустился
      node.online && uptimeText(node.uptimeSeconds)
        ? h('div', { key: 'u', className: 'muted', style: { fontSize: 12, marginTop: 2 } }, `работает ${uptimeText(node.uptimeSeconds)}`)
        : null,
    ]),
    h('td', { key: 'apis' }, h('div', { className: 'chips' },
      node.apis.length
        ? node.apis.map((api) => h('span', { key: api.id, className: 'chip' }, `${api.name}${api.version ? `@${api.version}` : ''}`))
        : h('span', { className: 'muted' }, '—'))),
    h('td', { key: 'access' }, [
      h('div', { key: 'a' }, node.access),
      node.clientVersion ? h('div', { key: 'v', className: 'muted', style: { fontSize: 12 } }, node.clientVersion) : null,
    ]),
    h('td', { key: 'actions' }, h('div', { className: 'actions' }, [
      h(GlyphButton, { key: 'e', kind: 'edit', title: 'Редактировать', disabled: busy, onClick: () => onEdit(node.id) }),
      h(GlyphButton, { key: 't', kind: 'unplug', title: 'Отозвать токен', disabled: busy, onClick: () => onRevoke(node.id) }),
      h(GlyphButton, { key: 'd', kind: 'trash', title: 'Удалить', disabled: busy, className: 'danger', onClick: () => onDelete(node.id) }),
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
  const [audit, setAudit] = useState([])
  // одна открытая форма на всю панель: открытие другой закрывает прежнюю
  const [editing, setEditing] = useState(null)
  const [tip, setTip] = useState(null)
  const [editorError, setEditorError] = useState('')

  const say = (text, kind = '') => setMessage({ text, kind })

  async function load () {
    try {
      const [list, waiting, events] = await Promise.all([
        request('/nodes'),
        request('/pending'),
        request('/audit?limit=50').catch(() => ({ audit: [] })),
      ])
      setNodes(list.nodes ?? [])
      setEpoch(list.epoch ?? null)
      setPending(waiting.pending ?? [])
      setAudit(events.audit ?? [])
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
      return { ok: true }
    } catch (error) {
      say(error.message, 'bad')
      return { ok: false, error: error.message }
    } finally {
      setBusy(false)
    }
  }


  // Делегированные подсказки: наведение и фокус внутри панели, без состояния
  // на каждой кнопке — перерисовка списка их не сбрасывает.
  const showTipFor = (event) => {
    const target = event.target?.closest?.('button[data-tip]')
    if (!target) return
    const rect = target.getBoundingClientRect()
    setTip({ text: target.getAttribute('data-tip'), x: rect.left + rect.width / 2, y: rect.bottom + 6 })
  }
  const hideTipIfLeft = (event) => {
    const target = event.target?.closest?.('button[data-tip]')
    if (!target) return
    if (event.relatedTarget && target.contains(event.relatedTarget)) return
    setTip(null)
  }

  return h('div', {
    className: 'dshn',
    onMouseOver: showTipFor,
    onMouseOut: hideTipIfLeft,
    onFocusIn: (event) => {
      const target = event.target?.closest?.('button[data-tip]')
      if (!target) return
      const rect = target.getBoundingClientRect()
      setTip({ text: target.getAttribute('data-tip'), x: rect.left + rect.width / 2, y: rect.bottom + 6 })
    },
    onFocusOut: () => setTip(null),
    onScroll: () => setTip(null),
  }, [
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
            h('th', { key: 'i' }, 'id'), h('th', { key: 'n' }, 'имя / алиасы'),
            h('th', { key: 'a' }, 'API'), h('th', { key: 'd' }, 'доступ'), h('th', { key: 'x' }, ''),
          ])),
          h('tbody', { key: 'body' }, nodes.flatMap((node) => {
            const row = h(NodeRow, {
              key: `row-${node.id}`,
              node,
              busy,
              onEdit: (id) => {
              setEditorError('')
              setEditing((current) => (current === id ? null : id))
            },
            onRevoke: (id) => {
              if (typeof window !== 'undefined' && !window.confirm(`Отозвать токен узла ${id}? Текущий перестанет работать сразу.`)) return
              setSecret(null)
              run({ op: 'token', id }, 'токен перевыпущен')
            },
              onDelete: (id) => {
                if (typeof window !== 'undefined' && !window.confirm(`Удалить узел ${id}?`)) return
                if (editing === id) setEditing(null)
                run({ op: 'delete', id }, 'удалён')
              },
            })
            // форма живёт прямо над своей строкой: не нужно листать к верху панели
            if (editing !== node.id) return [row]
            return [
              h('tr', { key: `editor-${node.id}` }, h('td', { colSpan: 5, style: { padding: '4px 8px 12px' } }, h(NodeEditor, {
                node,
                busy,
                error: editorError,
                onCancel: () => { setEditorError(''); setEditing(null) },
                onSave: async (id, body) => {
                  // имя, занятое другим узлом, ловим до запроса: сервер ответил бы
                  // тем же, но человеку нужен ответ сразу и рядом с кнопкой
                  const taken = nodes.find((other) => other.id !== id &&
                    other.aliases.some((alias) => alias.toLowerCase() === String(body.name).toLowerCase()))
                  if (taken) {
                    setEditorError(`Имя «${body.name}» уже занято узлом ${taken.id} (${taken.name})`)
                    return
                  }
                  const result = await run({ op: 'update', id, body }, 'сохранено')
                  if (result.ok) { setEditorError(''); setEditing(null) }
                  else setEditorError(result.error)
                },
              }))),
              row,
            ]
          })),
        ]),
    ]),

    tip
      ? h('div', {
        key: 'tip',
        className: 'tipbox',
        style: { left: `${Math.round(tip.x)}px`, top: `${Math.round(tip.y)}px`, transform: 'translateX(-50%)' },
      }, tip.text)
      : null,

    h('section', { key: 'audit' }, [
      h('h3', { key: 'h' }, 'Аудит (последние события)'),
      audit.length === 0
        ? h('div', { key: 'e', className: 'empty' }, 'пока пусто')
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'w' }, 'когда'), h('th', { key: 'k' }, 'что'),
            h('th', { key: 'n' }, 'узел'), h('th', { key: 'm' }, 'режим'), h('th', { key: 'c' }, 'команда'),
          ])),
          h('tbody', { key: 'body' }, audit.map((row) => h('tr', { key: row.id }, [
            h('td', { key: 'w', className: 'muted' }, new Date(row.at).toLocaleTimeString()),
            h('td', { key: 'k' }, row.kind === 'denied'
              ? h('span', { style: { color: '#ef4444' } }, 'отказ')
              : row.kind === 'approve'
                ? `${row.outcome === 'approved' ? 'разрешил' : 'запретил'}`
                : 'исполнено'),
            h('td', { key: 'n' }, row.nodeName
              ? [row.nodeName, h('span', { key: 'id', className: 'muted' }, ` #${row.node}`)]
              : '—'),
            h('td', { key: 'm' }, h('code', null, row.mode ?? '—')),
            h('td', { key: 'c' }, h('code', null, String(row.command ?? '').slice(0, 120))),
          ]))),
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

/** Точка входа клиентского плагина. */
export const name = 'dsh-nodes'
export const inject = ['slots']

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
