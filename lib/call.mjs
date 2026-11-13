/**
 * The `nodes` service: a call path for plugins, not for the model.
 *
 * The model-facing tool `nodes_call` is intertwined with a tool execution: approvals,
 * the escalation ladder and the session it belongs to all live in that context. A plugin
 * asking a node a question has none of those — it is the host itself talking to a device
 * that the host already controls. So this module is deliberately smaller: resolve, check
 * the arguments against the declared schema, enqueue, wait, parse the payload.
 *
 * What it inherits on purpose: the same queue, the same timeouts, the same audit trail.
 * A device must not be able to tell whether a command came from the model or from a plugin.
 *
 * @module dsh-nodes/call
 */
import { ArgsError, checkArgs } from './args.mjs'
import { recordAudit } from './audit.mjs'

/** The command outcome as one value: status, the server's words, raw results and parsed payload. */
function outcomeOf (outcome) {
  const block = Array.isArray(outcome?.results) ? outcome.results.at(-1)?.text : null
  let payload = null
  try {
    payload = block ? JSON.parse(block) : null
  } catch {
    // a device may answer with plain text; then there is nothing to parse and no reason to fail
    payload = null
  }
  return {
    status: outcome?.status ?? 'error',
    code: outcome?.code ?? null,
    message: outcome?.message ?? null,
    results: outcome?.results ?? null,
    payload,
  }
}

/**
 * Build the service.
 *
 * @param deps - the plugin's own dependencies; nothing here is fetched from cordis.
 * @param deps.store - node and API registry.
 * @param deps.queue - the command queue shared with the model tools.
 * @param deps.notify - wake the node's socket after a command is queued.
 * @param deps.config - plugin config, for the audit trail.
 * @param {string} [deps.caller] - who is calling, recorded in the audit line.
 * @param {Function} [deps.log] - the plugin logger.
 * @param {(nodeId: number) => boolean} [deps.online] - presence source; the last link time is used otherwise.
 * @returns {{call: Function, node: Function, api: Function, list: Function, devices: Function}}
 */
export function createNodeCaller ({ store, queue, notify, config, caller = 'plugin', log = () => {}, online = null }) {
  /** Presence of one node: the socket when it can tell, otherwise the last link time. */
  function isOnline (node) {
    if (typeof online === 'function') {
      const verdict = online(node.id)
      // A presence source that does not know this node says nothing — not "offline".
      if (typeof verdict === 'boolean') return verdict
    }
    const aliveMs = Number(config?.aliveTimeoutSeconds ?? 60) * 1000
    return Boolean(node.last_seen && Date.now() - node.last_seen < aliveMs)
  }

  /**
   * The devices this Host knows about, without asking any of them anything.
   *
   * A caller that builds a picker — the assistant admin, for one — needs the roster and
   * nothing else. Talking to the devices here would make a settings page wait for hardware
   * that may be asleep, so everything comes from the registry.
   *
   * @returns one entry per registered node: `{id, name, alias, online, version}`.
   */
  function devices () {
    return store.nodes().map((node) => {
      const aliases = Array.isArray(node.aliases) ? node.aliases : []
      return {
        id: node.id,
        name: node.name,
        // A node may answer to several names; the roster names one, the first by order.
        alias: aliases[0] ?? null,
        online: isOnline(node),
        version: node.client_version ?? null,
      }
    })
  }

  /** Resolve an alias or a number the same way the model tool does. */
  function node (ref) {
    const raw = ref
    const asNumber = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw ?? '')) ? Number(raw) : null)
    return asNumber !== null ? store.node(asNumber) : store.nodeByAlias(String(raw ?? ''))
  }

  /** Every API a node currently holds, as definitions rather than ids. */
  function list (nodeRef) {
    const found = node(nodeRef)
    if (!found) return null
    return (store.nodeApis(found.id) ?? []).map((id) => store.api(id)).filter(Boolean)
  }

  /** The API definition a node holds under this name or id, or null. */
  function api (nodeRef, ref) {
    const held = list(nodeRef)
    if (!held) return null
    if (typeof ref === 'number' || /^\d+$/.test(String(ref ?? ''))) {
      const id = Number(ref)
      return held.find((def) => def.id === id) ?? null
    }
    return held.find((def) => def.name === String(ref ?? '')) ?? null
  }

  /**
   * Call one method on one node.
   *
   * @param nodeRef - alias or id of the node.
   * @param apiRef - API id or API name (`voice`, `files`).
   * @param method - method inside that API.
   * @param data - arguments, validated against the declared schema.
   * @param options - `timeout` in seconds, `sandbox` mode, `signal` for cancellation.
   * @returns the command outcome: `{status, code, message, results, payload}`.
   */
  async function call (nodeRef, apiRef, method, data = {}, options = {}) {
    const found = node(nodeRef)
    if (!found) {
      return { status: 'error', code: 'unknown_node', message: `unknown node ${nodeRef}`, results: null, payload: null }
    }
    const def = api(found.id, apiRef)
    if (!def) {
      return {
        status: 'error',
        code: 'unknown_api',
        message: `узел ${found.id} не держит api ${apiRef}`,
        results: null,
        payload: null,
      }
    }
    try {
      checkArgs(def, method, data ?? {})
    } catch (error) {
      if (error instanceof ArgsError) {
        return { status: 'error', code: error.code, message: error.message, results: null, payload: null }
      }
      throw error
    }
    const seconds = Number(options.timeout) > 0 ? Number(options.timeout) : (found.default_timeout ?? undefined)
    const { seq, promise } = queue.enqueue({
      nodeId: found.id,
      api: def.id,
      method,
      args: data ?? {},
      timeout: seconds,
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    })
    if (seq === null) return outcomeOf(await promise)
    notify?.(found.id)
    options.signal?.addEventListener?.('abort', () => queue.cancel(found.id, seq), { once: true })
    const outcome = outcomeOf(await promise)
    try {
      // The audit trail records what left the host, whoever sent it. The model's own calls
      // are logged by the tool; a plugin call would otherwise be invisible in the journal.
      recordAudit({
        store,
        config,
        event: {
          kind: 'exec',
          node: found.id,
          mode: options.sandbox ?? null,
          command: `${def.name}.${method} ${JSON.stringify(data ?? {})}`,
          outcome: outcome.status,
        },
      })
    } catch (error) {
      // the audit trail must not turn a successful device answer into a failure
      log('warn', 'audit-failed', { error: error?.message ?? String(error) })
    }
    log('debug', 'plugin-call', { node: found.id, api: def.id, method, status: outcome.status })
    return outcome
  }

  return { call, node, api, list, devices }
}
