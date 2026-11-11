/**
 * File transfer between a node and the host over HTTP, without a command per chunk.
 *
 * One request instead of a hundred: chunks travelled as base64 (+33% of volume) and with one
 * round-trip per megabyte. Here the request body is the bytes themselves, and the answer is a
 * stream with `content-length` and `x-sha256`.
 *
 * Permission for a transfer is given by the **command**: the server issued a numbered command
 * to the node, the command is not closed yet, the path and mode lie in its arguments. There is no
 * separate ticket — the command itself is the ticket, so "no such command" means
 * "not allowed", not "retry later".
 *
 * Writing goes into `<path>.inprogress` and the file is renamed only after checking
 * the size and sha256: a file either appears whole or does not appear.
 *
 * @module dsh-nodes/transfer
 */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, createReadStream, createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** A refusal with an HTTP code and a text the model will read and understand. */
export class TransferError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Limit of one transfer: 512 MiB by default. */
export function transferLimit (config) {
  return Number(config?.maxTransferBytes) > 0 ? Number(config.maxTransferBytes) : 512 * 1024 * 1024
}

/**
 * Check that the number belongs to an issued command of this node.
 *
 * @returns {object} command from the queue
 */
export function requireCommand ({ queue, node, method, seq }) {
  const number = Number(seq)
  if (!Number.isFinite(number) || number <= 0) {
    throw new TransferError(403, 'no_command', 'не передан номер команды: передача разрешена только в рамках выданной команды')
  }
  const command = queue.issued(node.id, number)
  if (!command) {
    throw new TransferError(403, 'no_command', `команда ${number} узлу ${node.name} не выдавалась или уже закрыта: передача не разрешена`)
  }
  const allowed = Array.isArray(method) ? method : [method]
  if (!allowed.includes(command.method)) {
    throw new TransferError(403, 'wrong_command', `команда ${number} — это ${command.method}, а передача требует ${allowed.join(' или ')}: начни с вызова ${allowed[0]}`)
  }
  return command
}

/** We take the path from the command, not from the request: otherwise the policy cannot be bypassed. */
export function commandPath (command) {
  // `path` is the node side, `hostPath` is ours: for an upload these are different files
  const path = command?.args?.hostPath ?? command?.args?.path
  if (!path) throw new TransferError(412, 'no_path', 'в команде нет пути: некуда записывать файл')
  return String(path)
}

/** Mode: the node sends the permissions of the original, we keep only the 0o777 mask. */
export function commandMode (command, raw) {
  const value = raw ?? command?.args?.mode
  if (value === undefined || value === null || value === '') return null
  // "644" comes as a string and means octal 0o644, while the number from statSync is
  // an already ready mask (0o644 = 420). We tell them apart by magnitude: a mask is no more than 511.
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 8)
    return Number.isFinite(parsed) && parsed > 0 ? parsed & 0o777 : null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return number > 0o777 ? Number.parseInt(String(number), 8) & 0o777 : number & 0o777
}

/**
 * Receive the request body into a file.
 *
 * @param {object} options
 * @param {Request} options.request
 * @param {object} options.command
 * @param {number|null} options.mode
 * @param {object} options.config
 * @returns {Promise<{path: string, bytes: number, sha256: string, mode: number}>}
 */
