/** B2 platform unit tests (P9 / P10) — design §9.2 cases 15–32 and the seven change
 * faces, with the platform injected and the seam stubbed: nothing starts, and the
 * Windows rules run on any host. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { resolve } from 'node:path'

import { isBatchTarget, keyPath, resolveLaunchArgv } from '../src/platform.mjs'
import { linkKey } from '../src/session-store.mjs'
import { launchError } from '../src/errors.mjs'
import { spawnChild } from '../src/connection.mjs'
import { createProvider } from '../src/provider.mjs'
import { createSessionsTool } from '../src/tools.mjs'
import { startThincoderRun } from '../src/driver.mjs'

const WIN = 'win32'
const POSIX = 'linux'
const IS_WIN = process.platform === 'win32'
const SHIM = 'C:\\Program Files\\nodejs\\thincoder.cmd'
const X86 = 'C:\\Program Files (x86)\\nodejs\\thincoder.cmd'
const EXE = 'C:\\tools\\thincoder.exe'
const CMD = 'C:\\Windows\\system32\\cmd.exe'
const GRACES = { disposeEofGraceMs: 6000, disposeGraceMs: 3000 }

/** The win32 lookup: the npm shim, an .exe, or any interpreter — else a miss. */
function lookupCommand(command) {
  const key = String(command).toLowerCase()
  if (key === 'thincoder') return SHIM
  if (key === 'thincoder.exe') return EXE
  if (key.endsWith('cmd.exe')) return CMD
  throw new Error(`subprocess-local: command ${command} was not found on PATH`)
}

/** A stubbed subprocess seam: it records both verbs and starts nothing. */
function stubSeam(lookup = lookupCommand) {
  const calls = { resolve: [], spawn: [] }
  return { calls,
    resolveExecutable: async (command, env) => { calls.resolve.push({ command, env }); return lookup(command) },
    spawn: (spec) => { calls.spawn.push(spec); return { stdin: {}, stdout: {} } } }
}

const launch = ({ seam = stubSeam(), command = 'thincoder', args = ['acp'], env = {}, platform = WIN } = {}) =>
  resolveLaunchArgv({ subprocess: seam, command, args, env, platform })

/** A tool execution context, and a delegating parent carrying one workspace. */
function toolExec(agent) { return { agent, signal: new AbortController().signal } }
function fakeParent(cwd) { return { session: { id: 'p1', header: { cwd } } } }

