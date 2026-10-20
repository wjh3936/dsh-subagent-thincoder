/**
 * The ACP child-process connection: spawn, wire the client side of the
 * protocol, answer permission prompts, and reach quiescence on teardown.
 *
 * This module is the wire half of one delegation. It knows how to start the
 * child, how the client answers the child's `session/request_permission`
 * prompts, and how to release the child's managed process range — but it knows
 * NOTHING about sessions: which session to open, remembering it, or prompting
 * it all belong to `src/driver.mjs`. Keeping the two apart is what lets the
 * session policy be tested without a wire and the wire without a session.
 *
 * Only `agent_message_chunk` notifications are folded into the result; the
 * child's thoughts, tool calls, and plans are deliberately dropped (see the
 * module boundary in the requirements: the subagent returns its final answer,
 * not its transcript).
 *
 * @module dsh-subagent-thincoder/connection
 */

import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'

import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
} from '@agentclientprotocol/sdk'

/** Diagnostic prefix for every message this module raises. */
const PREFIX = 'dsh-subagent-thincoder'

/**
 * The closed ACP tool-kind vocabulary.
 *
 * A permission request carries a `toolCall.kind` the SDK types as a union, but
 * the value crosses a process boundary — sanitising it against this set keeps
 * arbitrary child-authored text out of the fixed permission diagnostic.
 */
const ACP_TOOL_KINDS = new Set([
  'read', 'edit', 'delete', 'move', 'search',
  'execute', 'think', 'fetch', 'switch_mode', 'other',
])

/**
 * One permission decision, in the fixed vocabulary {@link permissionDiagnostic} consumes.
 *
 * @typedef {object} PermissionDecision
 * @property {'allow' | 'reject'} policy - The configured policy that produced the decision.
 * @property {string} request - The requested tool kind, or `'unknown'`.
 * @property {'allowed' | 'denied'} decision - What was answered.
 */

/**
 * Start one `thincoder acp` child over the subprocess seam.
 *
 * The stdio dispositions are fixed: the protocol rides stdin/stdout, and the
 * child's own diagnostics go to this process's stderr (`inherit`) instead of
 * competing with the protocol for a pipe. `graceMs` is the process-observation
 * and termination-escalation grace the caller resolved from config.
 *
 * @param ctx - Plugin context carrying `ctx.subprocess`.
 * @param spec - The resolved spawn spec: argv, cwd, env, and the process grace.
 * @returns The live subprocess handle.
 * @throws When the subprocess implementation drops a piped protocol stream —
 *   a child that cannot speak the protocol must fail here, not later as a
 *   mystery timeout. The child is reaped best-effort first: the caller only
 *   ever sees the throw, so it can never dispose a handle it never received.
 */
