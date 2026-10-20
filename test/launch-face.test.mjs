/** B4 launch-face unit tests (single launch source / host-platform default /
 * #24 target guard): design §9.4 cases 43–49 and the six faces of §6.3. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'

import { currentPlatform, resolveChildArgv, resolveLaunchArgv } from '../src/platform.mjs'
import { createProvider, resolveBehaviourSpec } from '../src/provider.mjs'
import { listWorkspaceSessions } from '../src/driver.mjs'

const POSIX = 'linux'
const WIN = 'win32'
const SHIM = 'C:\\Program Files\\nodejs\\thincoder.cmd'
const LEAVES = ['args', 'command', 'env']
const CONFIG = { command: 'thincoder', args: ['acp'], env: {}, permission: 'reject', disposeEofGraceMs: 6000, disposeGraceMs: 3000 }

/** A stubbed subprocess seam: it records both verbs and starts nothing. */
function stubSeam(resolveImpl, spawnImpl) {
  const calls = { resolve: [], spawn: [] }
  return { calls,
    resolveExecutable: async (command, env) => { calls.resolve.push({ command, env }); return resolveImpl(command) },
    spawn: (spec) => { calls.spawn.push(spec); return spawnImpl === undefined ? { stdin: {}, stdout: {} } : spawnImpl(spec) } }
}

