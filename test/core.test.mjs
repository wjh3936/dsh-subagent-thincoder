/**
 * Unit tests for the `dsh-subagent-thincoder` plugin — the ten change faces listed
 * in the design's action table (K1).
 *
 * These are unit tests in the strict sense: every collaborator a face touches
 * is a stub or a fake (a fake subagent run, a fake tool caller, a fake child
 * handle, an in-memory stream), and NO real `thincoder` process is started and
 * no real ACP endpoint is contacted. It lives in the repository's `test/` tree
 * and is run directly (or together with the rest via `npm test`):
 *
 *     node --test test/core.test.mjs
 *
 * The ten faces: config identity-leaf parsing and `readLiveLeaf`; the session
 * store's key and record schema; the stopReason mapping; the error text
 * boundaries; the delegation tool's argument mutual exclusion and returned
 * text; the sessions tool's response parsing; provider cwd resolution and the
 * missing-cwd failure; the connection's teardown ladder and permission answer;
 * the driver's four session-selection criteria; and the plugin identity
 * exports.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { resolve } from 'node:path'

import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'

import {
  Config,
  DEFAULT_PROVIDER_NAME,
  DEFAULT_SESSION_TOOL_NAME,
  DEFAULT_TOOL_NAME,
  readLiveLeaf,
  resolveIdentity,
} from '../src/config.mjs'
import {
  DOMAIN_NAME,
  SESSION_LINKS,
  linkKey,
  linkRecord,
} from '../src/session-store.mjs'
import { acpStopReason } from '../src/stop-reason.mjs'
import {
  boundedText,
  failureDiagnostic,
  permissionDiagnostic,
  sessionError,
} from '../src/errors.mjs'
import { createDelegateTool, createSessionsTool } from '../src/tools.mjs'
import { createProvider, resolveBehaviourSpec, resolveConfiguredCwd } from '../src/provider.mjs'
import { connectChild, disposeChild, permissionResponse } from '../src/connection.mjs'
import { resolveSessionTarget, startThincoderRun } from '../src/driver.mjs'

/** The behaviour leaves a run needs, with the documented defaults. */
function baseConfig() {
  return { disposeEofGraceMs: 6000, disposeGraceMs: 3000 }
}

/** A minimal cancellable tool execution context. */
function toolExec(agent) {
  return { agent, signal: new AbortController().signal }
}

/** A fake delegating agent whose session carries the workspace cwd. */
function fakeParent(cwd = process.cwd()) {
  return { session: { id: 'parent-session-1', header: { cwd } } }
}

/**
 * An in-memory child whose stdin records every frame the client writes, plus a
 * promise that resolves the moment the client writes a complete response frame.
 * Event-driven, so the permission test never polls a wall clock.
 */
function captureWrites() {
  const written = []
  let pending
  const frames = () => written
    .join('')
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      try { return [JSON.parse(line)] } catch { return [] }
    })
  const findResponse = (id) => frames().find(
    (frame) => frame.id === id && (frame.result !== undefined || frame.error !== undefined),
  )
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk))
      if (pending !== undefined) {
        const response = findResponse(pending.id)
        if (response !== undefined) {
          const { resolve } = pending
          pending = undefined
          resolve(response)
        }
      }
      callback()
    },
  })
  const stdout = new Readable({ read() {} })
  return {
    child: { stdin, stdout },
    frames,
    // Waits for the response to THIS request id, so a previously answered
    // request can never satisfy a later wait.
    waitForResponse: (id) => {
      const existing = findResponse(id)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve) => { pending = { id, resolve } })
    },
  }
}

/**
 * A fake ACP peer over an in-memory child: it answers `initialize`,
 * `session/new`, and `session/close`, and records every request it received.
 * It is a stub — no real process, and no real ACP endpoint.
 */
