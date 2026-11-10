/**
 * dsh-nodes server state in SQLite.
 *
 * Disk only here: nodes, aliases, tokens, the API catalog and the links between them.
 * Process live state (counters, queue, promises) lives in queue.mjs and is not
 * written to the database — epoch tells it apart (§4.7 of the plan).
 *
 * @module dsh-nodes/db
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** Schema. Migrations go by PRAGMA user_version, step by step. */
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
  // the uuid is not a secret, but the token is issued on request: the client sends its
  // own nonce, and only whoever knows it gets the token
  `ALTER TABLE enrollment ADD COLUMN nonce_sha256 TEXT`,
  // we compute node uptime by our own time: the client only sends "how much has
  // passed since start", and the clock on its machine can be wrong
  `ALTER TABLE node ADD COLUMN boot_at INTEGER`,
  // how the node answers a question: local | server | none (a promise, not a guess)
  `ALTER TABLE node ADD COLUMN approver TEXT`,
  // the mode a command starts in; comes from the node together with its ceiling
  `ALTER TABLE node ADD COLUMN base TEXT`,
  // audit: who, what, when, how it ended. A shop window for the admin panel, a ring buffer
  `CREATE TABLE IF NOT EXISTS audit (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     kind       TEXT NOT NULL,
     node       INTEGER,
     session    TEXT,
     mode       TEXT,
     command    TEXT,
     code       INTEGER,
     escalation INTEGER,
     approved   TEXT,
     outcome    TEXT,
     at         INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit(at)`,
  // the client's own generation counter: it grows on every connection — reconnects and
  // restarts alike — so an older instance cannot push a newer one out of the server
  `ALTER TABLE node ADD COLUMN client_epoch INTEGER`,
]

/**
 * Bring the schema up to a working one without relying on `user_version`.
 *
 * A live database showed that the step counter and the actual contents diverge:
 * `user_version` said "everything applied", while the `approver` column was missing.
 * The reason — steps were edited in place. So after the usual run we check against
 * reality: whatever is missing, we add. All operations are idempotent.
 */