export async function receive ({ stream: input, headers, command, mode, config }) {
  const target = commandPath(command)
  const expected = Number(command?.args?.size) > 0 ? Number(command.args.size) : null
  const limit = transferLimit(config)
  const declaredRaw = Number(headers?.['content-length'])
  const declared = Number.isFinite(declaredRaw) && declaredRaw > 0 ? declaredRaw : null
  const streaming = declared === null && command?.method === 'pipeFromDevice'
  if (declared === null && !streaming) {
    throw new TransferError(411, 'length_required', 'нужен заголовок content-length: без него нельзя отличить оборванную передачу от целой')
  }
  if (declared !== null && declared > limit) {
    throw new TransferError(413, 'too_big', `файл ${declared} байт больше предела ${limit}: подними maxTransferBytes или передавай кусками`)
  }
  if (expected !== null && declared !== null && declared !== expected) {
    throw new TransferError(412, 'size_mismatch', `в команде ${expected} байт, а в запросе ${declared}: команда и передача разошлись`)
  }

  const part = `${target}.inprogress`
  mkdirSync(dirname(part), { recursive: true })
  const hash = createHash('sha256')
  // One limit for a file, and it counts bytes, not chunks: a chunked body declares no
  // length, so the only place to refuse it is while the body runs. `maxBodyBytes` is about
  // JSON bodies and has nothing to do with a stream: a stream is not capped by its total
  // size, because it goes to a file and memory stays bounded by the stream itself. A
  // per-chunk ceiling would be pointless too — the OS pipe buffer bounds a chunk.
  let received = 0
  const gate = new Transform({
    transform (chunk, _encoding, callback) {
      received += chunk.length
      if (received > limit) {
        callback(new TransferError(413, 'too_big', `поток перевалил за предел ${limit} байт: передача оборвана, файл не записан — подними maxTransferBytes или передавай кусками`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  // We read the body as a stream: the file is not held in memory and the hash is computed on
  // the way. The file is opened before the first byte flows, so the cleanup below removes
  // exactly the file this transfer created.
  const out = createWriteStream(part, { mode: 0o600 })
  try {
    await once(out, 'open')
    await pipeline(input, gate, out)
  } catch (error) {
    try {
      unlinkSync(part)
    } catch {}
    if (error instanceof TransferError) throw error
    throw new TransferError(400, 'transfer_failed', `тело запроса оборвалось: ${error.message}`)
  }

  const bytes = statSync(part).size
  if (declared !== null && bytes !== declared) {
    try {
      unlinkSync(part)
    } catch {}
    throw new TransferError(400, 'incomplete', `пришло ${bytes} из ${declared} байт: передача оборвана, файл не записан`)
  }
  const sha256 = hash.digest('hex')
  const promised = String(headers?.['x-sha256'] ?? command?.args?.sha256 ?? '')
  if (promised && promised !== sha256) {
    try {
      unlinkSync(part)
    } catch {}
    throw new TransferError(409, 'hash_mismatch', `sha256 не совпал: ждали ${promised}, получили ${sha256} — файл не записан`)
  }

  let final = mode
  if (final === null) {
    try {
      final = statSync(target).mode & 0o777
    } catch {
      final = 0o600
    }
  }
  chmodSync(part, final)
  if (streaming) {
    // A script stream: we do not check the length, and finalizing is too early — first the
    // verdict of the command must come. The file stays .inprogress, and the verdict
    // either renames it (finalizePipe) or deletes it (discardPipe).
    return { path: part, bytes, sha256, mode: final, pending: true, final: target }
  }
  renameSync(part, target)
  return { path: target, bytes, sha256, mode: final }
}

/** Check that the file exists and is a file; return the size. */
export function inspect (path) {
  let info
  try {
    info = statSync(path)
  } catch {
    throw new TransferError(404, 'not_found', `файла ${path} нет: скачивать нечего`)
  }
  if (!info.isFile()) throw new TransferError(400, 'not_a_file', `${path} — не файл`)
  return { path, bytes: info.size }
}

/** Answer with a file: stream and headers; the size is mandatory for keep-alive. */
export function fileResponse ({ path, bytes, sha256 }) {
  return {
    stream: createReadStream(path),
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
      // a file transfer must not be cached: the same address will serve another file
      'cache-control': 'no-store',
      ...(sha256 ? { 'x-sha256': sha256 } : {}),
    },
  }
}


/**
 * Finish the stream: rename .inprogress to the target file.
 *
 * Called when the pipe command reported success. While there is no verdict, the file
 * lies under a temporary name — a partial result must not look whole.
 */
export function finalizePipe (pendingPath) {
  if (!String(pendingPath).endsWith('.inprogress')) {
    throw new TransferError(400, 'not_pending', `не временный файл: ${pendingPath}`)
  }
  const target = String(pendingPath).slice(0, -'.inprogress'.length)
  renameSync(pendingPath, target)
  return { path: target, bytes: statSync(target).size }
}

/** Discard the stream: the script failed, there must be no file. */
export function discardPipe (pendingPath) {
  if (!String(pendingPath).endsWith('.inprogress')) {
    throw new TransferError(400, 'not_pending', `не временный файл: ${pendingPath}`)
  }
  try {
    unlinkSync(pendingPath)
  } catch {}
  return { removed: pendingPath }
}
