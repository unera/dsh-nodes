import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { canonical, checked, inside } from '../lib/paths.mjs'
import { authorizedPath } from '../lib/transfer.mjs'

/**
 * The host side of a transfer used to be trusted: `nodes_call` could name any `hostPath`, and the
 * server wrote that file as itself. These tests pin the three ways out of a directory — `..`, a
 * symlink, and a sibling whose name merely starts with the root's.
 */
function fixture () {
  const base = mkdtempSync(join(tmpdir(), 'dsh-paths-'))
  const root = join(base, 'root')
  const outside = join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret'), 'x')
  symlinkSync(outside, join(root, 'link'))
  return { base, root, outside }
}

test('a path inside the root is allowed and comes back canonical', () => {
  const { root } = fixture()
  assert.equal(inside([root], join(root, 'a.txt')), true)
  assert.equal(checked([root], join(root, 'a.txt')), canonical(join(root, 'a.txt')))
})

test('parent segments do not escape the root', () => {
  const { root, outside } = fixture()
  assert.equal(inside([root], join(root, '..', 'outside', 'secret')), false)
  assert.throws(() => checked([root], join(outside, 'secret')), /вне разрешённых каталогов/)
})

test('a symlink does not escape the root', () => {
  const { root } = fixture()
  // the path looks inside, but it resolves outside: that is the whole point of canonicalising
  assert.equal(inside([root], join(root, 'link', 'secret')), false)
  assert.throws(() => checked([root], join(root, 'link', 'secret')), /вне разрешённых каталогов/)
})

test('a sibling with a common prefix is not the root', () => {
  const { base, root } = fixture()
  assert.equal(inside([root], join(base, 'root-evil', 'x')), false)
})

test('a file that does not exist yet is judged by its parent', () => {
  const { root } = fixture()
  assert.equal(inside([root], join(root, 'new', 'file.txt')), true)
})

test('no roots means no permission at all', () => {
  const { root } = fixture()
  assert.throws(() => checked([], join(root, 'a.txt')), /нет разрешённых каталогов/)
})

test('a command without the host stamp is refused, not trusted', () => {
  const { root } = fixture()
  const command = { args: { hostPath: join(root, 'a.txt') } }
  assert.throws(() => authorizedPath(command), (error) => error.code === 'no_authority')
})

test('a stamped command may write inside its roots only', () => {
  const { root, outside } = fixture()
  const inside = { args: { hostPath: join(root, 'a.txt') }, hostRoots: [root] }
  assert.equal(authorizedPath(inside), canonical(join(root, 'a.txt')))

  const escape = { args: { hostPath: join(outside, 'secret') }, hostRoots: [root] }
  assert.throws(() => authorizedPath(escape), (error) => error.code === 'path_denied')
})
