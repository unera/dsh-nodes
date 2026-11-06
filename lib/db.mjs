/**
 * Состояние сервера dsh-nodes в SQLite.
 *
 * Здесь только диск: узлы, алиасы, токены, справочник API и связи между ними.
 * Состояние жизни процесса (счётчики, очередь, промисы) лежит в queue.mjs и
 * в базу не пишется — его различает epoch (§4.7 плана).
 *
 * @module dsh-nodes/db
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** Схема. Миграции — по PRAGMA user_version, шаг за шагом. */
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE node (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     local           INTEGER NOT NULL DEFAULT 0 CHECK (local IN (0,1)),
     name            TEXT NOT NULL,
     token_sha256    TEXT UNIQUE,
     token_issued_at INTEGER,
     access          TEXT NOT NULL DEFAULT 'none'
                     CHECK (access IN ('read-only','workspace-write','danger-full-access','none')),
     workdir         TEXT,
     default_timeout INTEGER,
     allow_escalation INTEGER NOT NULL DEFAULT 1 CHECK (allow_escalation IN (0,1)),
     proto           INTEGER,
     client_version  TEXT,
     created_at      INTEGER NOT NULL,
     last_seen       INTEGER,
     last_null_at    INTEGER
   )`,
  `CREATE TABLE node_alias (
     alias TEXT PRIMARY KEY COLLATE NOCASE,
     node  INTEGER NOT NULL REFERENCES node(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX node_alias_node ON node_alias(node)`,
  `CREATE TABLE api (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     key        TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL,
     version    TEXT,
     apidef     TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE node_api (
     node INTEGER NOT NULL REFERENCES node(id) ON DELETE CASCADE,
     api  INTEGER NOT NULL REFERENCES api(id)  ON DELETE CASCADE,
     PRIMARY KEY (node, api)
   )`,
  `CREATE INDEX node_api_api ON node_api(api)`,
  `CREATE TABLE enrollment (
     uuid           TEXT PRIMARY KEY,
     name           TEXT NOT NULL,
     client_version TEXT,
     proto          INTEGER,
     ip             TEXT,
     first_seen     INTEGER NOT NULL,
     last_seen      INTEGER NOT NULL,
     status         TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','expired')),
     node           INTEGER REFERENCES node(id) ON DELETE SET NULL,
     handed_at      INTEGER
   )`,
  `CREATE INDEX enrollment_status ON enrollment(status, last_seen)`,
  `CREATE TABLE pairing (
     code_sha256 TEXT PRIMARY KEY,
     created_at  INTEGER NOT NULL,
     expires_at  INTEGER NOT NULL,
     used_at     INTEGER,
     node        INTEGER REFERENCES node(id) ON DELETE SET NULL,
     note        TEXT
   )`,
]

/** SHA-256 в hex — единственная форма, в которой токен попадает на диск. */
export function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Новый токен узла: 32 случайных байта в base64url. */
export function newToken () {
  return randomBytes(32).toString('base64url')
}

/** Сравнение дайджестов без утечки по времени. */
function sameDigest (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Хранилище сервера.
 */
export class Store {
  /** @param {string} file путь к файлу SQLite (':memory:' для тестов) */
  constructor (file) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.#migrate()
  }

  #migrate () {
    const version = this.db.prepare('PRAGMA user_version').get().user_version
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[i])
        this.db.exec(`PRAGMA user_version = ${i + 1}`)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  close () {
    this.db.close()
  }

  /** Служебное значение из meta. */
  getMeta (key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row ? row.value : fallback
  }

  setMeta (key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  /** epoch: увеличивается на каждом старте сервера (план §4.7). */
  bumpEpoch () {
    const next = Number(this.getMeta('epoch', '0')) + 1
    this.setMeta('epoch', next)
    return next
  }

  // ── узлы ────────────────────────────────────────────────────────────────

  /** Узел по токену-предъявителю. */
  nodeByToken (token) {
    const digest = sha256(token)
    for (const row of this.db.prepare('SELECT * FROM node WHERE token_sha256 IS NOT NULL').all()) {
      if (sameDigest(row.token_sha256, digest)) return row
    }
    return null
  }

  /** Узел по номеру. */
  node (id) {
    return this.db.prepare('SELECT * FROM node WHERE id = ?').get(id) ?? null
  }

  /** Узел по любому из алиасов. */
  nodeByAlias (alias) {
    const row = this.db.prepare('SELECT node FROM node_alias WHERE alias = ?').get(alias)
    return row ? this.node(row.node) : null
  }

  /** Узлы для админки и nodes_list. */
  nodes () {
    return this.db.prepare('SELECT * FROM node ORDER BY id').all().map((row) => ({
      ...row,
      aliases: this.aliases(row.id),
      apis: this.nodeApis(row.id),
    }))
  }

  aliases (nodeId) {
    return this.db.prepare('SELECT alias FROM node_alias WHERE node = ? ORDER BY alias').all(nodeId).map((r) => r.alias)
  }

  nodeApis (nodeId) {
    return this.db.prepare('SELECT api FROM node_api WHERE node = ? ORDER BY api').all(nodeId).map((r) => r.api)
  }

  /**
   * Создать узел. Имя сразу становится алиасом: имя, которым нельзя позвать, —
   * ловушка (план §11.3).
   * @returns {{node: object, token: string|null}}
   */
  createNode ({ name, token = null, access = 'none', workdir = null, defaultTimeout = null, allowEscalation = 1, local = 0 }) {
    const plain = token ?? newToken()
    const now = Date.now()
    const info = this.db.prepare(`INSERT INTO node
      (local, name, token_sha256, token_issued_at, access, workdir, default_timeout, allow_escalation, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(local, name, sha256(plain), now, access, workdir, defaultTimeout, allowEscalation ? 1 : 0, now)
    const id = Number(info.lastInsertRowid)
    this.setAlias(id, name)
    return { node: this.node(id), token: plain }
  }

  /**
   * Отозвать токен и вернуть узел в состояние «нужно подтверждение».
   *
   * Просто заменить токен мало: старый клиент получит 401, пойдёт в /v1/enroll,
   * а там заявка уже «handed» — и он будет долбиться вечно. Поэтому заявка
   * открывается заново, и узел появляется в «заявках без кода».
   */
  revokeToken (id) {
    const dead = newToken()
    this.db.prepare('UPDATE node SET token_sha256 = ?, token_issued_at = ? WHERE id = ?').run(sha256(dead), Date.now(), id)
    this.db.prepare("UPDATE enrollment SET status = 'pending', handed_at = NULL, last_seen = ? WHERE node = ?")
      .run(Date.now(), id)
    return true
  }

  /** Перевыпуск токена: старый перестаёт работать сразу. */
  reissueToken (id) {
    const plain = newToken()
    this.db.prepare('UPDATE node SET token_sha256 = ?, token_issued_at = ? WHERE id = ?').run(sha256(plain), Date.now(), id)
    return plain
  }

  /** Алиас узла; уникален без учёта регистра. */
  setAlias (nodeId, alias) {
    this.db.prepare('DELETE FROM node_alias WHERE node = ? AND alias = ? COLLATE NOCASE').run(nodeId, alias)
    this.db.prepare('INSERT INTO node_alias(alias, node) VALUES (?, ?)').run(alias, nodeId)
  }

  removeAlias (nodeId, alias) {
    this.db.prepare('DELETE FROM node_alias WHERE node = ? AND alias = ? COLLATE NOCASE').run(nodeId, alias)
  }

  /** Свободный алиас: nbw, nbw-2, nbw-3… */
  freeAlias (wanted) {
    let alias = wanted
    for (let n = 2; ; n++) {
      const taken = this.db.prepare('SELECT 1 FROM node_alias WHERE alias = ?').get(alias)
      if (!taken) return alias
      alias = `${wanted}-${n}`
    }
  }

  updateNode (id, patch) {
    const fields = ['name', 'access', 'workdir', 'default_timeout', 'allow_escalation']
    const sets = []
    const values = []
    for (const [key, value] of Object.entries(patch)) {
      if (!fields.includes(key)) continue
      sets.push(`${key} = ?`)
      values.push(value)
    }
    if (!sets.length) return
    values.push(id)
    this.db.prepare(`UPDATE node SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteNode (id) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM node WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM api WHERE id NOT IN (SELECT api FROM node_api)').run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  touch (id) {
    this.db.prepare('UPDATE node SET last_seen = ? WHERE id = ?').run(Date.now(), id)
  }

  markNull (id) {
    this.db.prepare('UPDATE node SET last_null_at = ? WHERE id = ?').run(Date.now(), id)
  }

  // ── справочник API ──────────────────────────────────────────────────────

  /**
   * Ключ контракта: sha256(name \0 version) или sha256(name \0 node:<id>) —
   * без версии API принадлежит узлу (план §2.1).
   */
  apiKey (name, version, nodeId) {
    return version ? sha256(`${name}\u0000${version}`) : sha256(`${name}\u0000node:${nodeId}`)
  }

  /**
   * Объявление узла: разность множеств, одна транзакция (план §2.1).
   * @param {number} nodeId
   * @param {Array<{name: string, version?: string, methods: object[]}>} apis
   * @returns {{apis: number[], warnings: string[]}}
   */
  announce (nodeId, apis) {
    const warnings = []
    this.db.exec('BEGIN')
    try {
      const old = new Set(this.nodeApis(nodeId))
      const next = new Set()
      const now = Date.now()
      for (const api of apis) {
        const key = this.apiKey(api.name, api.version ?? null, nodeId)
        const def = { name: api.name, version: api.version ?? null, methods: api.methods }
        let row = this.db.prepare('SELECT * FROM api WHERE key = ?').get(key)
        if (!row) {
          const info = this.db.prepare('INSERT INTO api(key, name, version, apidef, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(key, api.name, api.version ?? null, JSON.stringify(def), now, now)
          row = { id: Number(info.lastInsertRowid) }
        } else if (row.apidef !== JSON.stringify(def)) {
          warnings.push(`схема «${api.name}${api.version ? '@' + api.version : ''}» расходится с уже объявленной`)
        }
        next.add(row.id)
        this.db.prepare('INSERT OR IGNORE INTO node_api(node, api) VALUES (?, ?)').run(nodeId, row.id)
      }
      for (const apiId of old) {
        if (next.has(apiId)) continue
        this.db.prepare('DELETE FROM node_api WHERE node = ? AND api = ?').run(nodeId, apiId)
      }
      this.db.prepare('DELETE FROM api WHERE id NOT IN (SELECT api FROM node_api)').run()
      this.db.exec('COMMIT')
      return { apis: this.nodeApis(nodeId), warnings }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Полный справочник с числом держателей. */
  catalog () {
    return this.db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM node_api n WHERE n.api = a.id) AS refcount
      FROM api a ORDER BY a.id`).all().map((row) => {
      const def = JSON.parse(row.apidef)
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        refcount: row.refcount,
        description: def.description ?? null,
        methods: def.methods ?? [],
      }
    })
  }

  /** Одна запись справочника. */
  api (id) {
    const row = this.db.prepare('SELECT * FROM api WHERE id = ?').get(id)
    if (!row) return null
    return { id: row.id, name: row.name, version: row.version, ...JSON.parse(row.apidef) }
  }

  /** Держит ли этот узел этот API. */
  nodeHasApi (nodeId, apiId) {
    return Boolean(this.db.prepare('SELECT 1 FROM node_api WHERE node = ? AND api = ?').get(nodeId, apiId))
  }

  /** Узлы, держащие API. */
  apiNodes (apiId) {
    return this.db.prepare('SELECT node FROM node_api WHERE api = ?').all(apiId).map((r) => r.node)
  }

  // ── заявки на регистрацию ───────────────────────────────────────────────

  enrollRequest ({ uuid, name, proto, clientVersion, ip }) {
    const now = Date.now()
    const existing = this.db.prepare('SELECT * FROM enrollment WHERE uuid = ?').get(uuid)
    if (existing) {
      if (existing.status === 'approved') return { status: 'approved', uuid, node: existing.node }
      if (existing.status === 'rejected') return { status: 'rejected', uuid }
      this.db.prepare('UPDATE enrollment SET name = ?, proto = ?, client_version = ?, last_seen = ?, ip = ?, status = ? WHERE uuid = ?')
        .run(name, proto ?? null, clientVersion ?? null, now, ip ?? null, 'pending', uuid)
      return { status: 'pending', uuid }
    }
    this.db.prepare(`INSERT INTO enrollment(uuid, name, proto, client_version, ip, first_seen, last_seen, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(uuid, name, proto ?? null, clientVersion ?? null, ip ?? null, now, now)
    return { status: 'pending', uuid }
  }

  enrollment (uuid) {
    return this.db.prepare('SELECT * FROM enrollment WHERE uuid = ?').get(uuid) ?? null
  }

  pending () {
    const since = Date.now()
    return this.db.prepare(`SELECT * FROM enrollment WHERE status = 'pending' ORDER BY first_seen`).all()
      .filter((row) => since - row.last_seen < 900_000)
  }

  approve (uuid, { alias, access = 'none', workdir = null } = {}) {
    const row = this.enrollment(uuid)
    if (!row || row.status !== 'pending') return null
    const name = alias || row.name || `node-${randomUUID().slice(0, 8)}`
    const finalAlias = this.freeAlias(name)
    const { node, token } = this.createNode({ name: finalAlias, access, workdir })
    this.db.prepare('UPDATE node SET proto = ?, client_version = ? WHERE id = ?').run(row.proto, row.client_version, node.id)
    this.db.prepare('UPDATE enrollment SET status = ?, node = ?, handed_at = ? WHERE uuid = ?')
      .run('approved', node.id, null, uuid)
    return { node: this.node(node.id), alias: finalAlias, token }
  }

  reject (uuid) {
    this.db.prepare(`UPDATE enrollment SET status = 'rejected' WHERE uuid = ? AND status = 'pending'`).run(uuid)
  }

  /**
   * Код одноразового подключения. В базе только sha256: код живёт в ссылке,
   * которую человек копирует, — хранить его открытым незачем.
   */
  createPairing (code, { ttlSeconds = 600, note = null } = {}) {
    const now = Date.now()
    this.db.prepare('INSERT INTO pairing(code_sha256, created_at, expires_at, note) VALUES (?, ?, ?, ?)')
      .run(sha256(code), now, now + ttlSeconds * 1000, note)
    return { expiresAt: now + ttlSeconds * 1000 }
  }

  /** Погасить код: вернуть запись, если она живая, и пометить использованной. */
  consumePairing (code) {
    const digest = sha256(code)
    const row = this.db.prepare('SELECT * FROM pairing WHERE code_sha256 = ?').get(digest)
    if (!row) return null
    if (row.used_at) return { error: 'used' }
    if (row.expires_at < Date.now()) return { error: 'expired' }
    return row
  }

  markPairingUsed (code, nodeId) {
    this.db.prepare('UPDATE pairing SET used_at = ?, node = ? WHERE code_sha256 = ?')
      .run(Date.now(), nodeId, sha256(code))
  }

  pairings () {
    return this.db.prepare('SELECT * FROM pairing ORDER BY created_at DESC LIMIT 20').all()
      .map((row) => ({
        created: row.created_at,
        expires: row.expires_at,
        used: row.used_at,
        node: row.node,
        live: !row.used_at && row.expires_at > Date.now(),
      }))
  }

  markHanded (uuid) {
    this.db.prepare('UPDATE enrollment SET handed_at = ? WHERE uuid = ?').run(Date.now(), uuid)
  }
}
