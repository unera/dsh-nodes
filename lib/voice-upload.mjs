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
export function voiceTargetPath ({ config, id, filetype }) {
  const root = typeof config?.voiceCacheDir === 'string' && config.voiceCacheDir.trim()
    ? config.voiceCacheDir.trim()
    : join(process.env.DSH_HOME ?? '.', 'cache', 'voice', 'incoming')
  return join(root, `${id}.${filetype}`)
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
  const target = voiceTargetPath({ config, id, filetype })
  // `receive()` wants a command because that is where it takes the path from. There is no
  // command here, so we hand it the one fact it reads and keep the rest of its behaviour:
  // the ceiling, the length check, the atomic rename.
  const stored = await receive({
    stream,
    headers,
    command: { args: { path: target }, method: 'copyFromDevice' },
    mode: 0o600,
    config,
  })
  const seconds = headerSeconds(headers)
  const event = {
    node: node.id,
    nodeName: node.name,
    id,
    path: stored.path,
    bytes: stored.bytes,
    seconds,
    at,
  }
  services?.emit?.('dsh-nodes/voice', event)
  log('info', 'voice-upload', { node: node.id, id, bytes: stored.bytes, seconds, at })
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
    warnOnce('событие без type: считаю notify — обнови сборку устройства, когда сможешь')
    return { type: 'notify' }
  }
  const value = String(raw).trim().toLowerCase()
  if (value === 'notify') return { type: 'notify' }
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
      message: `type "${raw}" неизвестен: ожидается notify или form`,
    },
  }
}