/** A fake ACP peer answering `initialize` / `session/new` / `session/list` / `session/close`. */
function fakeAcpChild(sessions = []) {
  const results = { initialize: { protocolVersion: 1, agentCapabilities: {} }, 'session/new': { sessionId: '7' }, 'session/list': { sessions }, 'session/close': {} }
  const stdout = new Readable({ read() {} })
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const entry of String(chunk).split('\n')) {
        if (entry.trim() === '') continue
        const message = JSON.parse(entry)
        if (results[message.method] !== undefined) setTimeout(() => { stdout.push(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: results[message.method] })}\n`) }, 0)
      }
      callback()
    },
  })
  return { child: { stdin, stdout, terminate() {}, waitForExit: async () => true, done: Promise.resolve({ exitCode: 0 }) } }
}

/** Wrap a spec so every read is recorded; `leaves()` = the behaviour-leaf keys the façade read. */
function spySpec(spec) {
  const read = []
  const proxy = new Proxy(spec, { get(target, key) { if (typeof key === 'string') read.push(key); return target[key] } })
  return { proxy, leaves: () => [...new Set(read)].filter((key) => LEAVES.includes(key)).sort() }
}

/** The delegation face's behaviour object and the enumeration face's tool-built spec. */
function faces(ctx) {
  const behaviour = resolveBehaviourSpec(CONFIG)
  return { behaviour, listing: { ctx, ...behaviour, cwd: process.cwd() } }
}

/** Both faces, one source: seam argv = façade output, and the façade reads only the three leaves. */
async function assertSingleSource(spec, spawnArgv) {
  assert.deepEqual(spawnArgv, ['thincoder', 'acp'])
  const seam = stubSeam((command) => command)
  assert.deepEqual(await resolveChildArgv(seam, spec), spawnArgv)
  const captured = spySpec(spec)
  await resolveChildArgv(seam, captured.proxy)
  assert.deepEqual(captured.leaves(), ['args', 'command', 'env'])
}

test('[43] delegation face: the seam argv is the façade output and the input shape is the three leaves', async () => {
  const { behaviour } = faces()
  const { child } = fakeAcpChild()
  const spawned = []
  const subprocess = { resolveExecutable: async (command) => command, spawn: (spec) => { spawned.push(spec); return child } }
  const provider = createProvider({ subprocess }, CONFIG, { lookup: () => undefined, remember: async () => {} })
  await provider.start({
    prompt: [{ type: 'text', text: 'hi' }],
    cwd: process.cwd(),
    signal: new AbortController().signal,
    parent: { session: { id: 'p', header: { cwd: process.cwd() } } },
  })
  await assertSingleSource(behaviour, spawned[0].argv)
})

test('[44] enumeration face: same argv, same behaviour-leaf key set (one input shape)', async () => {
  const spawned = []
  const subprocess = { resolveExecutable: async (command) => command, spawn: (spec) => { spawned.push(spec); return fakeAcpChild().child } }
  const { listing } = faces({ subprocess })
  await listWorkspaceSessions({ signal: new AbortController().signal }, listing)
  await assertSingleSource(listing, spawned[0].argv)
})

test('[45] one definition + one call of resolveLaunchArgv; one process.platform read', () => {
  const dir = new URL('../src/', import.meta.url)
  let launch = 0
  let platform = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.mjs')) continue
    const text = readFileSync(new URL(name, dir), 'utf8')
    launch += (text.match(/resolveLaunchArgv\(/gu) ?? []).length
    platform += (text.match(/process\.platform/gu) ?? []).length
  }
  assert.equal(launch, 2)
  assert.equal(platform, 1)
})

test('[46] omitting platform resolves against the host platform', async () => {
  const seam = stubSeam((command) => command)
  const omitted = await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: {} })
  const explicit = await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: {}, platform: currentPlatform() })
  assert.deepEqual(omitted, explicit)
  assert.deepEqual(omitted, ['thincoder', 'acp'])
})

test('[47] #24 guard: a win32 target that is empty or a non-string is refused, spawning nothing', async () => {
  for (const bad of ['', undefined, 42]) {
    const seam = stubSeam(() => bad)
    await assert.rejects(() => resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: {}, platform: WIN }), /could not launch "thincoder"/u)
    assert.equal(seam.calls.spawn.length, 0)
  }
})

test('[48] the guard leaves the reachable win32 paths byte-identical', async () => {
  const seam = stubSeam((command) => (command === 'thincoder' ? SHIM : command))
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: { ComSpec: 'C:\\cmd.exe' }, platform: WIN }), ['C:\\cmd.exe', '/d', '/s', '/c', 'call', SHIM, 'acp'])
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder.exe', args: ['acp'], env: {}, platform: WIN }), ['thincoder.exe', 'acp'])
})

test('[49] on POSIX a resolver returning an empty string is never probed and never throws', async () => {
  const seam = stubSeam(() => '')
  assert.deepEqual(await resolveLaunchArgv({ subprocess: seam, command: 'thincoder', args: ['acp'], env: {}, platform: POSIX }), ['thincoder', 'acp'])
  assert.equal(seam.calls.resolve.length, 0)
})

// ---------------------------------------------------------------------------
// B12 host-cwd contract (added 2026-10-20).
//
// After the cwd-authority move, `provider.start` refuses an absent `request.cwd`
// BEFORE it reaches the launch face. This guard is platform-independent, so it
// is proven here on every host — including Windows CI, where the win32-only case
// in platform-win32.test.mjs exercises the launch path with a cwd supplied.

test('[B12] provider.start refuses an empty host cwd before any launch', async () => {
  const spawned = []
  const subprocess = {
    resolveExecutable: async (command) => command,
    spawn: (spec) => { spawned.push(spec); return { stdin: {}, stdout: {} } },
  }
  const provider = createProvider({ subprocess }, CONFIG, { lookup: () => undefined, remember: async () => {} })
  for (const cwd of [undefined, '']) {
    await assert.rejects(
      () => provider.start({
        prompt: [{ type: 'text', text: 'hi' }],
        ...(cwd === undefined ? {} : { cwd }),
        parent: { session: { id: 'p', header: { cwd: process.cwd() } } },
      }),
      /host resolved no working directory/,
      `cwd ${JSON.stringify(cwd)} must be refused`,
    )
  }
  // Nothing was resolved and nothing was spawned: the refusal precedes the launch face.
  assert.equal(spawned.length, 0)
})