export function spawnChild(ctx, spec) {
  const child = ctx.subprocess.spawn({
    argv: spec.argv,
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  if (child.stdin === undefined || child.stdout === undefined) {
    // Best effort only: this function is synchronous by contract, so the
    // teardown ladder is unavailable here. Terminating is what keeps a child
    // whose protocol streams are unusable from leaking past the throw. Each
    // step is guarded on its own, so a failing `end()` cannot skip the
    // `terminate()` that actually reaps the child.
    try {
      child.stdin?.end()
    } catch {
      // The dropped stream below is the actionable fact.
    }
    try {
      child.terminate?.()
    } catch {
      // Likewise: a teardown failure must not replace the dropped stream.
    }
    throw new Error(`${PREFIX}: subprocess implementation dropped a piped protocol stream`)
  }
  return child
}

/**
 * Answer one `session/request_permission` prompt under the configured policy.
 *
 * `allow` selects the first option the child marked `allow_once` or
 * `allow_always`; if the child offered none, the answer is `cancelled` rather
 * than a guess. `reject` always answers `cancelled`. Nothing is ever surfaced
 * to a human — an unattended delegation cannot wait on a prompt.
 *
 * @param permission - The configured policy.
 * @param params - The permission request params (`options`, `toolCall.kind`).
 * @returns The ACP permission response.
 */
export function permissionResponse(permission, params) {
  if (permission === 'allow') {
    const options = Array.isArray(params?.options) ? params.options : []
    const allow = options.find(
      (option) => option?.kind === 'allow_once' || option?.kind === 'allow_always',
    )
    if (allow !== undefined && typeof allow.optionId === 'string' && allow.optionId !== '') {
      return { outcome: { outcome: 'selected', optionId: allow.optionId } }
    }
  }
  return { outcome: { outcome: 'cancelled' } }
}

/** Keep only the closed ACP tool-kind vocabulary; anything else reads as `unknown`. */
function permissionRequestKind(kind) {
  return typeof kind === 'string' && ACP_TOOL_KINDS.has(kind) ? kind : 'unknown'
}

/**
 * Connect the ACP client to a spawned child.
 *
 * The returned `agent` is the client-side context used to call agent methods
 * (`initialize`, `session/new`, `session/resume`, `session/list`,
 * `session/prompt`, `session/cancel`, `session/close`). `latestPermission` is
 * a reader for the last decision this connection answered, so a caller can put
 * a permission fact into a safe diagnostic without re-parsing the wire.
 *
 * @param child - A handle from {@link spawnChild}.
 * @param options - The permission policy and the text sink for
 *   `agent_message_chunk` content.
 * @returns `{ agent, connection, latestPermission }`.
 */
export function connectChild(child, { permission, onText }) {
  /** @type {PermissionDecision | undefined} */
  let latestPermission
  const sink = typeof onText === 'function' ? onText : () => {}

  const app = createAcpClientApp({ name: PREFIX })
    .onNotification(methods.client.session.update, ({ params }) => {
      const update = params?.update
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const content = update.content
        // Only text contributes; a non-text block yields '' and is a no-op.
        sink(content?.type === 'text' && typeof content.text === 'string' ? content.text : '')
      }
      return Promise.resolve()
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const response = permissionResponse(permission, params)
      latestPermission = {
        policy: permission,
        request: permissionRequestKind(params?.toolCall?.kind),
        decision: response.outcome.outcome === 'selected' ? 'allowed' : 'denied',
      }
      return Promise.resolve(response)
    })

  const connection = app.connect(ndJsonStream(
    NodeWritable.toWeb(child.stdin),
    NodeReadable.toWeb(child.stdout),
  ))

  return {
    agent: connection.agent,
    connection,
    latestPermission: () => latestPermission,
  }
}

/** Bound one managed-range exit wait: observe the range until it is empty or `ms` elapses. */
async function rangeExitsWithin(child, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  try {
    return await child.waitForExit(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Reach whole-range quiescence over the seam's public verbs.
 *
 * The ladder is fixed and ordered: stdin EOF (the child's own window to flush
 * persistence and reap its descendants), then the `terminate()` escalation,
 * then the unbounded `waitForExit()` that proves the range is empty. A bound
 * is held on the EOF tier only; termination owns its own bounded escalation and
 * its wait is the process owner's exit proof, not a second derived grace.
 *
 * Every tier's failure is preserved: one failure is rethrown as-is, several are
 * aggregated, so a teardown that went wrong twice says both facts. The
 * escalation is guarded on its own, so a `terminate()` that throws still leaves
 * the exit proof to run and joins the aggregate.
 *
 * @param child - The spawned child's handle.
 * @param eofGraceMs - The tier-1 window after stdin EOF.
 * @returns Resolution once the managed range is empty.
 */
export async function disposeChild(child, eofGraceMs) {
  const failures = []
  child.stdin?.end()
  let exited = false
  try {
    exited = await rangeExitsWithin(child, eofGraceMs)
  } catch (error) {
    failures.push(toError(error))
  }
  if (exited) return
  // `terminate()` is inside its own guard: a synchronous throw from it must not
  // skip the `waitForExit()` below, which is the only proof the managed range
  // is empty. A refusal to escalate is a failure fact, not a reason to stop.
  try {
    child.terminate()
  } catch (error) {
    failures.push(toError(error))
  }
  try {
    await child.waitForExit()
  } catch (error) {
    failures.push(toError(error))
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `${PREFIX}: ACP subprocess teardown failed`)
  }
}

/**
 * Best-effort release of the child's session slot, BEFORE the process is reaped.
 *
 * A slot left claimed makes the next delegation fork to a new slot, which is
 * exactly the continuity this plugin exists to provide — so this runs first in
 * teardown. It never throws: a child that is already gone must not turn a
 * successful delegation into a failure. When no session was established, this
 * is a no-op.
 *
 * @param agent - The client-side ACP context.
 * @param sessionId - The established session id, if any.
 * @param onError - Optional sink for a swallowed failure (the caller logs it).
 * @returns Resolution after the best-effort close.
 */
export async function closeSession(agent, sessionId, onError) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  try {
    await agent.request(methods.agent.session.close, { sessionId })
  } catch (error) {
    if (typeof onError === 'function') onError(toError(error))
  }
}
