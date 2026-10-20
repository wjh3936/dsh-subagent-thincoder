/**
 * One delegation's wire driver: handshake, session establishment, record, the
 * prompt attempt, and the run handle.
 *
 * The session policy lives here and is deliberately separated from the wire
 * (`src/connection.mjs`): this module decides WHICH session to open
 * (`session/new`, `session/resume`, or an explicit id), WHEN to write the
 * durable link, and what a failure means to a caller — while the connection
 * module only knows how to speak ACP to a child that is already up.
 *
 * Two rules shape the whole file:
 *
 * 1. **No silent fallback.** A slot that a caller named, or one a record
 *    points at, must exist. A failed `session/resume` is reported, never
 *    quietly replaced with a fresh slot — silently starting over is the exact
 *    failure this plugin exists to remove. The record is rewritten only AFTER
 *    an establishment succeeds.
 * 2. **Release before reap.** `session/close` runs before the child is torn
 *    down, so the slot's claim is released; a leftover claim would force the
 *    next delegation to fork to a new slot and make continuation impossible.
 *
 * @module dsh-subagent-thincoder/driver
 */

import { randomUUID } from 'node:crypto'

import { methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'

import { closeSession, connectChild, disposeChild, spawnChild } from './connection.mjs'
import { describeError, failureDiagnostic, permissionDiagnostic, sessionError } from './errors.mjs'
import { resolveChildArgv } from './platform.mjs'
import { linkKey } from './session-store.mjs'
import { acpStopReason } from './stop-reason.mjs'

/** Diagnostic prefix for every message this module raises. */
const PREFIX = 'dsh-subagent-thincoder'

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * A promise that rejects when `signal` aborts, for racing one wire operation.
 *
 * Used where the operation is awaited directly rather than through the run's
 * own cancellation wiring, so a cancelled caller never waits out a child.
 *
 * @param signal - The caller's cancellation signal, if any.
 * @param message - The rejection message.
 * @returns A promise that never fulfills.
 */
function aborted(signal, message) {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error(message))
      return
    }
    signal?.addEventListener('abort', () => reject(new Error(message)), { once: true })
  })
}

/** Report one host-facing failure without letting the sink replace it. */
function report(spec, error) {
  try {
    spec.onError?.(error)
  } catch {
    // A diagnostic sink must never turn into the delegation's failure.
  }
}

/**
 * Wait, bounded, for one promise to settle — either way.
 *
 * Used on the startup rollback path: when cancellation wins the establishment
 * race the wire request may still be in flight, and a slot it creates must be
 * released rather than abandoned. The bound is the configured process grace.
 *
 * @param promise - The promise to observe.
 * @param ms - The maximum wait.
 * @returns Resolution once the promise settled or the bound elapsed.
 */
