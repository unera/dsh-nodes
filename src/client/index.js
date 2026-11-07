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

import { NS, en, ru, zh } from './i18n.js'

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
.dshn .badge { font-size: 11px; padding: 1px 6px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); cursor: help; }
/* режимы цветом: ro — красный, rw — синий, full — зелёный */
.dshn .badge.ro { color: #ef4444; border-color: #ef444488; }
.dshn .badge.rw { color: #3b82f6; border-color: #3b82f688; }
.dshn .badge.fa { color: #16a34a; border-color: #16a34a88; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); margin-left: 6px; white-space: nowrap; }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
/* связь была больше минуты назад — уже не зелёный */
.dshn .stale { color: #3b82f6; border-color: #3b82f688; }
/* больше пяти минут — серый */
.dshn .cold { color: #6b7280; border-color: #6b728088; }
/* offline — красный */
.dshn .off { color: #ef4444; border-color: #ef444488; }
.dshn .tabs { display: flex; gap: 6px; margin: 10px 0; border-bottom: 1px solid rgba(128,128,128,.25); }
.dshn .tab { font: inherit; font-size: 13px; padding: 6px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; color: inherit; opacity: .65; cursor: pointer; }
.dshn .tab.active { opacity: 1; border-bottom-color: currentColor; }
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

/**
 * Состояние узла для плашки.
 *
 * «online» означает «присоединён» (держится сокет или есть свежий контакт), а
 * цвет показывает, насколько связь свежая: минута — уже не зелёный, пять —
 * серый, отсутствие связи — красный.
 */
/** Как режим DSH называется человеку. */
/** Как режим называется человеку: короткое имя и объяснение из словаря. */
const MODE_SHORT = {
  'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'FA',
  ro: 'ro', rw: 'rw', full: 'FA',
}

const MODE_KEY = {
  'read-only': 'mode.ro', 'workspace-write': 'mode.rw', 'danger-full-access': 'mode.fa',
  ro: 'mode.ro', rw: 'mode.rw', full: 'mode.fa',
}

/** Плашка режима: `base` — с чего команда стартует, `upto` — докуда поднимается. */
function modeBadge (label, mode, kind) {
  if (!mode) return null
  const text = MODE_SHORT[mode] ?? mode
  const tone = { ro: 'ro', rw: 'rw', full: 'fa', 'read-only': 'ro', 'workspace-write': 'rw', 'danger-full-access': 'fa' }[mode] ?? null
  const explain = t(MODE_KEY[mode] ?? String(mode))
  const hint = kind === 'base' ? t('mode.baseHint', { explain }) : t('mode.uptoHint', { explain })
  return h('span', { key: label, className: `badge ${tone ?? ''}`, title: hint }, `${label}:${text}`)
}

/** Значок того, кто отвечает на вопрос о расширении прав. */
function approverBadge (approver) {
  const view = {
    server: { glyph: '🌐', key: 'approver.web' },
    local: { glyph: '💻', key: 'approver.local' },
    none: { glyph: '∅', key: 'approver.none' },
  }[approver]
  if (!view) return null
  return h('span', { key: 'approver', className: 'badge', title: t(view.key) }, view.glyph)
}

function pillState (node) {
  if (!pillOnline(node)) return 'off'
  const age = node.lastSeen ? Date.now() - node.lastSeen : Infinity
  if (age < 60_000) return 'on'
  if (age < 300_000) return 'stale'
  return 'cold'
}

/**
 * Присоединён ли узел прямо сейчас.
 *
 * Если сервер умеет присутствие (поле `attached` есть), «online» означает
 * именно открытый сокет: остановленный клиент перестаёт быть online сразу, а не
 * через минуту. Поле `attached` может отсутствовать у старого сервера — тогда
 * остаётся прежнее правило по времени последней связи.
 */
function pillOnline (node) {
  if (typeof node.attached === 'boolean') return node.attached
  return Boolean(node.online)
}

function ago (ms) {
  if (!ms) return t('pill.never')
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
      h('span', { key: 'n', className: 'muted' }, t('nodes.edit')),
    ]),
    h('div', { key: 'name' }, [
      h('label', { key: 'l' }, t('nodes.title')),
      h('input', {
        key: 'i',
        value: name,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter') submit() },
      }),
    ]),
    h('div', { key: 'aliases' }, [
      h('label', { key: 'l' }, t('nodes.aliasesPlaceholder')),
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
      h('button', { key: 'save', className: 'primary', disabled: busy || !name.trim(), onClick: submit }, t('nodes.save')),
      h('button', { key: 'cancel', disabled: busy, onClick: onCancel }, t('nodes.cancel')),
    ]),
  ])
}

function NodeRow ({ node, busy, onEdit, onRevoke, onDelete }) {
  return h('tr', null, [
    h('td', { key: 'id' }, h('code', null, node.id)),
    h('td', { key: 'name' }, [
      h('div', { key: 'n' }, [
        h('span', { key: 'name' }, node.name),
        h('span', {
          key: 'pill',
          // цвет плашки говорит о свежести связи: зелёный — только что, синий —
          // больше минуты, серый — больше пяти, красный — связи нет вовсе
          className: `pill ${pillState(node)}`,
          title: node.lastSeen ? t('pill.lastSeen', { ago: ago(node.lastSeen) }) : t('pill.noContact'),
        }, pillOnline(node) ? t('pill.online') : t('pill.offline')),
      ]),
      h('div', { key: 'a', className: 'aliases' }, node.aliases.filter((alias) => alias !== node.name).join(', ') || t('nodes.noAliases')),
      // аптайм отдельной строкой под именем: видно, работает ли узел с ночи или
      // только что перезапустился
      node.online && uptimeText(node.uptimeSeconds)
        ? h('div', { key: 'u', className: 'muted', style: { fontSize: 12, marginTop: 2 } }, t('pill.working', { uptime: uptimeText(node.uptimeSeconds) }))
        : null,
    ]),
    h('td', { key: 'apis' }, h('div', { className: 'chips' },
      node.apis.length
        ? node.apis.map((api) => h('span', { key: api.id, className: 'chip' }, `${api.name}${api.version ? `@${api.version}` : ''}`))
        : h('span', { className: 'muted' }, '—'))),
    h('td', { key: 'access' }, [
      h('div', { key: 'modes', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, [
        modeBadge('base', node.base, 'base'),
        modeBadge('upto', node.access, 'upto'),
        approverBadge(node.approver),
      ]),
      node.clientVersion ? h('div', { key: 'v', className: 'muted', style: { fontSize: 12 } }, node.clientVersion) : null,
    ]),
    h('td', { key: 'actions' }, h('div', { className: 'actions' }, [
      h(GlyphButton, { key: 'e', kind: 'edit', title: t('nodes.editTitle'), disabled: busy, onClick: () => onEdit(node.id) }),
      h(GlyphButton, { key: 't', kind: 'unplug', title: t('nodes.revoke'), disabled: busy, onClick: () => onRevoke(node.id) }),
      h(GlyphButton, { key: 'd', kind: 'trash', title: t('nodes.delete'), disabled: busy, className: 'danger', onClick: () => onDelete(node.id) }),
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
  const [settings, setSettings] = useState(null)
  const [tab, setTab] = useState('connections')
  /** Секция видна только на своей вкладке. */
  const only = (name) => ({ display: tab === name ? 'block' : 'none' })
  const tabButton = (id, label) => h('button', {
    key: id,
    className: tab === id ? 'tab active' : 'tab',
    disabled: busy,
    onClick: () => setTab(id),
  }, label)
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
      try {
        setSettings(await request('/settings'))
      } catch {
        setSettings(null)
      }
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
      message.text || (epoch != null ? t('summary.epoch', { epoch, count: nodes.length }) : '')),
    // Панель разбита на вкладки: подключения — то, с чего начинают, аудит —
    // то, куда смотрят редко, настройки — то, что меняют один раз.
    h('div', { key: 'tabs', className: 'tabs' }, [
      tabButton('connections', t('tab.connections')),
      tabButton('audit', t('tab.audit')),
      tabButton('settings', t('tab.settings')),
    ]),
    secret ? h('div', { key: 'secret', className: 'secret' }, `токен (показывается один раз): ${secret}`) : null,

    h('section', { key: 'pair', style: only('connections') }, [
      h('h3', { key: 'h' }, t('pair.title')),
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
              say(t('pair.ready'), 'good')
            } catch (error) { say(error.message, 'bad') }
          },
        }, t('pair.make')),
        h('span', { key: 't', className: 'muted' }, t('pair.ttl')),
      ]),
      link ? h('div', { key: 'l', className: 'secret' }, link) : null,
      h('div', { key: 'hint', className: 'muted', style: { fontSize: 12, marginTop: 6 } },
        t('pair.note')),
    ]),

    h('section', { key: 'pending', style: only('connections') }, [
      h('h3', { key: 'h' }, `Заявки без кода (${pending.length})`),
      pending.length === 0
        ? h('div', { key: 'e', className: 'empty' }, t('nodes.none'))
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'n' }, t('nodes.name')), h('th', { key: 'i' }, 'id'), h('th', { key: 'a' }, t('pending.title')),
            h('th', { key: 'w' }, t('state.hung')), h('th', { key: 'x' }, ''),
          ])),
          h('tbody', { key: 'body' }, pending.map((row) => h('tr', { key: row.uuid }, [
            h('td', { key: 'n' }, row.name),
            h('td', { key: 'i' }, h('code', null, row.short)),
            h('td', { key: 'a' }, row.ip ?? '—'),
            h('td', { key: 'w' }, `${row.waiting} с`),
            h('td', { key: 'x' }, h('div', { className: 'row' }, [
              h('button', { key: 'y', className: 'primary', disabled: busy, onClick: () => run({ op: 'approve', id: row.uuid }, t('pending.allowed')) }, t('pending.allow')),
              h('button', { key: 'r', className: 'danger', disabled: busy, onClick: () => run({ op: 'reject', id: row.uuid }, t('pending.denied')) }, t('pending.deny')),
            ])),
          ]))),
        ]),
    ]),

    h('section', { key: 'nodes', style: only('connections') }, [
      h('h3', { key: 'h' }, `Устройства (${nodes.length})`),
      nodes.length === 0
        ? h('div', { key: 'e', className: 'empty' }, t('nodes.none'))
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'i' }, 'id'), h('th', { key: 'n' }, t('nodes.name')),
            h('th', { key: 'a' }, 'API'), h('th', { key: 'd' }, t('nodes.access')), h('th', { key: 'x' }, ''),
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
              run({ op: 'token', id }, t('nodes.tokenReissued'))
            },
              onDelete: (id) => {
                if (typeof window !== 'undefined' && !window.confirm(`Удалить узел ${id}?`)) return
                if (editing === id) setEditing(null)
                run({ op: 'delete', id }, t('nodes.deleted'))
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
                  const result = await run({ op: 'update', id, body }, t('nodes.saved'))
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

    h('section', { key: 'audit', style: only('audit') }, [
      h('h3', { key: 'h' }, t('audit.title')),
      audit.length === 0
        ? h('div', { key: 'e', className: 'empty' }, t('audit.empty'))
        : h('table', { key: 't' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'w' }, t('audit.when')), h('th', { key: 'k' }, t('audit.what')),
            h('th', { key: 'n' }, t('audit.node')), h('th', { key: 'm' }, t('audit.mode')), h('th', { key: 'c' }, t('audit.command')),
          ])),
          h('tbody', { key: 'body' }, audit.map((row) => h('tr', { key: row.id }, [
            h('td', { key: 'w', className: 'muted' }, new Date(row.at).toLocaleTimeString()),
            h('td', { key: 'k' }, row.kind === 'denied'
              ? h('span', { style: { color: '#ef4444' } }, t('audit.denied'))
              : row.kind === 'approve'
                ? `${row.outcome === 'approved' ? t('audit.approved') : t('audit.rejected')}`
                : t('audit.exec')),
            h('td', { key: 'n' }, row.nodeName
              ? [row.nodeName, h('span', { key: 'id', className: 'muted' }, ` #${row.node}`)]
              : '—'),
            h('td', { key: 'm' }, h('code', null, row.mode ?? '—')),
            h('td', { key: 'c' }, h('code', null, String(row.command ?? '').slice(0, 120))),
          ]))),
        ]),
    ]),

    h('section', { key: 'create', style: only('connections') }, [
      h('h3', { key: 'h' }, t('nodes.new')),
      h('div', { key: 'r', className: 'row' }, [
        h('input', { key: 'i', value: newName, placeholder: t('nodes.namePlaceholder'), style: { width: 220 }, onChange: (e) => setNewName(e.target.value) }),
        h('button', {
          key: 'b',
          disabled: busy || !newName.trim(),
          onClick: () => { run({ op: 'create', body: { name: newName.trim() } }, t('nodes.created')); setNewName('') },
        }, t('nodes.create')),
      ]),
    ]),

    h('section', { key: 'settings', style: only('settings') }, [
      h('h3', { key: 'h' }, t('tab.settings')),
      h('div', { key: 'note', className: 'muted' },
        t('settings.note')),
      settings
        ? h('table', { key: 't' }, [
          h('tbody', { key: 'b' }, [
            row(t('settings.self'),
              (settings.selfRoots ?? []).length ? settings.selfRoots.join(', ') : t('settings.selfOff')),
            row(t('settings.wait'), t('common.waitForever', { value: settings.approvalWaitSeconds })),
            row(t('settings.ttl'), t('common.seconds', { value: settings.approvalTtlSeconds })),
            row(t('settings.alive'), t('common.seconds', { value: settings.aliveTimeoutSeconds })),
            row(t('settings.ping'), settings.wsPingSeconds ? t('common.seconds', { value: settings.wsPingSeconds }) : t('settings.off')),
          ]),
        ])
        : h('div', { className: 'muted' }, t('settings.failed')),
      h('div', { key: 'selfnote', className: 'muted', style: { marginTop: 8 } },
        t('settings.selfNote')),
    ]),
  ])
}