function fakeAcpChild({ sessionId = '7' } = {}) {
  const requests = []
  const stdout = new Readable({ read() {} })
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() === '') continue
        const message = JSON.parse(line)
        requests.push(message)
        let reply
        if (message.method === 'initialize') {
          reply = { jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } }
        } else if (message.method === 'session/new') {
          reply = { jsonrpc: '2.0', id: message.id, result: { sessionId } }
        } else if (message.method === 'session/close') {
          reply = { jsonrpc: '2.0', id: message.id, result: {} }
        }
        if (reply !== undefined) {
          const frame = `${JSON.stringify(reply)}\n`
          setTimeout(() => { stdout.push(frame) }, 0)
        }
      }
      callback()
    },
  })
  const child = {
    stdin,
    stdout,
    terminate() {},
    waitForExit: async () => true,
    done: Promise.resolve({ exitCode: 0, signal: null }),
  }
  return { child, requests }
}

// ---------------------------------------------------------------------------
// Face 1 — config identity-leaf parsing and `readLiveLeaf`
// ---------------------------------------------------------------------------

test('config: readLiveLeaf unwraps a volatile reference and passes plain values through', () => {
  assert.equal(readLiveLeaf({ get: () => 'live' }), 'live')
  assert.equal(readLiveLeaf('plain'), 'plain')
  // A reference object is always truthy, even when it yields a falsy value:
  // a `if (leaf)` read would be wrong, which is why the leaf must be unwrapped.
  assert.equal(readLiveLeaf({ get: () => false }), false)
  assert.equal(readLiveLeaf({ get: () => 0 }), 0)
  assert.equal(readLiveLeaf(undefined), undefined)
})

test('config: identity leaves resolve to plain values while behaviour leaves are references', () => {
  const resolved = Config({})
  assert.equal(typeof resolved.providerName, 'string')
  assert.equal(resolved.providerName, DEFAULT_PROVIDER_NAME)
  assert.equal(resolved.toolName, DEFAULT_TOOL_NAME)
  assert.equal(resolved.sessionToolName, DEFAULT_SESSION_TOOL_NAME)
  // Behaviour leaves come back as live references that `readLiveLeaf` unwraps.
  assert.equal(typeof resolved.command?.get, 'function')
  assert.equal(readLiveLeaf(resolved.command), 'thincoder')
  assert.deepEqual(readLiveLeaf(resolved.args), ['acp'])
  assert.equal(readLiveLeaf(resolved.permission), 'reject')
  assert.equal(readLiveLeaf(resolved.disposeEofGraceMs), 6000)
  assert.equal(readLiveLeaf(resolved.disposeGraceMs), 3000)
})

test('config: resolveIdentity reads the three identity leaves, unwraps references, and falls back', () => {
  assert.deepEqual(
    resolveIdentity({ providerName: 'p', toolName: 't', sessionToolName: 's' }),
    { providerName: 'p', toolName: 't', sessionToolName: 's' },
  )
  assert.deepEqual(
    resolveIdentity({
      providerName: { get: () => 'live' },
      toolName: 't',
      sessionToolName: 's',
    }),
    { providerName: 'live', toolName: 't', sessionToolName: 's' },
  )
  assert.deepEqual(resolveIdentity({}), {
    providerName: DEFAULT_PROVIDER_NAME,
    toolName: DEFAULT_TOOL_NAME,
    sessionToolName: DEFAULT_SESSION_TOOL_NAME,
  })
  assert.deepEqual(
    resolveIdentity({ providerName: '', toolName: '', sessionToolName: '' }),
    {
      providerName: DEFAULT_PROVIDER_NAME,
      toolName: DEFAULT_TOOL_NAME,
      sessionToolName: DEFAULT_SESSION_TOOL_NAME,
    },
  )
})

// ---------------------------------------------------------------------------
// Face 2 — session store key and record schema
// ---------------------------------------------------------------------------