async function awaitSettledWithin(promise, ms) {
  let timer
  try {
    await Promise.race([
      promise.then(() => {}, () => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, ms) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Put the fixed failure facts first, followed by the latest permission decision. */
function diagnosticText(facts, permission) {
  const failure = failureDiagnostic(facts)
  return permission === undefined ? failure : `${failure}\n${permissionDiagnostic(permission)}`
}

/**
 * The safe diagnostic for a non-`end_turn` prompt outcome.
 *
 * Only `end_turn` needs none — the task finished. Every other terminal reason
 * stopped the turn without finishing it, so each gets a fixed failure line
 * (the stage, a category, and the stop reason), with the latest permission
 * decision appended when there is one. Only structured, provider-owned facts
 * enter it — never the prompt, the workspace, env, or credentials.
 *
 * A local cancellation does NOT reach here: it settles through
 * `settleRunResult`'s `cancelled` branch without a diagnostic and stays an
 * `aborted`/killed run. An ACP `cancelled` reply is the child's own report and
 * does get a line.
 *
 * @param reason - The ACP terminal reason off `session/prompt`.
 * @param permission - The latest permission decision, if any.
 * @returns The diagnostic text, or `undefined` for `end_turn`.
 */
function terminalFailure(reason, permission) {
  switch (reason) {
    case 'end_turn':
      return undefined
    case 'max_turn_requests':
      return diagnosticText({
        stage: 'prompt',
        category: 'remote-limit',
        stopReason: 'max_turn_requests',
      }, permission)
    case 'max_tokens':
    case 'refusal':
    case 'cancelled':
      // Every non-`end_turn` outcome carries a safe diagnostic (G12). These
      // three end the turn without finishing the task, and the fixed
      // stage/category/stop-reason line is what makes that visible. A LOCAL
      // cancellation is a different path — it settles through
      // `settleRunResult`'s `cancelled` branch with no diagnostic, and so stays
      // an `aborted`/killed run.
      return diagnosticText(
        { stage: 'prompt', category: 'remote-stop', stopReason: reason },
        permission,
      )
    default:
      return diagnosticText(
        { stage: 'prompt', category: 'unknown', stopReason: 'unknown' },
        permission,
      )
  }
}

/** Translate harness prompt blocks into ACP text blocks (non-text blocks are dropped). */
function toAcpPrompt(prompt) {
  const blocks = []
  if (Array.isArray(prompt)) {
    for (const block of prompt) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        blocks.push({ type: 'text', text: block.text })
      }
    }
  }
  return blocks
}

/**
 * Resolve which session one delegation targets (P3, the pinned four criteria).
 *
 * 1. an explicit `sessionId` → resume it;
 * 2. an explicit `new: true` → open a fresh slot;
 * 3. otherwise the caller's durable record, when one exists → resume it;
 * 4. no record → open a fresh slot.
 *
 * Mutual exclusion of 1 and 2 is enforced at the tool layer, before any child
 * exists; this function only dispatches.
 *
 * @param choice - The caller's `{ sessionId?, new? }`, if any.
 * @param record - The durable link for this dsh session + workspace, if any.
 * @returns `{ kind: 'resume', sessionId }` or `{ kind: 'new' }`.
 */
export function resolveSessionTarget(choice, record) {
  const explicit = choice?.sessionId
  if (typeof explicit === 'string' && explicit !== '') {
    return { kind: 'resume', sessionId: explicit }
  }
  if (choice?.new === true) return { kind: 'new' }
  const remembered = record?.sessionId
  if (typeof remembered === 'string' && remembered !== '') {
    return { kind: 'resume', sessionId: remembered }
  }
  return { kind: 'new' }
}

/**
 * Handshake and session establishment, before anything is published.
 *
 * `session/new` yields the slot; its response MUST carry a string id (a
 * missing one is a protocol failure, not a session). `session/resume` yields
 * no id on the wire, so the request's own id IS this session's id — an
 * intentional reading, never a guess.
 *
 * @param agent - The client-side ACP context.
 * @param target - A target from {@link resolveSessionTarget}.
 * @param cwd - The workspace, shared by the child process and its session.
 * @param onEstablished - Called with the session id the moment the session is
 *   established, BEFORE a later step of the startup transaction can still fail
 *   — so a rollback can release a slot that was created even when recording it
 *   fails.
 * @returns The established session id.
 */
async function establishSession(agent, target, cwd, onEstablished) {
  await agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    // Advertise NO optional client capabilities (no fs, no terminal).
    clientCapabilities: {},
  })
  if (target.kind === 'resume') {
    await agent.request(methods.agent.session.resume, { sessionId: target.sessionId, cwd })
    onEstablished(target.sessionId)
    return target.sessionId
  }
  const response = await agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
  const returned = Reflect.get(response ?? {}, 'sessionId')
  if (typeof returned !== 'string' || returned === '') {
    throw new Error('the thincoder child published a session without a session id')
  }
  onEstablished(returned)
  return returned
}

/**
 * Establish and publish one thincoder child for one delegation.
 *
 * Startup failures REJECT (there is no half-published run to dispose), after
 * the still-private child is reaped. Once the run is published, its `result`
 * never rejects: a prompt failure becomes `stopReason: 'error'` with a fixed
 * safe diagnostic.
 *
 * @param request - The delegating request; carries `prompt`, `signal`, and the
 *   plugin-private `thincoderSession` choice.
 * @param spec - Everything already resolved: the spawn facts, the workspace,
 *   the durable store, and the parent session id.
 * @returns The run handle (the session id rides `request.thincoderCarrier`).
 */
