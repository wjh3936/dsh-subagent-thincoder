/**
 * The ACP subagent provider: what `ctx.subagents` registers, and how one
 * delegation request turns into a resolved run spec.
 *
 * The provider is the seam between the harness's generic start API and this
 * plugin's wire driver. Its whole job is RESOLUTION — decide the child's
 * working directory and read the behaviour leaves at this delegation, then
 * hand a fully-specified spec to `src/driver.mjs`. It deliberately advertises
 * NO start-time capabilities and `inheritsParentContext = false`: a child in
 * another process shares no Cordis context, so it can honor none of the
 * parent-enforced start features, and claiming otherwise would be a silent
 * degradation the service cannot detect.
 *
 * `prepareContinuable` is deliberately NOT implemented — method presence IS
 * the capability, and this backend does not participate in the in-process
 * continuation manager (a cross-process ACP child cannot be materialized as a
 * live Agent in this process).
 *
 * The behaviour and configuration-override helpers are exported because the
 * read-only listing tool needs the same resolution; one source keeps a
 * delegation and a listing from disagreeing about the workspace override or the
 * graces. The child's directory itself is NOT resolved here any more: dsh
 * 0.2.1 resolves it (the host hands the provider an absolute `request.cwd`), so
 * the plugin only turns the `cwd` leaf into an explicit request override.
 *
 * @module dsh-subagent-thincoder/provider
 */

import {
  assertPositiveFinite,
  assertUsableCwd,
  NO_START_CAPABILITIES,
} from '@deepseek-ai/dsh-subagent'

import { readLiveLeaf, resolveIdentity } from './config.mjs'
import { startThincoderRun } from './driver.mjs'
import { resolveChildArgv } from './platform.mjs'

/** Diagnostic prefix for every message this module raises. */
const PREFIX = 'dsh-subagent-thincoder'

/**
 * Resolve the configured `cwd` override for one delegation or listing.
 *
 * The host is the single directory resolver (design §5.9-B12): `request.cwd`
 * arrives absolute, and this leaf is only an explicit request override. A
 * non-empty value must be absolute and enterable and is validated HERE, before
 * any process exists; an empty value means "send no `cwd`", so the host uses
 * the parent session's CURRENT directory. That is NOT the old `header.cwd`
 * fallback — that one was the session's original project identity and went
 * stale the moment the user changed directory.
 *
 * @param config - The plugin config (live leaves accepted).
 * @returns The validated absolute directory, or `undefined` when the leaf is empty.
 */
export function resolveConfiguredCwd(config) {
  const raw = readLiveLeaf(config?.cwd)
  return typeof raw === 'string' && raw !== '' ? assertUsableCwd(PREFIX, 'config cwd', raw) : undefined
}

/**
 * Read and validate the behavior leaves for one delegation.
 *
 * These are volatile, so they are read per delegation rather than captured at
 * load: a settings write takes effect on the next call without a remount. The
 * teardown graces are validated here (they bound a wait; zero or NaN would
 * wedge or skip it).
 *
 * @param config - The plugin config (live leaves accepted).
 * @returns The resolved `{ command, args, env, permission, graces }`.
 */
export function resolveBehaviourSpec(config) {
  const command = readLiveLeaf(config?.command)
  const args = readLiveLeaf(config?.args)
  const env = readLiveLeaf(config?.env)
  const permission = readLiveLeaf(config?.permission)
  const disposeEofGraceMs = readLiveLeaf(config?.disposeEofGraceMs)
  const disposeGraceMs = readLiveLeaf(config?.disposeGraceMs)

  assertPositiveFinite(PREFIX, 'disposeEofGraceMs', disposeEofGraceMs)
  assertPositiveFinite(PREFIX, 'disposeGraceMs', disposeGraceMs)

  return {
    command: typeof command === 'string' && command !== '' ? command : 'thincoder',
    args: Array.isArray(args) && args.every((arg) => typeof arg === 'string') ? args : ['acp'],
    env: env !== null && typeof env === 'object' && !Array.isArray(env) ? env : {},
    permission: permission === 'allow' ? 'allow' : 'reject',
    disposeEofGraceMs,
    disposeGraceMs,
  }
}

/**
 * Build the provider `ctx.subagents` registers.
 *
 * @param ctx - Plugin context (its `subprocess` spawns the child; its `logger`
 *   receives host-facing failures).
 * @param config - The plugin config.
 * @param store - The session-link store, for the default-resume lookup and the
 *   post-establishment record.
 * @returns The `SubagentProvider` implementation.
 */
export function createProvider(ctx, config, store) {
  const { providerName } = resolveIdentity(config)

  return {
    name: providerName,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,

    /**
     * Establish one child for one delegation.
     *
     * The launch argv is settled HERE, before any process exists, through the
     * launch-face single source (design §5.9): a command the platform cannot
     * resolve, or a configured arg carrying a command-interpreter metacharacter,
     * is a readable error with no child started.
     *
     * @param request - The resolved start request; its `thincoderSession` is
     *   the plugin-private session choice (absent = default resume).
     * @returns The published run handle.
     */
    async start(request) {
      // The host resolved the directory (design §5.1). An absent one is a
      // broken seam contract, not something a caller can repair, so refuse
      // before a process exists rather than guessing a directory.
      if (typeof request.cwd !== 'string' || request.cwd === '') {
        throw new Error(`${PREFIX}: the host resolved no working directory for this delegation (request.cwd is empty)`)
      }
      const behaviour = resolveBehaviourSpec(config)
      const argv = await resolveChildArgv(ctx.subprocess, behaviour)
      return startThincoderRun(request, {
        ctx,
        argv,
        cwd: request.cwd,
        env: behaviour.env,
        permission: behaviour.permission,
        disposeEofGraceMs: behaviour.disposeEofGraceMs,
        disposeGraceMs: behaviour.disposeGraceMs,
        store,
        parentSessionId: request.parent.session.id,
        choice: request.thincoderSession ?? {},
        onError: (error) => {
          ctx.logger?.warn(
            `${PREFIX} "${providerName}": child run failed: ${error?.message ?? String(error)}`,
          )
        },
      })
    },
  }
}