test('session-store: linkKey carries both dimensions and canonicalises the workspace', () => {
  // Platform injected explicitly: this file is the cross-batch regression face and must
  // assert the same (POSIX) semantics on every host. win32 folding is covered by B2's file.
  assert.equal(linkKey('dsh-1', '/tmp/ws', 'linux'), `dsh-1\u0000${resolve('/tmp/ws')}`)
  // Same workspace written three ways must be one key, or continuity is lost.
  assert.equal(linkKey('dsh-1', '/tmp/ws', 'linux'), linkKey('dsh-1', '/tmp/./ws', 'linux'))
  assert.equal(linkKey('dsh-1', '/tmp/ws', 'linux'), linkKey('dsh-1', '/tmp/other/../ws', 'linux'))
  // Different dsh sessions must never share a slot.
  assert.notEqual(linkKey('dsh-1', '/tmp/ws', 'linux'), linkKey('dsh-2', '/tmp/ws', 'linux'))
})

test('session-store: linkKey rejects a missing dimension', () => {
  assert.throws(() => linkKey('', '/tmp/ws'), /non-empty parent session id/)
  assert.throws(() => linkKey('dsh-1', ''), /non-empty workspace path/)
})

test('session-store: the record schema accepts the four fields and rejects malformed records', () => {
  const record = { parentSessionId: 'dsh-1', cwd: '/tmp/ws', sessionId: '7', updatedAt: 1 }
  assert.deepEqual(linkRecord.parse(record), record)
  assert.throws(() => linkRecord.parse({ ...record, sessionId: '' }))
  assert.throws(() => linkRecord.parse({ ...record, updatedAt: 1.5 }))
  assert.throws(() => linkRecord.parse({ parentSessionId: 'dsh-1' }))
})

test('session-store: the domain name is underscore-safe and never the hyphenated name', () => {
  assert.equal(DOMAIN_NAME, 'subagent_thincoder')
  assert.equal(SESSION_LINKS, 'session_links')
  // UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/ — a hyphen would fail at declaration time.
  assert.match(DOMAIN_NAME, /^[a-z][a-z0-9_]*$/)
  assert.ok(!DOMAIN_NAME.includes('-'))
})

// ---------------------------------------------------------------------------
// Face 3 — stopReason mapping
// ---------------------------------------------------------------------------

test('stop-reason: maps every ACP reason and never reports an unclean stop as completed', () => {
  assert.equal(acpStopReason('end_turn'), 'completed')
  assert.equal(acpStopReason('max_tokens'), 'max-tokens')
  assert.equal(acpStopReason('refusal'), 'refusal')
  assert.equal(acpStopReason('cancelled'), 'aborted')
  assert.equal(acpStopReason('max_turn_requests'), 'error')
  assert.equal(acpStopReason('some_future_reason'), 'error')
  assert.equal(acpStopReason(undefined), 'error')
})

// ---------------------------------------------------------------------------
// Face 4 — error text boundaries
// ---------------------------------------------------------------------------

test('errors: boundedText collapses whitespace and bounds length keeping the head', () => {
  assert.equal(boundedText('a\n  b\tc   d'), 'a b c d')
  const long = boundedText('x'.repeat(50), 10)
  assert.equal(long.length, 10)
  assert.ok(long.endsWith('…'))
  // The manifest anchor sits at the head, so a bounded message keeps it.
  const anchored = boundedText('项目不可解析：some detail that follows', 1024)
  assert.ok(anchored.includes('项目不可解析'))
})

test('errors: sessionError keeps thincoder text and names the recovery path', () => {
  const resume = sessionError('resume', '7', 'failed to resume session 7: 项目不可解析')
  assert.match(resume.message, /项目不可解析/)
  assert.match(resume.message, /"7"/)
  assert.match(resume.message, /new: true/)
  assert.match(resume.message, /sessions tool/)

  const list = sessionError('list', undefined, 'AUTH_REQUIRED: no credentials')
  assert.match(list.message, /AUTH_REQUIRED/)
  assert.match(list.message, /could not list sessions/)

  const fresh = sessionError('new', undefined, 'failed to start: 项目不可解析')
  assert.match(fresh.message, /could not start a new thincoder session/)
  assert.match(fresh.message, /项目不可解析/)
})