export async function startThincoderRun(request, spec) {
  const signal = request.signal ?? new AbortController().signal
  if (signal.aborted) {
    throw new Error(`${PREFIX}: the delegation was cancelled before the thincoder child started`)
  }

  let child
  try {
    child = spawnChild(spec.ctx, {
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      disposeGraceMs: spec.disposeGraceMs,
    })
  } catch (error) {
    report(spec, error)
    throw new Error(
      `${PREFIX}: ${failureDiagnostic({ stage: 'process', category: 'process-start' })}`,
      { cause: error },
    )
  }

  let processOutcome
  const processDone = child.done.then(
    (outcome) => { processOutcome = outcome; return outcome },
    (error) => { throw toError(error) },
  )
  processDone.catch(() => { /* observed through the startup race; never unhandled */ })

  const fold = new AssistantOutputFold()
  const flags = { cancelled: false }

  let agent
  let latestPermission = () => undefined
  let sessionId
  let settleCancellation
  const cancelled = new Promise((resolve) => { settleCancellation = resolve })
  const requestCancel = () => {
    if (flags.cancelled) return
    flags.cancelled = true
    settleCancellation()
    if (sessionId !== undefined) {
      // Best-effort ACP cancel; the process teardown remains authoritative.
      void agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => { /* child gone */ })
    }
  }
  const onAbort = () => requestCancel()

  let disposal
  const disposeProcess = () => (disposal ??= disposeChild(child, spec.disposeEofGraceMs))

  const choice = spec.choice
  const record = choice?.sessionId === undefined && choice?.new !== true
    ? spec.store.lookup(linkKey(spec.parentSessionId, spec.cwd))
    : undefined
  const target = resolveSessionTarget(choice, record)
  const key = linkKey(spec.parentSessionId, spec.cwd)

  let stage = 'initialize'
  let establishment
  // Each established session is released at most once, even when the
  // establishment lands after a rollback has already begun. The release PROMISE
  // is kept so every caller awaits the same one before the child is reaped (§5.8).
  const releasedSessions = new Map()
  const releaseSession = (id) => {
    if (!releasedSessions.has(id)) releasedSessions.set(id, closeSession(agent, id, (error) => report(spec, error)))
    return releasedSessions.get(id)
  }
  // Set once the startup transaction starts unwinding: a session that reports
  // its id AFTER that point is still released, never abandoned.
  let rollback = false
  try {
    const connected = connectChild(child, {
      permission: spec.permission,
      onText: (text) => fold.pushText(text),
    })
    agent = connected.agent
    latestPermission = connected.latestPermission
    signal.addEventListener('abort', onAbort, { once: true })
    // Close the window between the entry check and the listener registration:
    // an abort that lands during spawn/connect must still cancel this run.
    if (signal.aborted) onAbort()

    establishment = (async () => {
      const id = await establishSession(agent, target, spec.cwd, (establishedId) => {
        sessionId = establishedId
        // The transaction is already unwinding, so the rollback below may
        // already have checked for an id — release this slot here instead.
        if (rollback) void releaseSession(establishedId)
      })
      stage = target.kind === 'resume' ? 'resume-session' : 'new-session'
      return id
    })()
    const established = await Promise.race([
      establishment,
      cancelled.then(() => {
        throw new Error(`${PREFIX}: the delegation was cancelled before its thincoder session was established`)
      }),
    ])
    sessionId = established

    // The plugin-private back-carry (design §5.2): the host receipt carries only
    // `{ childId, result, dispose }`, so the established id is written into the
    // caller's mutable carrier box, which survives the receipt. No box ⇒ nothing
    // to carry (a hand-built run, as in B1's driver cases).
    if (request.thincoderCarrier !== undefined) request.thincoderCarrier.sessionId = established

    // G7: the durable link is written only AFTER a successful establishment —
    // a failed resume must never rewrite the record and lose continuity.
    await spec.store.remember(key, {
      parentSessionId: spec.parentSessionId,
      cwd: spec.cwd,
      sessionId,
      updatedAt: Date.now(),
    })
  } catch (error) {
    signal.removeEventListener('abort', onAbort)
    rollback = true
    report(spec, new Error(
      `${PREFIX}: ${failureDiagnostic(processOutcome === undefined
        ? { stage, category: 'transport' }
        : { stage, category: 'process-exit', outcome: processOutcome })}`,
      { cause: error },
    ))
    // §5.8: cancellation / protocol failure / startup rollback all release a
    // session that was established BEFORE the process is reaped. The session
    // may still be in flight when cancellation won the race, so give it a
    // bounded chance to report its id — a slot created by a cancelled or
    // rolled-back call must not stay claimed (that would force the next resume
    // to fork).
    if (establishment !== undefined && sessionId === undefined) {
      await awaitSettledWithin(establishment, spec.disposeGraceMs)
    }
    if (sessionId !== undefined) {
      await releaseSession(sessionId)
    }
    try {
      await disposeProcess()
    } catch (teardownError) {
      report(spec, teardownError)
    }
    if (flags.cancelled) {
      throw new Error(`${PREFIX}: the delegation was cancelled before its thincoder session was established`)
    }
    throw sessionError(target.kind === 'resume' ? 'resume' : 'new', target.sessionId, describeError(error))
  }

  let diagnostic
  const result = settleRunResult({
    attempt: async () => {
      try {
        const promptResult = await Promise.race([
          agent.request(methods.agent.session.prompt, {
            sessionId,
            prompt: toAcpPrompt(request.prompt),
          }),
          cancelled.then(() => {
            throw new Error(`${PREFIX}: the delegation was cancelled while its thincoder prompt was running`)
          }),
        ])
        const stopReason = acpStopReason(promptResult.stopReason)
        diagnostic = terminalFailure(promptResult.stopReason, latestPermission())
        return {
          output: fold.collect() ?? [],
          ...(diagnostic === undefined ? {} : { diagnostic }),
          stopReason,
        }
      } catch (error) {
        if (!flags.cancelled) {
          const facts = processOutcome === undefined
            ? { stage: 'prompt', category: 'transport' }
            : { stage: 'process', category: 'process-exit', outcome: processOutcome }
          diagnostic = diagnosticText(facts, latestPermission())
        }
        throw error
      }
    },
    collectOutput: () => fold.collect() ?? [],
    collectDiagnostic: () => diagnostic,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal,
    onAbort,
  })

  const handle = subprocessRunHandle({
    id: randomUUID(),
    result,
    signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      // §5.8 order, fixed: release the slot's claim, then reap the process.
      await closeSession(agent, sessionId, (error) => report(spec, error))
      await disposeProcess()
    },
  })
  return handle
}

