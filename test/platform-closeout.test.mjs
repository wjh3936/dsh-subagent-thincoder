/** B3 platform-closeout unit tests (P10 key normalisation / P9 ComSpec read):
 * design §9.3 cases 33–42 and the ten change faces. Stub-injection faces run
 * everywhere; real probes self-check the volume and skip when it cannot. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { canonicalPath, resolveLaunchArgv } from '../src/platform.mjs'
import { linkKey } from '../src/session-store.mjs'
import { startThincoderRun } from '../src/driver.mjs'

const WIN = 'win32'
const POSIX = 'linux'
const SHIM = 'C:\\Program Files\\nodejs\\thincoder.cmd'

/** A temp directory the test removes on the way out. */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'b3-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A stubbed subprocess seam recording both verbs; `resolveImpl` decides each name. */
function stubSeam(resolveImpl) {
  const calls = { resolve: [], spawn: [] }
  return { calls,
    resolveExecutable: async (command, env) => { calls.resolve.push({ command, env }); return resolveImpl(command) },
    spawn: (spec) => { calls.spawn.push(spec); return { stdin: {}, stdout: {} } } }
}

/** A fake ACP peer answering `initialize` / `session/new` / `session/close`. */
function fakeAcpChild(sessionId = '7') {
  const requests = []
  const results = { initialize: { protocolVersion: 1, agentCapabilities: {} }, 'session/new': { sessionId }, 'session/close': {} }
  const stdout = new Readable({ read() {} })
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const entry of String(chunk).split('\n').filter((line) => line.trim() !== '')) {
        const message = JSON.parse(entry)
        requests.push(message)
        if (results[message.method] !== undefined) setTimeout(() => { stdout.push(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: results[message.method] })}\n`) }, 0)
      }
      callback()
    },
  })
  return { requests, child: { stdin, stdout, terminate() {}, waitForExit: async () => true, done: Promise.resolve({ exitCode: 0 }) } }
}

test('[1] canonicalPath: a symlink alias resolves to its target, an unreadable path is returned as given', (t) => {
  const dir = tempDir(t)
  const target = join(dir, 'Real'); mkdirSync(target)
  const link = join(dir, 'Alias')
  let linked = true
  try { symlinkSync(target, link, 'dir') } catch { linked = false; t.diagnostic('symlink refused — alias assertion skipped') }
  if (linked) {
    assert.equal(canonicalPath(link), canonicalPath(target))
    assert.notEqual(canonicalPath(link), link)
  }
  const ghost = join(dir, `gone-${randomUUID()}`)
  assert.equal(canonicalPath(ghost), ghost)
})

test('[2] linkKey: the injected normaliser decides the case semantics (33, 34)', () => {
  const insensitive = (path) => path.toLowerCase()
  assert.equal(linkKey('p', '/x/WS', POSIX, insensitive), linkKey('p', '/x/ws', POSIX, insensitive))
  assert.notEqual(linkKey('p', '/x/WS', POSIX, (path) => path), linkKey('p', '/x/ws', POSIX, (path) => path))
})

test('[3] real filesystem case probe: two case forms of one directory (35)', (t) => {
  const dir = tempDir(t)
  const mixed = join(dir, 'Mixed'); mkdirSync(mixed)
  const canonical = canonicalPath(mixed)
  const folds = canonicalPath(join(dir, 'mixed')) === canonical && canonicalPath(join(dir, 'MIXED')) === canonical
  if (!folds) { t.skip('this volume is case-sensitive — the stub-injection face carries AC-12'); return }
  assert.equal(linkKey('p', mixed, POSIX), linkKey('p', join(dir, 'mixed'), POSIX))
})

test('[4] linkKey: a symlink alias and its target make one key (36)', (t) => {
  // Platform-neutral alias stub: the injected normaliser maps one REAL absolute
  // path onto another. Hard-coding '/tmp/ws' would make this case POSIX-only —
  // on Windows node:path resolves that string to '<drive>:\\tmp\\ws', so the
  // stub's exact-match never fires and the assertion compares two distinct paths.
  const base = tempDir(t)
  const aliasPath = join(base, 'ws')
  const targetPath = join(base, 'private', 'ws')
  const aliasOnly = (path) => (path === aliasPath ? targetPath : path)
  assert.equal(linkKey('p', aliasPath, POSIX, aliasOnly), linkKey('p', targetPath, POSIX, aliasOnly))
  const dir = tempDir(t)
  const target = join(dir, 'Real')
  mkdirSync(target)
  const link = join(dir, 'Alias')
  try { symlinkSync(target, link, 'dir') } catch { t.diagnostic('symlink refused — real alias fixture skipped'); return }
  assert.equal(linkKey('p', link, POSIX), linkKey('p', target, POSIX))
})

test('[5] linkKey: a throwing or unreadable normaliser falls back and never throws (37)', () => {
  const boom = () => { throw new Error('unreadable') }
  // A real absolute path on THIS host, so the fallback assertion is meaningful
  // on Windows too (a POSIX literal would resolve against the drive root there).
  const ws = resolve(join(tmpdir(), 'ws'))
  assert.equal(linkKey('p', ws, POSIX, boom), `p\u0000${ws}`)
  assert.doesNotThrow(() => linkKey('p', ws, WIN, boom))
  assert.equal(linkKey('p', ws, WIN, boom), `p\u0000${ws.toLowerCase()}`)
  const ghost = `/nonexistent-${randomUUID()}`
  assert.equal(linkKey('p', ghost, POSIX), `p\u0000${ghost}`)
})

test('[6] the normalisation reaches the key only — never the recorded or child cwd (38)', async (t) => {
  const cwd = tempDir(t)
  const { child, requests } = fakeAcpChild()
  const remembered = []
  await startThincoderRun(
    { prompt: [{ type: 'text', text: 'hi' }], signal: new AbortController().signal },
    { ctx: { subprocess: { spawn: () => child } }, argv: ['thincoder', 'acp'], cwd, env: {}, permission: 'reject', parentSessionId: 'p', choice: {},
      disposeEofGraceMs: 6000, disposeGraceMs: 3000,
      store: { lookup: () => undefined, remember: async (key, record) => { remembered.push({ key, record }) } } },
  )
  assert.equal(remembered[0].record.cwd, cwd)
  assert.equal(requests.find((message) => message.method === 'session/new').params.cwd, cwd)
  assert.equal(remembered[0].key, linkKey('p', cwd))
  // Host-dependent: when the temp dir canonicalises to itself, say the split is not shown.
  if (canonicalPath(cwd) !== cwd) assert.notEqual(remembered[0].key, `p\u0000${cwd}`)
  else t.diagnostic('the temp dir canonicalises to itself here — the key-vs-cwd split is not discriminating')
})

test('[7] resolveLaunchArgv: the win32 packaging and the POSIX verbatim path are unchanged', async () => {
  const seam = stubSeam((command) => (command === 'thincoder' ? SHIM : command))
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: { ComSpec: 'C:\\cmd.exe' }, platform: WIN }), ['C:\\cmd.exe', '/d', '/s', '/c', 'call', SHIM, 'acp'])
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder.exe', args: ['acp'], env: {}, platform: WIN }), ['thincoder.exe', 'acp'])
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['a&b'], env: {}, platform: POSIX }), ['thincoder', 'a&b'])
})

test('[8] win32 ComSpec reads are case-insensitive; the candidate order is unchanged (39–42)', async () => {
  const seam = stubSeam((command) => (command === 'thincoder' ? SHIM : String(command)))
  const run = (env) => resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: [], env, platform: WIN })
  const CONFIG = 'C:\\Conf\\cmd.exe'
  assert.equal((await run({ COMSPEC: CONFIG }))[0], CONFIG)
  assert.equal((await run({ COMSPEC: CONFIG }))[0], (await run({ ComSpec: CONFIG }))[0])
  assert.equal((await run({ ComSpec: CONFIG, COMSPEC: 'C:\\Upper\\cmd.exe' }))[0], CONFIG)
  const saved = process.env.ComSpec
  process.env.ComSpec = 'C:\\Host\\cmd.exe'
  try {
    assert.equal((await run({}))[0], 'C:\\Host\\cmd.exe')
    delete process.env.ComSpec
    assert.equal((await run({}))[0], 'cmd.exe')
  } finally { if (saved === undefined) delete process.env.ComSpec; else process.env.ComSpec = saved }
  const before = seam.calls.resolve.length
  // Case 41's observable form: POSIX never reads ComSpec (verbatim argv, zero probes).
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: { COMSPEC: CONFIG }, platform: POSIX }), ['thincoder', 'acp'])
  assert.equal(seam.calls.resolve.length, before)
})

test('[9] linkKey validates before it normalises — an invalid call never reaches the normaliser', () => {
  let calls = 0
  const spy = (path) => { calls += 1; return path }
  assert.throws(() => linkKey('', '/w', POSIX, spy), /non-empty parent session id/)
  assert.throws(() => linkKey('p', '', POSIX, spy), /non-empty workspace path/)
  assert.equal(calls, 0)
})

test('[10] frozen-face guard: the fixture path does not exist, so frozen keys keep their form (40)', () => {
  // B1/B2 freeze the key form for a workspace that does NOT resolve on disk
  // (so canonicalPath falls back to the resolved string). This asserts the
  // precondition on THIS host rather than hard-coding a POSIX path — on Windows
  // '/tmp/ws' would silently mean '<drive>:\tmp\ws', a different question.
  const nonexistent = join(tmpdir(), `b3-absent-${randomUUID()}`)
  assert.equal(existsSync(nonexistent), false)
  assert.equal(canonicalPath(nonexistent), nonexistent)
})