test('errors: the fixed diagnostics carry only provider-owned facts', () => {
  const failure = failureDiagnostic({
    stage: 'process',
    category: 'process-start',
    outcome: { exitCode: 3, signal: null },
  })
  assert.match(failure, /provider: thincoder/)
  assert.match(failure, /stage: process/)
  assert.match(failure, /category: process-start/)
  assert.match(failure, /exit code: 3/)

  const permission = permissionDiagnostic({ policy: 'reject', request: 'edit', decision: 'denied' })
  assert.match(permission, /policy: reject/)
  assert.match(permission, /request: edit/)
  assert.match(permission, /decision: denied/)
})

// ---------------------------------------------------------------------------
// Face 5 — delegation tool argument mutual exclusion and returned text
// ---------------------------------------------------------------------------

/** Build a delegation tool whose `subagents.startActivation` is captured / faked. */
function delegationTool({ run, onStart } = {}) {
  const calls = []
  const ctx = {
    subagents: {
      async startActivation(spec) {
        calls.push(spec)
        // The provider writes the id at establishment time — the fake does the same (§5.2).
        const carrier = spec.request.thincoderCarrier
        if (carrier !== undefined && run.carrierSessionId !== undefined) carrier.sessionId = run.carrierSessionId
        if (typeof onStart === 'function') onStart(spec)
        return run
      },
    },
  }
  return { tool: createDelegateTool({ ctx, config: {} }), calls }
}

/** A fake activation receipt: a terminal result and an idempotent dispose. */
function fakeRun({ text = 'hello', stopReason = 'completed', sessionId = '7' } = {}) {
  let disposed = 0
  return {
    childId: 'run-1',
    carrierSessionId: sessionId,
    result: Promise.resolve({ output: [{ type: 'text', text }], stopReason }),
    dispose: async () => { disposed += 1 },
    get disposed() { return disposed },
  }
}

test('tools: sessionId and new together are refused before any child starts', async () => {
  let started = 0
  const { tool } = delegationTool({ onStart: () => { started += 1 } , run: fakeRun() })
  const exec = toolExec(fakeParent())
  await assert.rejects(
    () => tool.execute({ description: 'x', prompt: 'y', sessionId: '7', new: true }, exec),
    /mutually exclusive/,
  )
  assert.equal(started, 0)
})

test('tools: blank description and blank prompt are refused before any child starts', async () => {
  let started = 0
  const { tool } = delegationTool({ onStart: () => { started += 1 }, run: fakeRun() })
  const exec = toolExec(fakeParent())
  await assert.rejects(() => tool.execute({ description: '   ', prompt: 'y' }, exec), /non-empty description/)
  await assert.rejects(() => tool.execute({ description: 'x', prompt: '   ' }, exec), /non-empty prompt/)
  assert.equal(started, 0)
})

test('tools: a delegation returns text, session id, stop reason, and status', async () => {
  const run = fakeRun({ text: 'final answer', sessionId: '7' })
  const { tool, calls } = delegationTool({ run })
  const exec = toolExec(fakeParent())
  const value = await tool.execute({ description: ' work ', prompt: ' do it ' }, exec)

  assert.deepEqual(value, {
    text: 'final answer',
    sessionId: '7',
    stopReason: 'completed',
    status: 'completed',
  })
  assert.equal(calls[0].provider, 'thincoder')
  assert.equal(calls[0].label, 'work')
  assert.deepEqual(calls[0].request.prompt, [{ type: 'text', text: 'do it' }])
  // No explicit choice = the default-resume path (the provider reads the record).
  assert.deepEqual(calls[0].request.thincoderSession, {})
  // The tool disposes the activation exactly once.
  assert.equal(run.disposed, 1)
})

test('tools: an explicit sessionId is carried through the private session choice', async () => {
  const { tool, calls } = delegationTool({ run: fakeRun({ sessionId: '9' }) })
  await tool.execute({ description: 'x', prompt: 'y', sessionId: '9' }, toolExec(fakeParent()))
  assert.deepEqual(calls[0].request.thincoderSession, { sessionId: '9' })
})