/**
 * List the thincoder sessions that already exist for one workspace.
 *
 * Reuses the same connection path as a delegation — spawn, `initialize`,
 * then `session/list` (no `session/new`) — and always reaps the child. An
 * empty collection is a legitimate answer, not an error.
 *
 * @param request - Carries the caller's `signal`.
 * @param spec - The resolved spawn facts and workspace.
 * @returns The `SessionInfo[]` off the list response.
 */
export async function listWorkspaceSessions(request, spec) {
  // §5.9: settled before any process exists, so a refused listing starts nothing.
  const argv = await resolveChildArgv(spec.ctx.subprocess, spec)
  let child
  try {
    child = spawnChild(spec.ctx, {
      argv,
      cwd: spec.cwd,
      env: spec.env,
      disposeGraceMs: spec.disposeGraceMs,
    })
  } catch (error) {
    throw sessionError('list', undefined, describeError(error))
  }

  let failure
  let sessions
  try {
    const connected = connectChild(child, {
      permission: spec.permission,
      onText: () => { /* a listing carries no answer text */ },
    })
    await Promise.race([
      (async () => {
        await connected.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const response = await connected.agent.request(methods.agent.session.list, { cwd: spec.cwd })
        const listed = response?.sessions
        sessions = Array.isArray(listed) ? listed : []
      })(),
      aborted(request.signal, `${PREFIX}: the session listing was cancelled while it was running`),
    ])
  } catch (error) {
    failure = error
  }

  let teardownFailure
  try {
    await disposeChild(child, spec.disposeEofGraceMs)
  } catch (error) {
    teardownFailure = toError(error)
  }

  if (failure !== undefined) {
    if (teardownFailure !== undefined) report(spec, teardownFailure)
    throw sessionError('list', undefined, describeError(failure))
  }
  if (teardownFailure !== undefined) throw teardownFailure
  return sessions
}