/** Точка входа клиентского плагина. */
export const name = 'dsh-nodes'
// `locale` объявлен в inject: без этого cordis бросает при обращении
// к ctx.locale, словари не регистрируются, и в интерфейсе видны ключи
export const inject = ['slots', 'locale']

/**
 * Перевод панели. До `apply` работает свой словарь: разметка остаётся
 * работоспособной, даже если `ctx.locale` почему-то не смонтировался.
 */
let translate = (key, vars) => {
  // запасной вариант — русский словарь: лучше знакомый язык, чем ключ на экране
  const text = String(ru[key] ?? en[key] ?? key)
  if (vars) return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
  return text
}

const t = (key, vars) => translate(key, vars)

/**
 * Регистрирует словари в `ctx.locale` и привязывает `t` к текущему языку.
 *
 * Свой словарь остаётся запасным: если сервиса локали нет, панель говорит
 * по-русски, а не показывает ключи.
 */
function mountLocale (ctx) {
  const locale = ctx?.locale
  if (typeof locale?.register !== 'function' || typeof locale?.bind !== 'function') {
    console.warn('[dsh-nodes] локаль недоступна: строки берутся из своего словаря')
    return
  }
  const install = () => {
    try {
      locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })
    } catch (error) {
      // язык уже объявлен другим плагином — это норма, остальное показываем
      if (!/already/i.test(String(error?.message ?? error))) {
        console.warn('[dsh-nodes] язык ru не объявлен:', error)
      }
    }
    try {
      locale.register(NS, { en, ru, zh })
    } catch (error) {
      console.warn('[dsh-nodes] словари не зарегистрированы:', error)
    }
  }
  try {
    if (typeof ctx?.effect === 'function') ctx.effect(install, 'dsh-nodes: dictionaries')
    else install()
  } catch (error) {
    console.warn('[dsh-nodes] словари не зарегистрированы:', error)
  }
  try {
    translate = locale.bind(NS)
  } catch (error) {
    console.warn('[dsh-nodes] перевод не привязан:', error)
  }
}

export function apply (ctx) {
  try {
    const disposeStyles = mountStyles()
    if (typeof ctx?.effect === 'function') ctx.effect(() => disposeStyles)

    mountLocale(ctx)

    const slots = ctx?.slots
    if (!slots?.register) {
      console.warn('[dsh-nodes] слоты недоступны: панель не смонтирована')
      return
    }
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'dsh-nodes', order: 35, locale: NS, label: () => t('nodes.title') },
      NodesPanel,
    ))
  } catch (error) {
    console.warn('[dsh-nodes] клиентская половина не смонтировалась:', error)
  }
}
