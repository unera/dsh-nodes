/**
 * Audio pushed by a device, without a command.
 *
 * The old path made the host ask: `voice.want` → `voice.record` → `files.copyFromDevice`. Three
 * round trips for one sentence, and the device had to care about host paths and permissions.
 * This route inverts it: the phone records, uploads, and the host only receives.
 *
 * What it keeps from the command path, on purpose: the same size ceiling and the same
 * `.inprogress` → rename dance, so a broken connection can never leave half a recording where
 * the recognizer expects a whole one. What it drops: `seq`, because there is no command.
 *
 * @module dsh-nodes/voice-upload
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { receive, TransferError } from './transfer.mjs'

/** What the recognizer can be handed. Anything else is refused before a byte is written. */
export const VOICE_FILETYPES = Object.freeze(['wav', 'ogg', 'opus', 'mp3', 'm4a', 'flac'])

/** An id that is safe as one path segment, and nothing else. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Read the file type out of the query.
 *
 * @param raw - the `filetype` parameter.
 * @returns a lower-case type from the whitelist.
 * @throws {TransferError} when it is absent or not allowed.
 */
export function voiceFiletype (raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) {
    throw new TransferError(400, 'bad_filetype', `нужен filetype: одно из [${VOICE_FILETYPES.join(', ')}]`)
  }
  if (!VOICE_FILETYPES.includes(value)) {
    throw new TransferError(400, 'bad_filetype', `filetype "${value}" не принимается: одно из [${VOICE_FILETYPES.join(', ')}]`)
  }
  return value
}

/**
 * Read the recording id, or mint one.
 *
 * The id is the identity of one exchange: the phone retries with the same id, and the plugin
 * ignores a repeat instead of answering twice.
 *
 * @param raw - the `id` parameter, if the device sent one.
 * @returns a safe id.
 * @throws {TransferError} when the id contains anything but `[A-Za-z0-9_-]`.
 */
export function voiceUploadId (raw) {
  const value = String(raw ?? '').trim()
  if (!value) return randomUUID()
  if (!SAFE_ID.test(value)) {
    throw new TransferError(400, 'bad_id', `id "${value}" не годится: только буквы, цифры, дефис и подчёркивание, до 64 знаков`)
  }
  return value
}

/**
 * Where the server keeps one recording.
 *
 * The device names neither directory nor file: a writable path chosen by a device is a
 * permission bug waiting to happen.
 *
 * @param args - the plugin config (for `voiceCacheDir`) and the id/type.
 * @returns an absolute path.
 */
export function voiceTargetPath ({ config, id, filetype, node = null }) {
  const root = typeof config?.voiceCacheDir === 'string' && config.voiceCacheDir.trim()
    ? config.voiceCacheDir.trim()
    : join(process.env.DSH_HOME ?? '.', 'cache', 'voice', 'incoming')
  // One directory per device: two phones may well pick the same id, and one must not overwrite the
  // other's recording while it is still being transcribed.
  const device = node === null || node === undefined || node === '' ? '' : String(node)
  return device ? join(root, device, `${id}.${filetype}`) : join(root, `${id}.${filetype}`)
}

/**
 * Which side speaks the answer.
 *
 * `device` is the fast path: the phone reads the text with its own engine, and the host does no
 * synthesis at all. `host` means the answer must sound like our voice — the host synthesizes and
 * the device only plays the file. An unknown value is `device`: a typo must not cost a second of
 * silence on every reply.
 *
 * @param raw - the `synth` query parameter.
 * @returns `'device'` or `'host'`.
 */
export function voiceSynth (raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === 'host' ? 'host' : 'device'
}

/** How much of a report the host keeps: a stack trace in a chat must not grow forever. */
export const BUG_TEXT_LIMIT = 2000

/**
 * Read one bug report out of an event body.
 *
 * `kind` is deliberately free text: the app knows its own failure names, and a vocabulary that
 * grows on the host would refuse tomorrow's reason today. Only the size is bounded.
 *
 * @param body - the parsed request body.
 * @returns `{id, kind, text, app}` with everything trimmed.
 */
export function bugReportOf (body) {
  const cut = (value, limit) => {
    const text = String(value ?? '').trim()
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  }
  return {
    id: cut(body?.id, 128),
    kind: cut(body?.kind, 64),
    text: cut(body?.text, BUG_TEXT_LIMIT),
    app: cut(body?.app, 64),
  }
}

