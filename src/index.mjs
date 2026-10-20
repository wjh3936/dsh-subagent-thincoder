/**
 * `dsh-subagent-thincoder` — a continuable ThinCoder subagent for DeepSeek Harness.
 *
 * The plugin registers one ACP subagent provider and two model-facing tools.
 * A delegation starts one `thincoder acp` child, establishes a session
 * (`session/new`, or `session/resume` when a session was recorded for this dsh
 * session + workspace), prompts it, takes the final answer, and releases the
 * slot with `session/close` before the process is reaped. The session id is
 * stored per (dsh session, workspace), so continuation survives a process
 * restart.
 *
 * Identity leaves (provider and tool names) are resolved once here, at the
 * mount; behavior leaves are read per delegation inside the provider, so the
 * registered catalog stays stable while settings still take effect on the next
 * call.
 *
 * @module dsh-subagent-thincoder
 */

import { Config } from './config.mjs'
import { createProvider } from './provider.mjs'
import { openSessionStore } from './session-store.mjs'
import { createDelegateTool, createSessionsTool } from './tools.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-subagent-thincoder'

/**
 * Services this plugin cannot work without.
 *
 * Listed as hard injections on purpose: a delegation path missing the
 * subprocess seam or the session store cannot keep the cross-delegation
 * continuity this plugin exists to provide, so the row must fail at load
 * rather than degrade silently.
 */
export const inject = ['tools', 'subagents', 'subprocess', 'storageDomain']

/**
 * Re-exported here because the host reads `plugin.Config` off this module.
 * Defined in `src/config.mjs`, a leaf with no plugin wiring in it.
 */
export { Config }

/**
 * Register the provider, the two tools, and the session store's lifetime.
 *
 * @param ctx - Plugin context carrying the four injected services.
 * @param config - The resolved plugin config; its volatile leaves are live
 *   references the runtime updates in place.
 * @returns Resolution once the store is open and the catalog is registered.
 */
export async function apply(ctx, config) {
  const store = await openSessionStore(ctx)
  // The domain outlives this fiber's registrations by construction, so its
  // release rides the same effect that unwinds them.
  ctx.effect(() => () => store.close(), 'dsh-subagent-thincoder: close session store')

  ctx.subagents.registerProvider(createProvider(ctx, config, store))
  ctx.tools.register(createDelegateTool({ ctx, config }))
  ctx.tools.register(createSessionsTool({ ctx, config }))
}
