/**
 * The admin panel as a single page.
 *
 * Served only behind the core owner gate (`/api/dsh-nodes/admin`), so there is no
 * token in it: authorization is an ordinary DSH session. All requests go by a
 * relative path `/api/dsh-nodes/*` from the root of the page.
 *
 * @module dsh-nodes/admin
 */

const PAGE = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-nodes</title>
<style>
  :root { color-scheme: light dark; --line: #8883; --dim: #8889; }
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 1000px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--dim); font-size: 13px; }
  code { font: 13px ui-monospace, monospace; }
  button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: transparent; cursor: pointer; }
  button:hover { border-color: currentColor; }
  button.primary { border-color: #3b82f6; color: #3b82f6; }
  button.danger { border-color: #ef4444; color: #ef4444; }
  input { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--line); background: transparent; box-sizing: border-box; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .muted { color: var(--dim); }
  .pill { font-size: 12px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); }
  .on { color: #16a34a; border-color: #16a34a55; }
  .off { color: var(--dim); }
  .empty { color: var(--dim); padding: 12px 0; }
  #msg { min-height: 22px; font-size: 13px; }
  #msg.bad { color: #ef4444; }
  #msg.good { color: #16a34a; }
  .secret { font: 13px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59100; border-radius: 8px; margin: 8px 0; }
  .apis { font-size: 13px; }
</style>
</head>
<body>
<h1>dsh-nodes</h1>
<div class="muted" id="epoch">—</div>

<h2>Подключить клиента</h2>
<div class="row">
  <input id="ttl" type="number" value="600" style="max-width:110px" title="секунды жизни ссылки">
  <button class="primary" id="pair">сгенерировать ссылку</button>
</div>
<div class="muted" style="margin-top:6px;font-size:13px">
  Ссылка одноразовая: на узле <code>dshnc connect &lt;ссылка&gt;</code>, подтверждать здесь ничего не нужно.
</div>
<div id="pairbox"></div>

<h2>Заявки без кода</h2>
<div id="pending" class="empty">нет</div>

<h2>Устройства</h2>
<div id="nodes" class="empty">нет</div>

<h2>Новый узел вручную</h2>
<div class="row">
  <input id="newname" placeholder="имя, например nbw" style="max-width:220px">
  <button id="create">создать и выдать токен</button>
</div>

<div id="msg"></div>

<script>
const $ = (id) => document.getElementById(id)
const say = (text, kind) => { const el = $('msg'); el.textContent = text; el.className = kind || '' }
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ago = (ms) => {
  if (!ms) return 'никогда'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}

async function api (path, options = {}) {
  const response = await fetch('/api/dsh-nodes' + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.message || ('HTTP ' + response.status))
  return body
}

function table (head, rows) {
  return '<table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((cells) => '<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>'
}

function showSecret (label, value) {
  const box = document.createElement('div')
  box.className = 'secret'
  box.textContent = label + ': ' + value
  $('msg').appendChild(box)
}

async function load () {
  try {
    const [nodes, pending] = await Promise.all([api('/nodes'), api('/pending')])
    $('epoch').textContent = 'epoch ' + nodes.epoch + ', устройств ' + nodes.nodes.length

    const p = $('pending')
    p.className = pending.pending.length ? '' : 'empty'
    p.innerHTML = pending.pending.length ? table(
      ['имя', 'id', 'адрес', 'висит', ''],
      pending.pending.map((row) => [
        esc(row.name),
        '<code>' + esc(row.short) + '</code>',
        esc(row.ip || '—'),
        row.waiting + ' с',
        '<button class="primary" data-approve="' + esc(row.uuid) + '">допустить</button> ' +
        '<button class="danger" data-reject="' + esc(row.uuid) + '">отклонить</button>',
      ])
    ) : 'нет'

    const n = $('nodes')
    n.className = nodes.nodes.length ? '' : 'empty'
    n.innerHTML = nodes.nodes.length ? table(
      ['id', 'имя / алиасы', 'состояние', 'API', 'доступ', ''],
      nodes.nodes.map((node) => [
        '<code>' + node.id + '</code>',
        esc(node.name) +
          '<div class="row" style="margin-top:4px">' +
          '<input value="' + esc(node.aliases.join(',')) + '" data-aliases="' + node.id + '" style="max-width:240px" placeholder="алиасы через запятую">' +
          '<button data-save="' + node.id + '">сохранить</button></div>',
        '<span class="pill ' + (node.online ? 'on' : 'off') + '">' + (node.online ? 'online' : 'offline') + '</span> ' +
          '<span class="muted">' + ago(node.lastSeen) + '</span>' +
          (node.queued ? ' <span class="muted">· в очереди ' + node.queued + '</span>' : ''),
        node.apis.length
          ? '<div class="apis">' + node.apis.map((a) => '<code>' + esc(a.name) + (a.version ? ' @' + esc(a.version) : '') + '</code>').join(' ') + '</div>'
          : '—',
        esc(node.access) + (node.clientVersion ? '<div class="muted" style="font-size:12px">' + esc(node.clientVersion) + '</div>' : ''),
        '<button data-token="' + node.id + '">токен</button> <button class="danger" data-del="' + node.id + '">удалить</button>',
      ])
    ) : 'нет'

    p.querySelectorAll('[data-approve]').forEach((el) => { el.onclick = () => op({ op: 'approve', id: el.dataset.approve }, 'допущен') })
    p.querySelectorAll('[data-reject]').forEach((el) => { el.onclick = () => op({ op: 'reject', id: el.dataset.reject }, 'отклонён') })
    n.querySelectorAll('[data-token]').forEach((el) => { el.onclick = () => op({ op: 'token', id: Number(el.dataset.token) }, 'токен перевыпущен') })
    n.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => { if (confirm('удалить узел ' + el.dataset.del + '?')) op({ op: 'delete', id: Number(el.dataset.del) }, 'удалён') } })
    n.querySelectorAll('[data-save]').forEach((el) => {
      el.onclick = () => {
        const input = n.querySelector('[data-aliases="' + el.dataset.save + '"]')
        const aliases = input.value.split(',').map((v) => v.trim()).filter(Boolean)
        op({ op: 'update', id: Number(el.dataset.save), body: { aliases } }, 'алиасы сохранены')
      }
    })
  } catch (error) {
    say(error.message, 'bad')
  }
}