function ensureSchema (db) {
  const exists = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
  const columns = (table) => new Set(
    exists(table) ? db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name) : [],
  )
  const node = columns('node')
  if (node.size && !node.has('boot_at')) db.exec('ALTER TABLE node ADD COLUMN boot_at INTEGER')
  if (node.size && !node.has('approver')) db.exec('ALTER TABLE node ADD COLUMN approver TEXT')
  if (node.size && !node.has('base')) db.exec('ALTER TABLE node ADD COLUMN base TEXT')
  // device uuid: by it we recognise a phone that connected again
  if (node.size && !node.has('uuid')) db.exec('ALTER TABLE node ADD COLUMN uuid TEXT')
  // the client's generation counter: without it a stale instance could push out a live one
  if (node.size && !node.has('client_epoch')) db.exec('ALTER TABLE node ADD COLUMN client_epoch INTEGER')
  if (node.size) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS node_uuid ON node(uuid) WHERE uuid IS NOT NULL')
  const notification = columns('notification')
  if (notification.size && !notification.has('answer_id')) db.exec('ALTER TABLE notification ADD COLUMN answer_id TEXT')
  const enrollment = columns('enrollment')
  if (enrollment.size && !enrollment.has('nonce_sha256')) db.exec('ALTER TABLE enrollment ADD COLUMN nonce_sha256 TEXT')
  db.exec(`CREATE TABLE IF NOT EXISTS notification (
    id          TEXT PRIMARY KEY,
    node        INTEGER NOT NULL,
    session     TEXT NOT NULL,
    purpose     TEXT,
    title       TEXT,
    text        TEXT,
    buttons     TEXT,
    created_at  INTEGER NOT NULL,
    answered_at INTEGER,
    answer      TEXT,
    answer_id   TEXT
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    node       INTEGER,
    session    TEXT,
    mode       TEXT,
    command    TEXT,
    code       INTEGER,
    escalation INTEGER,
    approved   TEXT,
    outcome    TEXT,
    at         INTEGER NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS audit_at ON audit(at)')
  // binding "node method → server rule". Lives apart from apidef: the rule
  // describes how this machine executes a command, not the API contract, and an external
  // declaration source (MCP) must not mix service fields into def
  db.exec(`CREATE TABLE IF NOT EXISTS api_rule (
    node   INTEGER NOT NULL REFERENCES node(id) ON DELETE CASCADE,
    api    INTEGER NOT NULL REFERENCES api(id)  ON DELETE CASCADE,
    method TEXT NOT NULL,
    rule   TEXT NOT NULL,
    opts   TEXT,
    PRIMARY KEY (node, api, method)
  )`)
}

/**
 * The "this step is already applied" error is not a reason to refuse to start.
 * @param {Error} error
 */
function isAlreadyApplied (error) {
  const text = String(error?.message ?? '')
  return /duplicate column name/i.test(text) || /already exists/i.test(text)
}

/** SHA-256 in hex — the only form in which a token reaches the disk. */
export function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

/** New node token: 32 random bytes in base64url. */
export function newToken () {
  return randomBytes(32).toString('base64url')
}

/** Digest comparison without a timing leak. */
function sameDigest (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Server store.
 */
export class Store {
  /** @param {string} file path to the SQLite file (':memory:' for tests) */
  constructor (file) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.#migrate()
    this.#ensure()
  }

  /**
   * Run the schema steps that have not been applied.
   *
   * Steps are idempotent where possible: `ADD COLUMN` on an already added
   * column and `CREATE INDEX` on an existing index are not treated as an error.
   * The reason is simple — a live database already caught a start failure caused by
   * re-running a step, and a plugin that did not come up logs nothing sensible:
   * it simply does not register routes, and clients get 404.
   */
  #ensure () {
    ensureSchema(this.db)
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
        if (isAlreadyApplied(error)) {
          this.db.exec(`PRAGMA user_version = ${i + 1}`)
          continue
        }
        throw error
      }
    }
  }

  close () {
    this.db.close()
  }

  /** A service value from meta. */
  getMeta (key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row ? row.value : fallback
  }

  setMeta (key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  /** epoch: grows on every server start (plan §4.7). */
  bumpEpoch () {
    const next = Number(this.getMeta('epoch', '0')) + 1
    this.setMeta('epoch', next)
    return next
  }

  // ── nodes ────────────────────────────────────────────────────────────────

  /** Node by the bearer token. */
  nodeByToken (token) {
    // an exact lookup by the token_sha256 index: walking all nodes on every
    // request would be a table scan on every client poll
    const digest = sha256(token)
    return this.db.prepare('SELECT * FROM node WHERE token_sha256 = ?').get(digest) ?? null
  }

  /** Node by number. */
  node (id) {
    return this.db.prepare('SELECT * FROM node WHERE id = ?').get(id) ?? null
  }

  /** Node by any of its aliases. */
  nodeByAlias (alias) {
    const row = this.db.prepare('SELECT node FROM node_alias WHERE alias = ?').get(alias)
    return row ? this.node(row.node) : null
  }

  /** Nodes for the admin panel and nodes_list. */
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
   * Create a node. The name immediately becomes an alias: a name you cannot call
   * by is a trap (plan §11.3).
   * @returns {{node: object, token: string|null}}
   */
  createNode ({ name, token = null, access = 'none', workdir = null, defaultTimeout = null, allowEscalation = 1, local = 0, uuid = null }) {
    const plain = token ?? newToken()
    const now = Date.now()
    const info = this.db.prepare(`INSERT INTO node
      (local, name, token_sha256, token_issued_at, access, workdir, default_timeout, allow_escalation, created_at, uuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(local, name, sha256(plain), now, access, workdir, defaultTimeout, allowEscalation ? 1 : 0, now, uuid ?? null)
    const id = Number(info.lastInsertRowid)
    this.setAlias(id, name)
    return { node: this.node(id), token: plain }
  }

  /**
   * Revoke the token and put the node back into the "approval needed" state.
   *
   * Replacing the token alone is not enough: the old client gets 401, goes to /v1/enroll,
   * and there the request is already "handed" — so it would keep knocking forever. That is why
   * the request is reopened, and the node shows up among the "requests without a code".
   */
  revokeToken (id) {
    const dead = newToken()
    this.db.prepare('UPDATE node SET token_sha256 = ?, token_issued_at = ? WHERE id = ?').run(sha256(dead), Date.now(), id)
    this.db.prepare("UPDATE enrollment SET status = 'pending', handed_at = NULL, last_seen = ? WHERE node = ?")
      .run(Date.now(), id)
    return true
  }

  /** Reissue the token: the old one stops working at once. */
  /** Remember a notification: from it the server will understand what a press means. */
  createNotification ({ id, node, session, purpose = null, title = null, text = null, buttons = [] }) {
    this.db.prepare(`INSERT INTO notification (id, node, session, purpose, title, text, buttons, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, node, session, purpose, title, text, JSON.stringify(buttons), Date.now())
    return this.notification(id)
  }

  notification (id) {
    const row = this.db.prepare('SELECT * FROM notification WHERE id = ?').get(String(id))
    if (!row) return null
    let buttons = []
    try {
      buttons = JSON.parse(row.buttons ?? '[]')
    } catch {}
    return { ...row, buttons }
  }

  /** Mark a press: what the human chose and when. */
  answerNotification (id, answer, answerId = null) {
    this.db.prepare('UPDATE notification SET answered_at = ?, answer = ?, answer_id = ? WHERE id = ? AND answered_at IS NULL')
      .run(Date.now(), String(answer ?? ''), answerId, String(id))
    return this.notification(id)
  }

  /** The node that already came with this uuid, or null. */
  nodeByUuid (uuid) {
    if (!uuid) return null
    const row = this.db.prepare('SELECT * FROM node WHERE uuid = ?').get(String(uuid))
    return row ? this.node(row.id) : null
  }

  reissueToken (id) {
    const plain = newToken()
    this.db.prepare('UPDATE node SET token_sha256 = ?, token_issued_at = ? WHERE id = ?').run(sha256(plain), Date.now(), id)
    return plain
  }

  /** Node alias; unique case-insensitively. */
  setAlias (nodeId, alias) {
    this.db.prepare('DELETE FROM node_alias WHERE node = ? AND alias = ? COLLATE NOCASE').run(nodeId, alias)
    this.db.prepare('INSERT INTO node_alias(alias, node) VALUES (?, ?)').run(alias, nodeId)
  }

  removeAlias (nodeId, alias) {
    this.db.prepare('DELETE FROM node_alias WHERE node = ? AND alias = ? COLLATE NOCASE').run(nodeId, alias)
  }

  /** Free alias: nbw, nbw-2, nbw-3… */
  freeAlias (wanted) {
    let alias = wanted
    for (let n = 2; ; n++) {
      const taken = this.db.prepare('SELECT 1 FROM node_alias WHERE alias = ?').get(alias)
      if (!taken) return alias
      alias = `${wanted}-${n}`
    }
  }

  updateNode (id, patch) {
    const fields = ['name', 'access', 'workdir', 'default_timeout', 'allow_escalation', 'boot_at', 'approver', 'base', 'client_epoch']
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

  /**
   * The client generation this node is known by: `null` when the node never said one.
   *
   * It grows on the client side on every connection — reconnects and restarts alike — and
   * a lower number means an older instance is talking. Unlike the server's own `epoch`
   * it survives a server restart: it lives in SQLite for exactly that reason.
   */
  clientEpoch (id) {
    const row = this.db.prepare('SELECT client_epoch FROM node WHERE id = ?').get(id)
    return row?.client_epoch === null || row?.client_epoch === undefined ? null : Number(row.client_epoch)
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

  // ── API catalog ──────────────────────────────────────────────────────

  /**
   * Contract key: sha256(name \0 version) or sha256(name \0 node:<id>) —
   * without a version the API belongs to the node (plan §2.1).
   */
  apiKey (name, version, nodeId) {
    return version ? sha256(`${name}\u0000${version}`) : sha256(`${name}\u0000node:${nodeId}`)
  }

  /**
   * Node declaration: a set difference, one transaction (plan §2.1).
   * @param {number} nodeId
   * @param {Array<{name: string, version?: string, methods: object[]}>} apis
   * @returns {{apis: number[], warnings: string[]}}
   */
  /**
   * Declare a node's APIs and its rules in one transaction.
   *
   * `rules` are bindings by name: `{api, version, method, rule, opts}`. API numbers
   * are not needed in them: this same transaction issues them. That way a failure at any step
   * rolls back the whole declaration — both the apis and the bindings — instead of leaving
   * the node half declared.
   *
   * @param {number} nodeId
   * @param {Array<{name: string, version?: string, methods: object[]}>} apis
   * @param {Array<{api: string, version: string|null, method: string, rule: string, opts: object|null}>} [rules]
   * @returns {{apis: number[], warnings: string[]}}
   */
  announce (nodeId, apis, rules = []) {
    const warnings = []
    this.db.exec('BEGIN')
    try {
      const old = new Set(this.nodeApis(nodeId))
      const next = new Set()
      // we find the API number by name and version inside the same transaction.
      // One name can be declared in several versions, so we keep a
      // list, not a single value
      const apiIdsByName = new Map()
      const now = Date.now()
      for (const declared of apis) {
        // `#…` are service names of the server. If a client tried to declare
        // such a one, faking a control command would become possible, so
        // we drop the method and warn instead of staying silent.
        let api = declared
        if (Array.isArray(api.methods)) {
          const reserved = api.methods.filter((m) => String(m?.method ?? '').startsWith('#'))
          if (reserved.length) {
            warnings.push(`api ${api.name}: методы с «#» зарезервированы: ${reserved.map((m) => m.method).join(', ')}`)
            api = { ...api, methods: api.methods.filter((m) => !String(m?.method ?? '').startsWith('#')) }
          }
        }
        const key = this.apiKey(api.name, api.version ?? null, nodeId)
        const def = { name: api.name, version: api.version ?? null, methods: api.methods }
        let row = this.db.prepare('SELECT * FROM api WHERE key = ?').get(key)
        if (!row) {
          const info = this.db.prepare('INSERT INTO api(key, name, version, apidef, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(key, api.name, api.version ?? null, JSON.stringify(def), now, now)
          row = { id: Number(info.lastInsertRowid) }
        } else if (row.apidef !== JSON.stringify(def)) {
          // If only the current node holds this API, then it is the one entitled
          // to update the schema: otherwise the client cannot fix the method set without
          // changing the version, and the old record stays in the catalog forever.
          // who else holds this pair: if only the declaring node itself — it is entitled
          // to fix its contract, if someone else — the version is taken
          const holders = this.db.prepare('SELECT node FROM node_api WHERE api = ?').all(row.id).map((item) => item.node)
          const others = holders.filter((id) => id !== nodeId)
          if (!others.length) {
            // the only holder is entitled to fix its own contract without changing
            // the version: otherwise the client cannot repair the method set, and the
            // old record stays in the catalog forever
            this.db.prepare('UPDATE api SET apidef = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(def), now, row.id)
            warnings.push(`схема «${api.name}${api.version ? '@' + api.version : ''}» обновлена: версия не изменилась`)
          } else {
            // One and the same (name, version) pair with different methods is not a
            // warning: the server would take the schema of the first, and the second node
            // would execute commands against someone else's contract. We refuse the declaration.
            const conflict = new Error(
              `схема «${api.name}${api.version ? '@' + api.version : ''}» расходится с уже объявленной; `
              + 'её держат другие узлы — поднимите версию контракта',
            )
            conflict.code = 'apidef-conflict'
            conflict.api = api.name
            conflict.version = api.version ?? null
            conflict.holders = others
            throw conflict
          }
        }
        next.add(row.id)
        const bucket = apiIdsByName.get(api.name) ?? []
        bucket.push({ id: row.id, version: api.version ?? null, methods: api.methods ?? [] })
        apiIdsByName.set(api.name, bucket)
        this.db.prepare('INSERT OR IGNORE INTO node_api(node, api) VALUES (?, ?)').run(nodeId, row.id)
      }
      for (const apiId of old) {
        if (next.has(apiId)) continue
        this.db.prepare('DELETE FROM node_api WHERE node = ? AND api = ?').run(nodeId, apiId)
      }
      // the declaration's rules are replaced entirely, together with the apis
      this.db.prepare('DELETE FROM api_rule WHERE node = ?').run(nodeId)
      const insertRule = this.db.prepare('INSERT OR REPLACE INTO api_rule(node, api, method, rule, opts) VALUES (?, ?, ?, ?, ?)')
      for (const rule of rules) {
        const bucket = apiIdsByName.get(rule.api) ?? []
        // a version is given — we take it; not given — the one where the method is really declared
        const chosen = rule.version !== null && rule.version !== undefined
          ? bucket.find((item) => item.version === rule.version)
          : (bucket.find((item) => item.methods.some((m) => m?.method === rule.method)) ?? bucket[0])
        if (!chosen) {
          const error = new Error(`правило ссылается на api «${rule.api}», которого нет в объявлении`)
          error.code = 'apply-rules-invalid'
          throw error
        }
        insertRule.run(nodeId, chosen.id, rule.method, rule.rule, rule.opts ? JSON.stringify(rule.opts) : null)
      }
      this.db.prepare('DELETE FROM api WHERE id NOT IN (SELECT api FROM node_api)').run()
      this.db.exec('COMMIT')
      return { apis: this.nodeApis(nodeId), warnings }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Bind the node's rules: the set is replaced entirely.
   *
   * @param {number} nodeId
   * @param {Array<{apiId: number, method: string, rule: string, opts?: object}>} entries
   * @returns {number} how many bindings were written
   */
  setNodeRules (nodeId, entries = []) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM api_rule WHERE node = ?').run(nodeId)
      const insert = this.db.prepare('INSERT OR REPLACE INTO api_rule(node, api, method, rule, opts) VALUES (?, ?, ?, ?, ?)')
      for (const entry of entries) {
        insert.run(nodeId, entry.apiId, entry.method, entry.rule, entry.opts ? JSON.stringify(entry.opts) : null)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return entries.length
  }

  /**
   * The method rule of a particular node.
   *
   * The rule belongs to the node, not to the contract: the command goes to a particular
   * machine, and "how to execute" is its property.
   *
   * @param {number} nodeId
   * @param {number} apiId
   * @param {string} method
   * @returns {{rule: string, opts: object|null}|null}
   */
  nodeRule (nodeId, apiId, method) {
    const row = this.db.prepare('SELECT rule, opts FROM api_rule WHERE node = ? AND api = ? AND method = ?')
      .get(nodeId, apiId, method)
    if (!row) return null
    let opts = null
    if (row.opts) {
      try {
        opts = JSON.parse(row.opts)
      } catch {
        opts = null
      }
    }
    return { rule: row.rule, opts }
  }

  /** All node rules — for diagnostics and the admin panel. */
  nodeRules (nodeId) {
    return this.db.prepare('SELECT api, method, rule, opts FROM api_rule WHERE node = ? ORDER BY api, method')
      .all(nodeId)
      .map((row) => {
        let opts = null
        if (row.opts) {
          try {
            opts = JSON.parse(row.opts)
          } catch {
            opts = null
          }
        }
        return { api: row.api, method: row.method, rule: row.rule, opts }
      })
  }

  /** The whole catalog with the number of holders. */
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

  /** One catalog record. */
  api (id) {
    const row = this.db.prepare('SELECT * FROM api WHERE id = ?').get(id)
    if (!row) return null
    return { id: row.id, name: row.name, version: row.version, ...JSON.parse(row.apidef) }
  }

  /** Whether this node holds this API. */
  nodeHasApi (nodeId, apiId) {
    return Boolean(this.db.prepare('SELECT 1 FROM node_api WHERE node = ? AND api = ?').get(nodeId, apiId))
  }

  /** Nodes that hold the API. */
  apiNodes (apiId) {
    return this.db.prepare('SELECT node FROM node_api WHERE api = ?').all(apiId).map((r) => r.node)
  }

  // ── enrollment requests ───────────────────────────────────────────────

  enrollRequest ({ uuid, name, proto, clientVersion, ip, nonce }) {
    const now = Date.now()
    const nonceHash = nonce ? sha256(String(nonce)) : null
    const existing = this.db.prepare('SELECT * FROM enrollment WHERE uuid = ?').get(uuid)
    if (existing) {
      if (existing.status === 'approved') return { status: 'approved', uuid, node: existing.node }
      if (existing.status === 'rejected') return { status: 'rejected', uuid }
      this.db.prepare('UPDATE enrollment SET name = ?, proto = ?, client_version = ?, last_seen = ?, ip = ?, status = ?, nonce_sha256 = COALESCE(?, nonce_sha256) WHERE uuid = ?')
        .run(name, proto ?? null, clientVersion ?? null, now, ip ?? null, 'pending', nonceHash, uuid)
      return { status: 'pending', uuid }
    }
    this.db.prepare(`INSERT INTO enrollment(uuid, name, proto, client_version, ip, first_seen, last_seen, status, nonce_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(uuid, name, proto ?? null, clientVersion ?? null, ip ?? null, now, now, nonceHash)
    return { status: 'pending', uuid }
  }

  /** Whether the nonce matches what the client sent when enrolling. */
  enrollmentNonceFits (uuid, nonce) {
    const row = this.db.prepare('SELECT nonce_sha256 FROM enrollment WHERE uuid = ?').get(uuid)
    if (!row) return false
    if (!row.nonce_sha256) return true // old requests without a nonce keep working
    return Boolean(nonce) && sha256(String(nonce)) === row.nonce_sha256
  }

  /** Write an audit event. */
  writeAudit ({ kind, node, session, mode, command, code, escalation, approved, outcome, at }) {
    this.db.prepare(`INSERT INTO audit (kind, node, session, mode, command, code, escalation, approved, outcome, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(kind), node ?? null, session ?? null, mode ?? null, command ?? null,
        code ?? null, escalation ?? null, approved ?? null, outcome ?? null, at ?? Date.now())
  }

  /** Ring buffer: old records are deleted, the database does not grow. */
  trimAudit ({ maxRows = 2000, maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    if (maxAgeMs > 0) {
      this.db.prepare('DELETE FROM audit WHERE at < ?').run(Date.now() - maxAgeMs)
    }
    if (maxRows > 0) {
      this.db.prepare(`DELETE FROM audit WHERE id NOT IN (
        SELECT id FROM audit ORDER BY id DESC LIMIT ?
      )`).run(maxRows)
    }
  }

  /** Latest events, freshest first. */
  readAudit (limit = 100) {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Number(limit) || 100)
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
   * One-time pairing code. Only its sha256 is in the database: the code lives in the link
   * the human copies, so there is no point in storing it in the clear.
   */
  createPairing (code, { ttlSeconds = 600, note = null } = {}) {
    const now = Date.now()
    this.db.prepare('INSERT INTO pairing(code_sha256, created_at, expires_at, note) VALUES (?, ?, ?, ?)')
      .run(sha256(code), now, now + ttlSeconds * 1000, note)
    return { expiresAt: now + ttlSeconds * 1000 }
  }

  /** Redeem the code: return the record if it is live, and mark it used. */
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
