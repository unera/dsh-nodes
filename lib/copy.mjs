/**
 * Copying a file between a node and the DSH host.
 *
 * The server is the relay: nodes connect outwards and do not see each other, so
 * "node A → node B" directly is impossible, and through the model context it is not
 * allowed either — the pieces would eat up its window. Here the bytes go through the
 * server process, and the model sees only the result and the hash.
 *
 * Copying is sequential: one chunk at a time. Parallel chunks would buy
 * speed, but also a way to bury the node in requests; the cap on concurrent commands
 * on the client (`maxConcurrent`) protects only against our own parallel calls,
 * not against us ourselves heaping a hundred commands into the queue.
 *
 * @module dsh-nodes/copy
 */
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'

/**
 * Default chunk size.
 *
 * The limit is not our wish but the transport: the command result travels to the
 * server over HTTP and base64 inflates the bytes by a third, so a chunk must reliably
 * fit into `maxBodyBytes` (1 MiB by default). 256 KiB give ~350 KiB of body.
 */
export const DEFAULT_CHUNK = 256 * 1024
/** File ceiling per call: protection against "copy everything to me". */
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

/** Whether the path is allowed: the session always, plus explicitly listed directories. */
export function insideSelf (path, roots) {
  const target = resolvePath(path)
  return roots.some((root) => target === resolvePath(root) || target.startsWith(resolvePath(root) + '/'))
}

/**
 * Read a chunk from the host.
 * @param {string} path
 * @param {number} offset
 * @param {number} size
 */
export function selfReadChunk (path, offset, size) {
  const buffer = readFileSync(path)
  const slice = buffer.subarray(offset, offset + size)
  return { data: slice.toString('base64'), size: slice.length, total: buffer.length, eof: offset + slice.length >= buffer.length }
}

/**
 * Write a chunk to the host: we write into `<path>.inprogress`, the last one renames it.
 * @param {string} path
 * @param {number} offset
 * @param {string} base64
 * @param {boolean} final
 */
export function selfWriteChunk (path, offset, base64, final) {
  const part = `${path}.inprogress`
  mkdirSync(dirname(part), { recursive: true })
  const chunk = Buffer.from(String(base64 ?? ''), 'base64')
  const fd = openSync(part, offset === 0 ? 'w' : 'r+')
  try {
    writeSync(fd, chunk, 0, chunk.length, offset)
  } finally {
    closeSync(fd)
  }
  if (!final) return { written: chunk.length, part }
  // we take the mode from the existing file: an overwrite must not silently change it
  let mode
  try {
    mode = statSync(path).mode & 0o777
  } catch {}
  renameSync(part, path)
  return { written: chunk.length, complete: true, mode: mode ?? null, size: statSync(path).size }
}

/** Hash of the file on the host. */
export function selfHash (path) {
  return { sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), size: statSync(path).size }
}

/**
 * Copy a file as a stream: source → target, in chunks, without an intermediate disk.
 *
 * @param {object} options
 * @param {object} options.source `{stat, read}` — where to read from
 * @param {object} options.target `{write, hash}` — where to write to
 * @param {number} [options.chunk]
 * @param {number} [options.maxBytes]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{size: number, sha256: string, chunk: number}>}
 */
export async function copyStream ({ source, target, chunk = DEFAULT_CHUNK, maxBytes = DEFAULT_MAX_BYTES, onProgress = () => {} }) {
  const info = await source.stat()
  if (info.size > maxBytes) {
    throw Object.assign(new Error(`файл ${info.size} байт больше потолка ${maxBytes}`), { code: 'too_big' })
  }
  const expected = await source.hash()
  let offset = 0
  while (offset < info.size || info.size === 0) {
    const part = await source.read(offset, chunk)
    const final = part.eof || offset + part.size >= info.size
    await target.write(offset, part.data, final)
    offset += part.size
    onProgress(offset, info.size)
    if (final) break
  }
  const got = await target.hash()
  if (got.sha256 !== expected.sha256) {
    throw Object.assign(new Error(`хеш не совпал: ожидали ${expected.sha256}, получили ${got.sha256}`), { code: 'hash_mismatch' })
  }
  return { size: got.size, sha256: got.sha256, chunk }
}

/** Default path inside the session directory. */
export function joinSelf (root, path) {
  return path.startsWith('/') ? path : join(root, path)
}
