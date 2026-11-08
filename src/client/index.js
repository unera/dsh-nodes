/**
 * Клиентская половина dsh-nodes: секция «Узлы» в настройках DSH.
 *
 * Панель нативная, как у остальных наших плагинов: React-компонент внутри слота
 * `settings.sectiont('confirm.separator')/api/dsh-nodes/*` (owner-гейт ядра, кука
 * владельца уходит сама, токенов в браузере нет).
 *
 * Сборка: scripts/build-client.mjs.
 */
import { createElement as h, useEffect, useState } from 'react'
import * as React from 'react'

// `Component` нужен для ловушки ошибок; в тестовой заглушке react его нет,
// а `class extends undefined` падает ещё до рендера — поэтому запасной вариант
const Base = React.Component ?? Object

import qrcode from 'qrcode-generator'

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
.dshn { display: flex; flex-direction: column; gap: 16px; font-size: 14px; color: #f3f4f6; }
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
.dshn button.copy.done { color: #22c55e; }
.dshn button.copy.fail { color: #ef4444; }
.dshn button.glyph:hover { background: rgba(128,128,128,.15); border-color: rgba(128,128,128,.4); }
.dshn input, .dshn textarea { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; box-sizing: border-box; width: 100%; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .pair { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; margin-top: 10px; }
.dshn .pair .pane:first-child { flex: 1 1 55%; }
.dshn .pair .pane.qr { flex: 0 0 40%; max-width: 40%; }
.dshn .token { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 13px; }
.dshn .linkcode { font: 12px ui-monospace, monospace; color: #7dd3fc; word-break: break-all; }
.dshn .help { margin-top: 12px; font-size: 12px; opacity: .45; }
.dshn .cmd { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.dshn .help .cmd code { margin: 0; }
.dshn .help code { font-size: 13px; opacity: 1; }
.dshn .qrbox { display: inline-flex; padding: 6px; background: #fff; border-radius: 8px; cursor: pointer; }
.dshn .left { margin-top: 8px; text-align: center; font-size: 12px; }
.dshn .pair .pane { flex: 1 1 240px; min-width: 200px; }
.dshn .pair .pane.qr { display: flex; flex-direction: column; align-items: center; }
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
  if (total < 60) return `${total}s`
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Состояние узла для плашки.
 *
 * «online» означает «присоединён» (держится сокет или есть свежий контакт), а
 * цвет показывает, насколько связь свежая: минута — уже не зелёный, пять —
 * серый, отсутствие связи — красный.
 */
/** Как режим DSH называется человеку. */
/** Токен показываем начало…конец: целиком он нужен только по кнопке. */
function shortToken (token) {
  if (!token || token.length < 14) return token
  return `${token.slice(0, 3)}…${token.slice(-3)}`
}

/** Копирование в буфер с коротким сообщением о результате. */
async function copyToClipboard (text, okText) {
  try {
    await navigator.clipboard.writeText(text)
    return okText
  } catch {
    return null
  }
}

/** Кнопка «скопировать» со значком и подсказкой. */
function copyButton (text, full) {
  return h('button', {
    key: 'c' + full.slice(0, 8),
    className: 'glyph copy',
    title: 'Копировать',
    'aria-label': 'Копировать',
    onClick: async (event) => {
      event?.stopPropagation?.()
      const ok = await copyToClipboard(text, 'ok')
      // всплывашка: подтверждение прямо у кнопки, без общих сообщений панели
      const target = event?.currentTarget
      if (target) {
        target.classList.add(ok ? 'done' : 'fail')
        setTimeout(() => target.classList.remove('done', 'fail'), 1200)
      }
    },
  }, '⧉')
}

/** Строка таблицы «что — как»: подпись и значение. */
/** QR-код ссылки: на телефоне её удобнее навести камерой, чем копировать. */
function renderQr (text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  const cells = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) cells.push(h('rect', { key: `${row}-${col}`, x: col, y: row, width: 1, height: 1 }))
    }
  }
  return h('svg', {
    key: 'svg',
    viewBox: `0 0 ${size} ${size}`,
    width: 180,
    height: 180,
    shapeRendering: 'crispEdges',
    style: { background: '#fff', borderRadius: 8 },
  }, cells)
}

function row (what, value) {
  return h('tr', { key: what }, [
    h('td', { key: 'w', className: 'muted' }, what),
    h('td', { key: 'v' }, h('code', null, String(value))),
  ])
}

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
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
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
  const [token, setToken] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [now, setNow] = useState(Date.now())

  // обратный отсчёт перерисовываем раз в секунду, пока ссылка жива
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const [link, setLink] = useState(null)
  const [ttl, setTtl] = useState(600)
  const [newName, setNewName] = useState('')
  const [audit, setAudit] = useState([])
  const [settings, setSettings] = useState(null)
  const [tab, setTab] = useState('connections')
  const [catalog, setCatalog] = useState([])
  const [expanded, setExpanded] = useState(null)
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
      try {
        const list = await request('/catalog')
        setCatalog(list.apis ?? [])
      } catch {
        setCatalog([])
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
      if (result?.url) {
        setSecret(result.url)
        setExpiresAt(result.expiresAt ?? null)
      }
      if (result?.token) setToken(result.token)
      if (result?.rejected?.length) say(t('err.aliasesTaken', { list: result.rejected.join(', ') }), 'bad')
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
      tabButton('api', t('tab.api')),
      tabButton('audit', t('tab.audit')),
      tabButton('settings', t('tab.settings')),
    ]),

    h('section', { key: 'pair', style: only('connections') }, [
      h('h3', { key: 'h' }, t('pair.title')),
      h('div', { key: 'cols', className: 'pair' }, [
        // левый столбец: всё, что делает человек
        h('div', { key: 'l', className: 'pane' }, [
          token
            ? h('div', { key: 'tk', className: 'token' }, [
              h('span', { key: 'v' }, `${t('pair.token')}: ${shortToken(token)}`),
              copyButton(token, token),
            ])
            : null,
          h('div', { key: 'row', className: 'row' }, [
            h('span', { key: 'lbl' }, t('pair.makeFor')),
            h('input', { key: 'ttl', type: 'number', value: ttl, style: { width: 90 }, onChange: (e) => setTtl(Number(e.target.value) || 600) }),
            h('span', { key: 'sec' }, t('pair.seconds')),
            h('button', {
              key: 'b',
              className: 'primary',
              disabled: busy,
              onClick: async () => { await run({ op: 'pair', body: { ttlSeconds: ttl } }, '') },
            }, t('pair.make')),
          ]),
          secret
            ? h('div', { key: 'l2', className: 'row', style: { marginTop: 8 } }, [
              h('span', { key: 'n' }, `${t('pair.link')}:`),
              // саму ссылку не печатаем: слово-ссылка даёт браузерное
              // контекстное меню «копировать адрес» рядом с нашей кнопкой
              h('a', { key: 'a', href: secret, className: 'linkcode' }, t('pair.linkReady')),
              copyButton(secret, 'link'),
            ])
            : null,
          h('div', { key: 'help', className: 'help' }, [
            h('div', { key: 'p1' }, t('pair.help1')),
            h('span', { key: 'cmd', className: 'cmd' }, [
              h('code', { key: 'c1' }, 'dshnc connect <ссылка>'),
              copyButton(`dshnc connect ${secret ?? ''}`.trim(), 'cmd'),
            ]),
            h('div', { key: 'p2', className: 'muted' }, t('pair.help2')),
          ]),
        ]),
        // правый столбец: QR, клик по нему тоже копирует ссылку
        h('div', { key: 'r', className: 'pane qr' }, secret
          ? [
            h('div', {
              key: 'q',
              className: 'qrbox',
              title: t('pair.copy'),
              onClick: () => copyToClipboard(secret, t('pair.copied')),
            }, renderQr(secret)),
            expiresAt
              ? h('div', { key: 'left', className: 'left', },
                t('pair.left', { seconds: Math.max(0, Math.round((expiresAt - now) / 1000)) }))
              : null,
          ]
          : null),
      ]),
    ]),

    h('section', { key: 'nodes', style: only('connections') }, [
      h('h3', { key: 'h' }, `${t('nodes.title')} (${nodes.length})`),
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
              if (typeof window !== 'undefined' && !window.confirm(t('confirm.revoke', { id }))) return
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
                    setEditorError(t('err.nameTaken', { name: body.name, id: taken.id, owner: taken.name }))
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

    h('section', { key: 'api', style: only('api') }, [
      h('h3', { key: 'h' }, t('api.title')),
      catalog.length === 0
        ? h('div', { key: 'e', className: 'empty' }, t('api.empty'))
        : h('table', { key: 't' }, [
          h('thead', { key: 'h' }, h('tr', null, [
            h('th', { key: 'n' }, t('api.name')),
            h('th', { key: 'v' }, t('api.version')),
            h('th', { key: 'c' }, t('api.nodes')),
          ])),
          h('tbody', { key: 'b' }, catalog.flatMap((api) => {
            const open = expanded === api.id
            const rows = [h('tr', {
              key: 'r' + api.id,
              style: { cursor: 'pointer' },
              onClick: () => setExpanded(open ? null : api.id),
            }, [
              h('td', { key: 'n' }, h('code', null, api.name)),
              h('td', { key: 'v' }, String(api.version)),
              h('td', { key: 'c' }, api.nodes.map((node) => node.name).join(', ') || '—'),
            ])]
            if (!open) return rows
            rows.push(h('tr', { key: 'd' + api.id }, h('td', { colSpan: 3 }, [
              h('div', { key: 'd', className: 'muted' }, api.description ?? ''),
              h('ul', { key: 'm' }, api.methods.map((method) =>
                h('li', { key: method.method }, [
                  h('code', { key: 'c' }, method.method),
                  method.description ? h('span', { key: 's', className: 'muted' }, ' — ' + method.description) : null,
                  method.args ? h('div', { key: 'a', className: 'muted' }, Object.keys(method.args).join(', ')) : null,
                ]))),
              h('div', { key: 'who', className: 'muted' },
                t('api.exporters') + api.nodes.map((node) => `${node.name}${node.online ? ' ●' : ''}`).join(', ')),
            ])))
            return rows
          })),
        ]),
    ]),

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
            row(t('settings.selfSession'), t('settings.selfAlways')),
            row(t('settings.selfExtra'),
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
 * Ловушка ошибок рендера.
 *
 * Без неё любое исключение внутри панели размонтирует всё поддерево, и человек
 * видит «была панель и исчезла» — без единого слова о причине. С ней вместо
 * пустоты показывается текст ошибки, который можно переслать.
 */
class Boundary extends Base {
  constructor (props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  componentDidCatch (error) {
    try {
      console.error('[dsh-nodes] панель упала:', error)
    } catch {}
  }

  render () {
    if (this.state.error) {
      return h('div', { className: 'msg bad' }, `панель dsh-nodes упала: ${this.state.error?.message ?? this.state.error}`)
    }
    return this.props.children
  }
}

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
 * Регистрирует словари в `ctx.localet('confirm.binds')t` к текущему языку.
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
      // панель завёрнута в ловушку: ошибка рендера покажет текст, а не пустоту
      () => h(Boundary, null, h(NodesPanel, null)),
    ))
  } catch (error) {
    console.warn('[dsh-nodes] клиентская половина не смонтировалась:', error)
  }
}
