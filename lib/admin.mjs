/**
 * Админка одной страницей.
 *
 * Никакой сборки и никаких зависимостей: HTML + немного inline JS, который
 * дёргает уже существующие админ-маршруты. Токен вводится в поле и лежит в
 * localStorage — сознательный уход от owner-гейта `/api` (план §9), потому что
 * узлы заводят и с чужой машины.
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
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 960px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--dim); font-size: 13px; }
  td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  code { font: 13px ui-monospace, monospace; }
  button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: transparent; cursor: pointer; }
  button:hover { border-color: currentColor; }
  button.primary { border-color: #3b82f6; color: #3b82f6; }
  button.danger { border-color: #ef4444; color: #ef4444; }
  input { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); background: transparent; width: 100%; box-sizing: border-box; }
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
</style>
</head>
<body>
<h1>dsh-nodes</h1>
<div class="muted" id="epoch">—</div>

<h2>Админ-токен</h2>
<div class="row">
  <input id="token" type="password" placeholder="вставь admin token" autocomplete="off">
  <button class="primary" id="save">запомнить</button>
</div>
<div class="muted" style="margin-top:6px;font-size:13px">
  Лежит в <code>~/.dsh/storages/dsh-nodes-admin.token</code>, если не задан в конфиге.
</div>

<h2>Заявки</h2>
<div id="pending" class="empty">нет</div>

<h2>Узлы</h2>
<div id="nodes" class="empty">нет</div>

<h2>Новый узел</h2>
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
  if (!ms) return '—'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.round(s / 60) + 'm'
  if (s < 86400) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}
let token = localStorage.getItem('dsh-nodes-admin') || ''
$('token').value = token
$('save').onclick = () => { token = $('token').value.trim(); localStorage.setItem('dsh-nodes-admin', token); say('токен сохранён', 'good'); load() }

async function api (path, options = {}) {
  const response = await fetch('.'.concat(path), {
    ...options,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.message || ('HTTP ' + response.status))
  return body
}

function showSecret (label, value) {
  const box = document.createElement('div')
  box.className = 'secret'
  box.textContent = label + ': ' + value
  $('msg').appendChild(box)
}

async function load () {
  if (!token) { $('pending').textContent = 'нужен админ-токен'; $('nodes').textContent = 'нужен админ-токен'; return }
  try {
    const [pending, nodes] = await Promise.all([api('/v1/admin/pending'), api('/v1/admin/nodes')])
    $('epoch').textContent = 'epoch ' + nodes.epoch + ', узлов ' + nodes.nodes.length

    const p = $('pending')
    p.className = pending.pending.length ? '' : 'empty'
    p.innerHTML = pending.pending.length ? table(
      ['имя', 'id', 'адрес', 'висит', ''],
      pending.pending.map((row) => [
        esc(row.name), '<code>' + esc(row.short) + '</code>', esc(row.ip || '—'), row.waiting + ' с',
        '<button class="primary" data-approve="' + esc(row.uuid) + '">допустить</button> ' +
        '<button class="danger" data-reject="' + esc(row.uuid) + '">отклонить</button>',
      ])
    ) : 'нет'

    const n = $('nodes')
    n.className = nodes.nodes.length ? '' : 'empty'
    n.innerHTML = nodes.nodes.length ? table(
      ['id', 'имя / алиасы', 'состояние', 'apis', 'доступ', ''],
      nodes.nodes.map((node) => [
        '<code>' + node.id + '</code>',
        esc(node.aliases.join(', ') || node.name),
        '<span class="pill ' + (node.online ? 'on' : 'off') + '">' + (node.online ? 'online' : 'offline') + '</span> <span class="muted">' + ago(node.lastSeen) + '</span>' +
          (node.queued ? ' <span class="muted">· в очереди ' + node.queued + '</span>' : ''),
        node.apis.length ? node.apis.map((id) => '<code>' + id + '</code>').join(' ') : '—',
        esc(node.access),
        '<button data-token="' + node.id + '">токен</button> <button class="danger" data-del="' + node.id + '">удалить</button>',
      ])
    ) : 'нет'

    p.querySelectorAll('[data-approve]').forEach((el) => { el.onclick = () => act('/v1/admin/pending/' + el.dataset.approve + '/approve', 'POST', {}, 'допущен') })
    p.querySelectorAll('[data-reject]').forEach((el) => { el.onclick = () => act('/v1/admin/pending/' + el.dataset.reject + '/reject', 'POST', {}, 'отклонён') })
    n.querySelectorAll('[data-token]').forEach((el) => { el.onclick = async () => { const r = await api('/v1/admin/nodes/' + el.dataset.token + '/token', { method: 'POST' }); say(''); showSecret('новый токен (показывается один раз)', r.token) } })
    n.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => { if (confirm('удалить узел ' + el.dataset.del + '?')) act('/v1/admin/nodes/' + el.dataset.del, 'DELETE', null, 'удалён') } })
  } catch (error) {
    say(error.message, 'bad')
  }
}

function table (head, rows) {
  return '<table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((cells) => '<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>'
}

async function act (path, method, body, okText) {
  try {
    const result = await api(path, { method, body: body ? JSON.stringify(body) : undefined })
    say(okText, 'good')
    if (result.token) showSecret('токен (показывается один раз)', result.token)
    load()
  } catch (error) {
    say(error.message, 'bad')
  }
}

$('create').onclick = () => {
  const name = $('newname').value.trim()
  if (!name) { say('нужно имя', 'bad'); return }
  act('/v1/admin/nodes', 'POST', { name }, 'узел создан')
  $('newname').value = ''
}

load()
setInterval(() => { if (token) load() }, 5000)
</script>
</body>
</html>
`

/**
 * Отдать страницу админки.
 * @param {import('node:http').ServerResponse} res
 */
export function serveAdmin (res) {
  const body = Buffer.from(PAGE)
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}