test('tools: new:true is carried through and a false new is not sent', async () => {
  const { tool, calls } = delegationTool({ run: fakeRun({ sessionId: '9' }) })
  await tool.execute({ description: 'x', prompt: 'y', new: true }, toolExec(fakeParent()))
  assert.deepEqual(calls[0].request.thincoderSession, { new: true })

  const second = delegationTool({ run: fakeRun() })
  await second.tool.execute({ description: 'x', prompt: 'y', new: false }, toolExec(fakeParent()))
  assert.deepEqual(second.calls[0].request.thincoderSession, {})
})

test('tools: the render appends one session line', () => {
  const { tool } = delegationTool({ run: fakeRun() })
  const rendered = tool.output.render({}, {
    text: 'final answer',
    sessionId: '7',
    stopReason: 'completed',
    status: 'completed',
  })
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.equal(rendered[0].text, 'final answer\n\n[thincoder session] 7')

  const empty = tool.output.render({}, {
    text: '',
    sessionId: '7',
    stopReason: 'error',
    status: 'failed',
  })
  assert.equal(empty[0].text, 'thincoder returned no text (failed).\n\n[thincoder session] 7')
})

// ---------------------------------------------------------------------------
// Face 6 — sessions tool response parsing
// ---------------------------------------------------------------------------

test('tools: the sessions tool parses a session/list answer, tolerating absent title and timestamp', async () => {
  const tool = createSessionsTool({
    ctx: {},
    config: baseConfig(),
    listSessions: async () => [
      { sessionId: '7', cwd: '/w', title: 'First', updatedAt: '2026-10-06T00:00:00.000Z' },
      { sessionId: '9', cwd: '/w', title: null, updatedAt: null },
    ],
  })

  const value = await tool.execute({}, toolExec(fakeParent()))
  assert.deepEqual(value.sessions, [
    { sessionId: '7', title: 'First', updatedAt: '2026-10-06T00:00:00.000Z' },
    { sessionId: '9', title: '', updatedAt: '' },
  ])
  const text = tool.output.render({}, value)[0].text
  assert.match(text, /7 — First \(updated 2026-10-06T00:00:00.000Z\)/)
  assert.match(text, /9 — \(untitled\)/)
})

test('tools: an empty session list is an answer, not an error', async () => {
  const tool = createSessionsTool({ ctx: {}, config: baseConfig(), listSessions: async () => [] })
  const value = await tool.execute({}, toolExec(fakeParent()))
  assert.deepEqual(value, { sessions: [] })
  assert.match(tool.output.render({}, value)[0].text, /No thincoder sessions/)
})

// ---------------------------------------------------------------------------
// Face 7 — provider cwd resolution and the missing-cwd failure
// ---------------------------------------------------------------------------

test('provider: a configured cwd is validated and becomes the request override', () => {
  const cwd = resolveConfiguredCwd({ cwd: process.cwd() })
  assert.equal(cwd, resolve(process.cwd()))
})

test('provider: an empty cwd sends no request override (the host uses the current directory)', () => {
  assert.equal(resolveConfiguredCwd({ cwd: '' }), undefined)
})

test('provider: a relative or missing cwd is a readable failure, before any process', () => {
  assert.throws(() => resolveConfiguredCwd({ cwd: 'relative/dir' }), /must be an absolute path/)
  assert.throws(() => resolveConfiguredCwd({ cwd: '/definitely/not/here-b12' }), /not an accessible directory/)
})

test('provider: behaviour leaves are read per delegation with the documented defaults', () => {
  const spec = resolveBehaviourSpec(baseConfig())
  assert.equal(spec.command, 'thincoder')
  assert.deepEqual(spec.args, ['acp'])
  assert.deepEqual(spec.env, {})
  assert.equal(spec.permission, 'reject')
  assert.equal(spec.disposeEofGraceMs, 6000)
  assert.equal(spec.disposeGraceMs, 3000)

  // An allow policy is honoured; anything else is the safe `reject`.
  assert.equal(resolveBehaviourSpec({ ...baseConfig(), permission: 'allow' }).permission, 'allow')
  assert.equal(resolveBehaviourSpec({ ...baseConfig(), permission: 'nonsense' }).permission, 'reject')
  // A grace that would wedge teardown fails loudly.
  assert.throws(() => resolveBehaviourSpec({ ...baseConfig(), disposeGraceMs: 0 }), /positive finite/)
})