async function op (payload, okText) {
  try {
    const result = await api('/op', { method: 'POST', body: JSON.stringify(payload) })
    say(okText, 'good')
    if (result.token) showSecret('токен (показывается один раз)', result.token)
    if (result.rejected && result.rejected.length) say('заняты другими узлами: ' + result.rejected.join(', '), 'bad')
    load()
  } catch (error) {
    say(error.message, 'bad')
  }
}

$('pair').onclick = async () => {
  const ttl = Number($('ttl').value) || 600
  try {
    const result = await api('/op', { method: 'POST', body: JSON.stringify({ op: 'pair', body: { ttlSeconds: ttl } }) })
    $('pairbox').innerHTML = ''
    const box = document.createElement('div')
    box.className = 'secret'
    box.textContent = result.url
    $('pairbox').appendChild(box)
    const copy = document.createElement('button')
    copy.textContent = 'скопировать'
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(result.url); say('ссылка скопирована', 'good') }
      catch { say('браузер не дал скопировать — выдели вручную', 'bad') }
    }
    $('pairbox').appendChild(copy)
    const hint = document.createElement('div')
    hint.className = 'muted'
    hint.style.fontSize = '13px'
    hint.textContent = 'действует ' + Math.round(ttl / 60) + ' мин, сработает один раз'
    $('pairbox').appendChild(hint)
    say('ссылка готова', 'good')
  } catch (error) {
    say(error.message, 'bad')
  }
}

$('create').onclick = () => {
  const name = $('newname').value.trim()
  if (!name) { say('нужно имя', 'bad'); return }
  op({ op: 'create', body: { name } }, 'узел создан')
  $('newname').value = ''
}

load()
setInterval(load, 5000)
</script>
</body>
</html>
`

/** The admin panel HTML (for the fetch route and tests). */
export function renderAdmin () {
  return PAGE
}