/** The `x-seconds` header as a number, or null when it is absent or nonsense. */
export function headerSeconds (headers) {
  const raw = Number(headers?.['x-seconds'])
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * One client timestamp in epoch milliseconds.
 *
 * A device clock is a device clock: a nonsense value is ignored, never a reason to refuse a
 * recording. The measurement is optional in the first place — the words matter more.
 *
 * @param headers - request headers.
 * @param name - header name.
 * @returns a whole positive number of milliseconds, or null.
 */
export function headerEpoch (headers, name) {
  const raw = headers?.[name]
  if (raw === undefined || raw === null || raw === '') return null
  const number = Number(raw)
  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * Receive one recording and tell the host about it.
 *
 * @param args - request stream, headers, the authenticated node, the query, config,
 *   the `services` bag (for `emit`) and `log`.
 * @returns the body of the 202 answer.
 */
export async function receiveVoiceUpload ({ stream, headers, node, query, config, services, log = () => {}, now = () => Date.now() }) {
  // Taken before the first byte: the difference between this and the client's `x-sent-at`
  // is the network and the queue, which is exactly what a slow exchange blames first.
  const receivedAt = now()
  const at = {
    recordStart: headerEpoch(headers, 'x-record-start'),
    recordStop: headerEpoch(headers, 'x-record-stop'),
    sentAt: headerEpoch(headers, 'x-sent-at'),
    receivedAt,
  }
  const filetype = voiceFiletype(query?.get?.('filetype'))
  const id = voiceUploadId(query?.get?.('id'))
  const target = voiceTargetPath({ config, id, filetype, node: node.id })
  // `receive()` wants a command because that is where it takes the path from. There is no
  // command here, so we hand it the one fact it reads and keep the rest of its behaviour:
  // the ceiling, the length check, the atomic rename.
  // The voice route has its own ceiling: a recording is seconds long, and this is the one upload
  // a device token alone can push.
  const voiceLimit = Number(config?.maxVoiceBytes) > 0 ? Number(config.maxVoiceBytes) : 16 * 1024 * 1024
  const stored = await receive({
    stream,
    headers,
    command: { args: { path: target }, method: 'copyFromDevice' },
    mode: 0o600,
    config: { ...config, maxTransferBytes: Math.min(voiceLimit, Number(config?.maxTransferBytes) || voiceLimit) },
  })
  const seconds = headerSeconds(headers)
  const synth = voiceSynth(query?.get?.('synth'))
  const event = {
    node: node.id,
    nodeName: node.name,
    id,
    path: stored.path,
    bytes: stored.bytes,
    seconds,
    synth,
    at,
  }
  services?.emit?.('dsh-nodes/voice', event)
  log('info', 'voice-upload', { node: node.id, id, bytes: stored.bytes, seconds, synth, at })
  return { accepted: true, id, path: stored.path, bytes: stored.bytes, seconds }
}

/**
 * Which kind of device event this is.
 *
 * `type` is mandatory for new clients, but an installed application cannot be updated in the
 * same minute as the server: a body without a type is read as the oldest kind, `notify`, and the
 * host says so once instead of silently guessing forever.
 *
 * @param body - the parsed request body.
 * @param options - `warnOnce` receives a message the first time a type is missing.
 * @returns `{type}` or `{error: {status, code, message}}`.
 */
export function eventTypeOf (body, { warnOnce = () => {} } = {}) {
  const raw = body?.type
  if (raw === undefined || raw === null || raw === '') {
    // An installed application cannot be updated in the same minute as the server: a body
    // without a type is read as the oldest kind, and the host says so once.
    const guess = body?.notification ? 'notify-button' : 'notify-session'
    warnOnce(`событие без type: считаю ${guess} — обнови сборку устройства, когда сможешь`)
    return checkNotifyFields(guess, body)
  }
  const value = String(raw).trim().toLowerCase()
  // `notify` is the pre-split name: it meant "a button" when the body named a notification and
  // "text for a session" otherwise. The meaning is recovered from the body, not from the name.
  if (value === 'notify') {
    const guess = body?.notification ? 'notify-button' : 'notify-session'
    warnOnce(`type "notify" устарел: считаю ${guess} — шли ${guess} явно`)
    return checkNotifyFields(guess, body)
  }
  if (value === 'notify-button' || value === 'notify-session') return checkNotifyFields(value, body)
  // A report about the app itself: a fact for the host, with a free-form kind and some words.
  if (value === 'bug-report') return { type: 'bug-report' }
  // `new-session` is its own type: a request about the conversation, not about audio.
  if (value === 'new-session') return { type: 'new-session' }
  // The screen opened: warm the voice up before the first words, so the first answer is not slow.
  if (value === 'voice-warmup') return { type: 'voice-warmup' }
  if (value === 'voice') {
    // Audio arrives on its own route, where the type names it unambiguously. Seeing it here means
    // the client sent a recording to the events endpoint, which stores nothing.
    return {
      error: {
        status: 400,
        code: 'bad_type',
        message: 'voice принимается только на /v1/upload-file: в событиях его нет',
      },
    }
  }
  if (value === 'form') {
    return {
      error: {
        status: 501,
        code: 'form_not_supported',
        message: 'события формы этот хост пока не принимает: форма отправится, когда появится приём форм',
      },
    }
  }
  return {
    error: {
      status: 400,
      code: 'bad_type',
      message: `type "${raw}" неизвестен: ожидается new-session, voice-warmup, notify-button, notify-session, bug-report или form`,
    },
  }
}

/**
 * The fields a notification event cannot do without.
 *
 * A button press is meaningless without the notification it belongs to (the server reads the
 * label, the purpose and the session from its own record), and session text is meaningless
 * without a session and words.
 *
 * @param type - `notify-button` or `notify-session`.
 * @param body - the parsed request body.
 * @returns `{type}` or a refusal.
 */
function checkNotifyFields (type, body) {
  if (type === 'notify-button' && !body?.notification) {
    return {
      error: {
        status: 400,
        code: 'bad_request',
        message: 'нужен номер уведомления: без него нажатие некуда отнести',
      },
    }
  }
  if (type === 'notify-session') {
    if (!String(body?.session ?? '').trim()) {
      return { error: { status: 400, code: 'bad_request', message: 'нужен номер сессии: без него событие некуда положить' } }
    }
    if (!String(body?.text ?? '').trim()) {
      return { error: { status: 400, code: 'bad_request', message: 'нужен текст события' } }
    }
  }
  return { type }
}