test('provider: the provider advertises no capabilities and no continuation', () => {
  const provider = createProvider({}, {}, {})
  assert.equal(provider.name, DEFAULT_PROVIDER_NAME)
  assert.equal(provider.capabilities, NO_START_CAPABILITIES)
  assert.ok(Object.values(provider.capabilities).every((value) => value === false))
  assert.equal(provider.inheritsParentContext, false)
  // Method presence IS the continuable capability; this backend must not have it.
  assert.equal(provider.prepareContinuable, undefined)
})

// ---------------------------------------------------------------------------
// Face 8 — connection teardown ladder and permission answer
// ---------------------------------------------------------------------------

test('connection: disposeChild ends stdin and returns on the EOF tier without terminating', async () => {
  let stdinEnded = false
  let terminated = false
  const child = {
    stdin: { end: () => { stdinEnded = true } },
    terminate: () => { terminated = true },
    waitForExit: async () => true,
  }
  await disposeChild(child, 10)
  assert.equal(stdinEnded, true)
  assert.equal(terminated, false)
})

test('connection: disposeChild escalates to terminate when the EOF tier does not exit', async () => {
  let terminated = false
  const waits = []
  const child = {
    stdin: { end: () => {} },
    terminate: () => { terminated = true },
    waitForExit: async (signal) => {
      waits.push(signal)
      // The bounded EOF wait misses; the unbounded wait proves quiescence.
      return waits.length > 1
    },
  }
  await disposeChild(child, 5)
  assert.equal(terminated, true)
  assert.equal(waits.length, 2)
})

test('connection: disposeChild aggregates a teardown that failed twice', async () => {
  const child = {
    stdin: { end: () => {} },
    terminate: () => {},
    waitForExit: async () => { throw new Error('managed range is unobservable') },
  }
  await assert.rejects(
    () => disposeChild(child, 5),
    (error) => error instanceof AggregateError
      && error.errors.length === 2
      && error.errors.every((entry) => /unobservable/.test(entry.message)),
  )
})

test('connection: permissionResponse selects the first allow option, else cancels', () => {
  const allowOnce = { optionId: 'a1', kind: 'allow_once', name: 'Allow' }
  const allowAlways = { optionId: 'a2', kind: 'allow_always', name: 'Always' }
  const rejectOnce = { optionId: 'r1', kind: 'reject_once', name: 'Reject' }

  assert.deepEqual(
    permissionResponse('allow', { options: [rejectOnce, allowOnce], toolCall: { kind: 'edit' } }),
    { outcome: { outcome: 'selected', optionId: 'a1' } },
  )
  assert.deepEqual(
    permissionResponse('allow', { options: [allowAlways] }),
    { outcome: { outcome: 'selected', optionId: 'a2' } },
  )
  // `allow` with no allow option offered must not guess.
  assert.deepEqual(
    permissionResponse('allow', { options: [rejectOnce] }),
    { outcome: { outcome: 'cancelled' } },
  )
  assert.deepEqual(
    permissionResponse('reject', { options: [allowOnce] }),
    { outcome: { outcome: 'cancelled' } },
  )
})

