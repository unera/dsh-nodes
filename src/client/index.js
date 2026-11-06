/**
 * Клиентская половина dsh-nodes: одна секция в настройках DSH.
 *
 * Серверная часть отдаёт админку по `/api/dsh-nodes/admin` за owner-гейтом,
 * поэтому здесь не нужно ни страницы, ни токена: секция просто показывает ту же
 * страницу в iframe. Тот же origin — значит кука владельца применится сама.
 *
 * Сборка: scripts/build-client.mjs (esbuild + обёртка `__ModuleLoader__`).
 */
import { h } from 'react'

const SETTINGS_ID = 'dsh-nodes'
const ADMIN_URL = '/api/dsh-nodes/admin'

function NodesSection () {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', height: '100%' } }, [
    h('div', { key: 'links', style: { display: 'flex', gap: '12px', alignItems: 'center', fontSize: '13px', opacity: 0.8 } }, [
      h('span', { key: 'hint' }, 'Узлы dsh-nodes: подключённые машины и заявки на подключение'),
      h('a', { key: 'open', href: ADMIN_URL, target: '_blank', rel: 'noreferrer', style: { color: 'inherit' } }, 'открыть отдельно'),
    ]),
    h('iframe', {
      key: 'frame',
      src: ADMIN_URL,
      title: 'dsh-nodes',
      style: { flex: '1 1 auto', width: '100%', minHeight: '520px', border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', background: 'transparent' },
    }),
  ])
}

/** Точка входа клиентского плагина. */
export function apply (ctx) {
  const slots = ctx?.slots
  if (!slots?.register) return
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: SETTINGS_ID, order: 35, label: () => 'Узлы' },
    NodesSection,
  ))
}