/** A fake ACP peer answering `initialize` / `session/new` / `session/close`. */
function fakeAcpChild(sessionId = '7') {
  const requests = []
  const results = { initialize: { protocolVersion: 1, agentCapabilities: {} }, 'session/new': { sessionId }, 'session/close': {} }
  const stdout = new Readable({ read() {} })
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const entry of String(chunk).split('\n')) {
        if (entry.trim() === '') continue
        const message = JSON.parse(entry)
        requests.push(message)
        if (results[message.method] !== undefined) setTimeout(() => { stdout.push(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: results[message.method] })}\n`) }, 0)
      }
      callback()
    },
  })
  return { requests, child: { stdin, stdout, terminate() {}, waitForExit: async () => true, done: Promise.resolve({ exitCode: 0 }) } }
}

test('platform: the win32 packaging matrix (15–20, 28, 29), POSIX verbatim', async () => {
  const seam = stubSeam()
  assert.deepEqual(await launch({ seam }), [CMD, '/d', '/s', '/c', 'call', SHIM, 'acp'])
  const args = ['a b', 'a"b', 'C:\\dir with space\\', '中文 参数']
  assert.deepEqual(await launch({ seam, args }), [CMD, '/d', '/s', '/c', 'call', SHIM, ...args])
  assert.deepEqual(await launch({ command: 'thincoder.exe' }), [EXE, 'acp'])
  const x86 = stubSeam((command) => (command === 'thincoder' ? X86 : lookupCommand(command)))
  assert.deepEqual(await launch({ seam: x86, args: ['c(b)'] }), [CMD, '/d', '/s', '/c', 'call', X86, 'c(b)'])
  const posix = stubSeam()
  assert.deepEqual(await launch({ seam: posix, args: ['a&b', '%PATH%'], platform: POSIX }), ['thincoder', 'a&b', '%PATH%'])
  assert.equal(posix.calls.resolve.length + posix.calls.spawn.length, 0)
})

test('win32: an args metacharacter (21) or an unresolvable name (22–24) is refused', async () => {
  const seam = stubSeam()
  for (const character of ['%', '&', '|', '<', '>', '^']) {
    await assert.rejects(() => launch({ seam, args: [`a${character}b`] }),
      (error) => error.message.includes(JSON.stringify(character)) && error.message.includes('could not launch'))
  }
  assert.equal(seam.calls.resolve.length + seam.calls.spawn.length, 0)
  await assert.rejects(() => launch({ seam, command: 'nope' }), /could not launch "nope"/)
  await assert.rejects(() => launch({ seam, command: 'thincoder acp', args: [] }), /could not launch "thincoder acp"/)
  const noInterpreter = stubSeam((command) => (command === 'thincoder' ? SHIM : lookupCommand('miss')))
  await assert.rejects(() => launch({ seam: noInterpreter }), /no command interpreter could be resolved/)
  assert.equal(seam.calls.spawn.length + noInterpreter.calls.spawn.length, 0)
})

test('win32: the interpreter candidates resolve in the pinned order (30–32)', async () => {
  const saved = process.env.ComSpec; process.env.ComSpec = 'C:\\Host\\cmd.exe'
  const self = (name) => (name === 'thincoder' ? SHIM : String(name))
  try {
    const configured = stubSeam(self); const a = await launch({ seam: configured, env: { ComSpec: 'C:\\Configured\\cmd.exe' } })
    const host = stubSeam(self); const b = await launch({ seam: host }); delete process.env.ComSpec
    const bare = stubSeam(self); const c = await launch({ seam: bare })
    assert.deepEqual([a[0], b[0], c[0]], ['C:\\Configured\\cmd.exe', 'C:\\Host\\cmd.exe', 'cmd.exe'])
  } finally { if (saved === undefined) delete process.env.ComSpec; else process.env.ComSpec = saved }
})

test('P10: the key folds case (25, 26) and the fold never touches the real cwd (27)', async () => {
  assert.equal(linkKey('dsh-1', resolve('WS'), WIN), linkKey('dsh-1', resolve('ws'), WIN))
  assert.notEqual(linkKey('dsh-1', resolve('WS'), POSIX), linkKey('dsh-1', resolve('ws'), POSIX))
  assert.equal(keyPath('C:\\WS', WIN) + keyPath('C:\\WS', POSIX), 'c:\\wsC:\\WS')
  assert.deepEqual(['x.CMD', 'a.bat', 'x.exe', 'x'].map(isBatchTarget), [true, true, false, false])
  const { child, requests } = fakeAcpChild(); const remembered = []; const cwd = resolve('Mixed', 'Case')
  await startThincoderRun(
    { prompt: [{ type: 'text', text: 'hi' }], signal: new AbortController().signal },
    { ctx: { subprocess: { spawn: () => child } }, argv: ['thincoder', 'acp'], cwd, env: {}, permission: 'reject', parentSessionId: 'p', choice: {}, ...GRACES,
      store: { lookup: () => undefined, remember: async (key, record) => { remembered.push({ key, record }) } } },
  )
  assert.equal(remembered[0].record.cwd, cwd)
  assert.equal(requests.find((message) => message.method === 'session/new').params.cwd, cwd)
  assert.equal(remembered[0].key, `p\u0000${IS_WIN ? cwd.toLowerCase() : cwd}`)
})

test('connection + errors: spawnChild passes argv through, launchError names and bounds', () => {
  const seam = stubSeam()
  spawnChild({ subprocess: seam }, { argv: ['a', 'b c'], cwd: '/w', env: {}, disposeGraceMs: 3000 })
  assert.deepEqual(seam.calls.spawn[0], { argv: ['a', 'b c'], cwd: '/w', stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' }, graceMs: 3000, env: {} })
  const message = launchError('thincoder', `boom ${'x'.repeat(3000)}`).message
  assert.ok(message.includes('could not launch "thincoder"') && message.includes('check the `command`') && message.length < 1200)
})

test('zero process: an unresolvable argv starts nothing on either face', { skip: !IS_WIN }, async () => {
  const fail = () => { throw new Error('subprocess-local: command was not found on PATH') }
  const delegation = stubSeam(fail)
  const provider = createProvider({ subprocess: delegation, logger: { warn: () => {} } }, { cwd: process.cwd(), ...GRACES }, {})
  // B12 (2026-10-20): the host now resolves the directory and hands it in as
  // `request.cwd`. Without it the provider refuses earlier — with a cwd message,
  // not the launch message this case asserts — so it must be supplied here.
  await assert.rejects(
    () => provider.start({ prompt: [], cwd: process.cwd(), parent: fakeParent(process.cwd()) }),
    /could not launch/,
  )
  const listing = stubSeam(fail); const tool = createSessionsTool({ ctx: { subprocess: listing }, config: { cwd: process.cwd(), ...GRACES } })
  await assert.rejects(() => tool.execute({}, toolExec(fakeParent(process.cwd()))), /could not launch/)
  assert.equal(delegation.calls.spawn.length + listing.calls.spawn.length, 0)
})

// ---------------------------------------------------------------------------
// P10 host-scope coverage boundary.
//
// `linkKey` calls node:path's `resolve()`, which is bound to the HOST platform.
// On a POSIX host it treats `C:\Work\WS` as a RELATIVE path and prepends the
// process cwd, so a win32-shaped absolute path cannot be exercised faithfully
// off Windows. These two cases pin down exactly what IS testable here, so the
// gap is visible instead of silently assumed covered:
//
//   - the FOLD itself (keyPath) is pure and fully covered on any host;
//   - the RESOLVE step is host-bound and is only proven on Windows.

test('P10: keyPath folds win32 case and is host-independent (covered on any host)', () => {
  // The fold is a pure string transform: no fs, no platform binding.
  assert.equal(keyPath('C:\\Work\\WS', WIN), 'c:\\work\\ws')
  assert.equal(keyPath('C:/Work/WS', WIN), 'c:/work/ws')
  assert.equal(keyPath('C:\\Work\\WS', POSIX), 'C:\\Work\\WS')
  // Two case forms of one Windows workspace fold to one key.
  assert.equal(keyPath('C:\\Work\\WS', WIN), keyPath('c:\\work\\ws', WIN))
  // UNC paths fold the same way.
  assert.equal(keyPath('\\\\SERVER\\Share\\WS', WIN), '\\\\server\\share\\ws')
})

test('P10: the resolve() step is host-bound — off Windows a win32 path is relative (KNOWN GAP)', () => {
  // Documents the boundary rather than asserting a win32 outcome on POSIX.
  // On Windows, resolve('C:\\Work\\WS') === 'C:\\Work\\WS' and the key is
  // 'c:\\work\\ws'. On POSIX the same call prepends the process cwd, so the
  // key differs. This test therefore asserts the POSIX behaviour only, and is
  // skipped on Windows where the meaningful assertion is the one above.
  if (IS_WIN) return
  const key = linkKey('s', 'C:\\Work\\WS', WIN, (p) => p)
  const [, folded] = key.split('\u0000')
  // The value reachable on this host is the cwd-prefixed, folded form: the
  // fold is provable here, the absolute-path resolution is not.
  assert.equal(folded, resolve('C:\\Work\\WS').toLowerCase())
  assert.notEqual(folded, 'c:\\work\\ws')
  // Distinct Windows workspaces still yield distinct keys (no accidental merge).
  assert.notEqual(
    linkKey('s', 'C:\\Work\\WS', WIN, (p) => p),
    linkKey('s', 'D:\\Other\\WS', WIN, (p) => p),
  )
})

test('P10: realpath normalisation is host-bound too, and falls back without throwing', () => {
  // canonicalPath on a nonexistent path falls back to the input; on Windows a
  // real directory would be resolved by realpathSync.native. Only the fallback
  // is provable off Windows, and it is proven here.
  const ghost = `${WIN === 'win32' ? 'C:\\' : '/'}nonexistent-${Math.random().toString(36).slice(2)}`
  assert.doesNotThrow(() => linkKey('p', ghost, WIN))
  assert.equal(linkKey('p', ghost, WIN, (p) => p).split('\u0000')[1], keyPath(resolve(ghost), WIN))
})
