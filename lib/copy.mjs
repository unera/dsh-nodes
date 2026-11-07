/**
 * Копирование файла между узлом и хостом DSH.
 *
 * Релей — сервер: узлы соединяются наружу и друг друга не видят, поэтому
 * «узел A → узел B» напрямую невозможно, а через контекст модели нельзя —
 * куски съели бы её окно. Здесь байты идут через процесс сервера, а модель
 * видит только итог и хеш.
 *
 * Копирование последовательное: один кусок за раз. Параллельные куски дали бы
 * скорость, но и способ завалить узел запросами; потолок одновременных команд
 * на клиенте (`maxConcurrent`) спасает только от своих же параллельных вызовов,
 * а не от того, что мы сами насыпем сотню команд в очередь.
 *
 * @module dsh-nodes/copy
 */
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'

/**
 * Размер куска по умолчанию.
 *
 * Ограничение не наше желание, а транспорт: результат команды едет на сервер
 * HTTP-ом и base64 раздувает байты на треть, поэтому кусок должен уверенно
 * влезать в `maxBodyBytes` (1 МиБ по умолчанию). 256 КиБ дают ~350 КиБ тела.
 */
export const DEFAULT_CHUNK = 256 * 1024
/** Потолок файла за один вызов: защита от «скопируй мне всё». */
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

/** Разрешён ли путь: сессия всегда, плюс явно перечисленные каталоги. */
export function insideSelf (path, roots) {
  const target = resolvePath(path)
  return roots.some((root) => target === resolvePath(root) || target.startsWith(resolvePath(root) + '/'))
}

/**
 * Прочитать кусок с хоста.
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
 * Записать кусок на хост: пишем в `<path>.inprogress`, последний переименовывает.
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
  // режим берём у существующего файла: перезапись не должна молча его менять
  let mode
  try {
    mode = statSync(path).mode & 0o777
  } catch {}
  renameSync(part, path)
  return { written: chunk.length, complete: true, mode: mode ?? null, size: statSync(path).size }
}

/** Хеш файла на хосте. */
export function selfHash (path) {
  return { sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), size: statSync(path).size }
}

/**
 * Копировать файл потоком: источник → приёмник, кусками, без промежуточного диска.
 *
 * @param {object} options
 * @param {object} options.source `{stat, read}` — откуда читать
 * @param {object} options.target `{write, hash}` — куда писать
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

/** Путь по умолчанию внутри каталога сессии. */
export function joinSelf (root, path) {
  return path.startsWith('/') ? path : join(root, path)
}