test('connection: connectChild answers a real permission request and records the decision', async () => {
  const { child, waitForResponse } = captureWrites()

  const { latestPermission } = connectChild(child, { permission: 'allow', onText: () => {} })
  assert.equal(latestPermission(), undefined)

  const responsePromise = waitForResponse(1)
  child.stdout.push(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess-1',
      toolCall: { toolCallId: 'tc-1', kind: 'edit' },
      options: [{ optionId: 'a1', kind: 'allow_once', name: 'Allow' }],
    },
  })}\n`)

  const response = await responsePromise
  assert.equal(response.id, 1)
  assert.deepEqual(response.result, { outcome: { outcome: 'selected', optionId: 'a1' } })
  assert.deepEqual(latestPermission(), {
    policy: 'allow',
    request: 'edit',
    decision: 'allowed',
  })

  // An unknown tool kind is sanitised to the closed vocabulary, never echoed.
  const deniedPromise = waitForResponse(2)
  child.stdout.push(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess-1',
      toolCall: { toolCallId: 'tc-2', kind: 'child-authored-nonsense' },
      options: [{ optionId: 'r1', kind: 'reject_once', name: 'Reject' }],
    },
  })}\n`)
  const denied = await deniedPromise
  assert.deepEqual(denied.result, { outcome: { outcome: 'cancelled' } })
  assert.deepEqual(latestPermission(), {
    policy: 'allow',
    request: 'unknown',
    decision: 'denied',
  })
})

// ---------------------------------------------------------------------------
// Face 9 — driver session selection (the four pinned criteria)
// ---------------------------------------------------------------------------

test('driver: the four session-selection criteria', () => {
  // 1. an explicit session id resumes exactly that session.
  assert.deepEqual(
    resolveSessionTarget({ sessionId: '7' }, undefined),
    { kind: 'resume', sessionId: '7' },
  )
  // 2. an explicit new wins over any recorded link.
  assert.deepEqual(
    resolveSessionTarget({ new: true }, { sessionId: '7' }),
    { kind: 'new' },
  )
  // 3. no explicit choice and a recorded link resumes the recorded session.
  assert.deepEqual(
    resolveSessionTarget({}, { sessionId: '7' }),
    { kind: 'resume', sessionId: '7' },
  )
  // 4. no explicit choice and no record opens a fresh session.
  assert.deepEqual(resolveSessionTarget(undefined, undefined), { kind: 'new' })
  assert.deepEqual(resolveSessionTarget({}, undefined), { kind: 'new' })
  // An explicit id outranks a stale record — the caller named the session.
  assert.deepEqual(
    resolveSessionTarget({ sessionId: '8' }, { sessionId: '7' }),
    { kind: 'resume', sessionId: '8' },
  )
  // A blank explicit id is not a session; it falls through like an absent one.
  assert.deepEqual(resolveSessionTarget({ sessionId: '' }, undefined), { kind: 'new' })
})

test('driver: a startup rollback releases an established session before reaping the child', async () => {
  const { child, requests } = fakeAcpChild({ sessionId: '7' })
  const spec = {
    ctx: { subprocess: { spawn: () => child } },
    command: 'thincoder',
    args: ['acp'],
    cwd: process.cwd(),
    env: {},
    permission: 'reject',
    disposeEofGraceMs: 100,
    disposeGraceMs: 100,
    store: {
      lookup: () => undefined,
      // The session IS established; recording it fails. The slot must still be
      // released before the child is reaped (design §5.8 startup rollback).
      remember: async () => { throw new Error('the session store is unavailable') },
    },
    parentSessionId: 'parent-session-1',
    choice: {},
  }

  await assert.rejects(
    () => startThincoderRun(
      { prompt: [{ type: 'text', text: 'hi' }], signal: new AbortController().signal },
      spec,
    ),
    /could not start a new thincoder session/,
  )

  const seen = requests.map((message) => message.method)
  assert.deepEqual(seen, ['initialize', 'session/new', 'session/close'])
  const close = requests.find((message) => message.method === 'session/close')
  assert.equal(close.params.sessionId, '7')
})

// ---------------------------------------------------------------------------
// Face 10 — plugin identity exports
// ---------------------------------------------------------------------------

test('index: exports the plugin identity the loader reads', async () => {
  const module = await import('../src/index.mjs')
  assert.equal(module.name, 'dsh-subagent-thincoder')
  assert.deepEqual(module.inject, ['tools', 'subagents', 'subprocess', 'storageDomain'])
  assert.equal(typeof module.apply, 'function')
  assert.equal(typeof module.Config, 'function')
})
