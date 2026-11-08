/**
 * Передача файлов между узлом и хостом по HTTP, без команд на каждый кусок.
 *
 * Один запрос вместо сотни: куски ехали base64 (+33% объёма) и по одному
 * round-trip на каждый мегабайт. Здесь тело запроса — сами байты, а ответ —
 * поток с `content-length` и `x-sha256`.
 *
 * Разрешение на передачу даёт **команда**: сервер выдал узлу команду с номером,
 * команда ещё не закрыта, путь и режим лежат в её аргументах. Отдельного билета
 * нет — билетом служит сама команда, поэтому «нет такой команды» означает
 * «нельзя», а не «повтори позже».
 *
 * Запись идёт в `<path>.inprogress` и переименовывается только после сверки
 * размера и sha256: файл либо появляется целиком, либо не появляется.
 *
 * @module dsh-nodes/transfer
 */
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Отказ с кодом HTTP и текстом, который модель прочитает и поймёт. */
export class TransferError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Предел одной передачи: по умолчанию 512 МиБ. */
export function transferLimit (config) {
  return Number(config?.maxTransferBytes) > 0 ? Number(config.maxTransferBytes) : 512 * 1024 * 1024
}

/**
 * Проверить, что номер принадлежит выданной команде этого узла.
 *
 * @returns {object} команда из очереди
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
  if (command.method !== method) {
    throw new TransferError(403, 'wrong_command', `команда ${number} — это ${command.method}, а передача требует ${method}: начни с вызова ${method}`)
  }
  return command
}

/** Путь берём из команды, а не из запроса: иначе политику не обойти. */
export function commandPath (command) {
  // `path` — сторона узла, `hostPath` — наша: для загрузки это разные файлы
  const path = command?.args?.hostPath ?? command?.args?.path
  if (!path) throw new TransferError(412, 'no_path', 'в команде нет пути: некуда записывать файл')
  return String(path)
}

/** Режим: узел присылает права оригинала, мы оставляем только маску 0o777. */
export function commandMode (command, raw) {
  const value = raw ?? command?.args?.mode
  if (value === undefined || value === null || value === '') return null
  // «644» приходит строкой и означает восьмеричное 0o644, а число из statSync —
  // уже готовую маску (0o644 = 420). Различаем по величине: маска не больше 511.
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 8)
    return Number.isFinite(parsed) && parsed > 0 ? parsed & 0o777 : null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return number > 0o777 ? Number.parseInt(String(number), 8) & 0o777 : number & 0o777
}

/**
 * Принять тело запроса в файл.
 *
 * @param {object} options
 * @param {Request} options.request
 * @param {object} options.command
 * @param {number|null} options.mode
 * @param {object} options.config
 * @returns {Promise<{path: string, bytes: number, sha256: string, mode: number}>}
 */
export async function receive ({ request, command, mode, config }) {
  const target = commandPath(command)
  const expected = Number(command?.args?.size) > 0 ? Number(command.args.size) : null
  const limit = transferLimit(config)
  const declared = Number(request.headers.get('content-length'))
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new TransferError(411, 'length_required', 'нужен заголовок content-length: без него нельзя отличить оборванную передачу от целой')
  }
  if (declared > limit) {
    throw new TransferError(413, 'too_big', `файл ${declared} байт больше предела ${limit}: подними maxTransferBytes или передавай кусками`)
  }
  if (expected !== null && declared !== expected) {
    throw new TransferError(412, 'size_mismatch', `в команде ${expected} байт, а в запросе ${declared}: команда и передача разошлись`)
  }
  if (!request.body) throw new TransferError(400, 'empty_body', 'тело запроса пустое: передавать нечего')

  const part = `${target}.inprogress`
  mkdirSync(dirname(part), { recursive: true })
  const hash = createHash('sha256')
  // тело читаем потоком: файл не держим в памяти и хеш считаем по дороге
  const stream = Readable.fromWeb(request.body)
  stream.on('data', (chunk) => hash.update(chunk))
  try {
    await pipeline(stream, createWriteStream(part, { mode: 0o600 }))
  } catch (error) {
    try {
      unlinkSync(part)
    } catch {}
    throw new TransferError(400, 'transfer_failed', `тело запроса оборвалось: ${error.message}`)
  }

  const bytes = statSync(part).size
  if (bytes !== declared) {
    try {
      unlinkSync(part)
    } catch {}
    throw new TransferError(400, 'incomplete', `пришло ${bytes} из ${declared} байт: передача оборвана, файл не записан`)
  }
  const sha256 = hash.digest('hex')
  const promised = String(request.headers.get('x-sha256') ?? command?.args?.sha256 ?? '')
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
  renameSync(part, target)
  return { path: target, bytes, sha256, mode: final }
}

/** Проверить, что файл есть и это файл; вернуть размер. */
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

/** Ответ с файлом: поток плюс размер и хеш в заголовках. */
export function fileResponse ({ path, bytes, sha256 }) {
  return new Response(Readable.toWeb(createReadStream(path)), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes),
      // кешировать передачу файла нельзя: за тем же адресом будет другой файл
      'cache-control': 'no-store',
      ...(sha256 ? { 'x-sha256': sha256 } : {}),
    },
  })
}
