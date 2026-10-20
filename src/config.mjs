/**
 * The plugin's configuration surface.
 *
 * The schema splits its leaves into two classes, and the split is the whole
 * point of this module:
 *
 * - **Identity leaves** (`providerName`, `toolName`, `sessionToolName`) decide
 *   what gets REGISTERED — a provider name and two tool names. They are
 *   deliberately NOT volatile: the registered catalog is part of a request's
 *   prefix, so renaming a provider or a tool must remount the fiber to
 *   re-register the catalog. A volatile write would instead leave the old name
 *   registered while the config claims the new one.
 * - **Behaviour leaves** (`command`, `args`, `cwd`, `permission`, `env`,
 *   `disposeEofGraceMs`, `disposeGraceMs`, `runInBackground`) are read per delegation and
 *   are therefore volatile: a settings write takes effect on the next delegation without
 *   touching the registered catalog.
 *
 * `permission` defaults to `reject`, the safe direction (see the mount row in
 * `cordis.patch.yml`, which opts a deployment in explicitly).
 *
 * `cwd` keeps the empty-string default rather than baking a resolved path.
 * A non-empty leaf is an explicit request override (absolute and enterable; the
 * host resolves nothing for it), while `''` sends NO `cwd` at all ⇒ the host
 * uses the delegating session's CURRENT directory. That is not the old
 * `header.cwd` (the session's original project identity, stale after a `cd`).
 *
 * @module dsh-subagent-thincoder/config
 */

import z from '@deepseek-ai/schemastery'

/** Default provider name: the string callers pass to `ctx.subagents.start`. */
export const DEFAULT_PROVIDER_NAME = 'thincoder'

/** Default model-facing delegation tool name. */
export const DEFAULT_TOOL_NAME = 'subagent_thincoder'

/** Default model-facing session-listing tool name. */
export const DEFAULT_SESSION_TOOL_NAME = 'subagent_thincoder_sessions'

/**
 * The plugin's `Config`, as the host reads it.
 *
 * A leaf is marked `.volatile()` when the runtime must be able to update it in
 * place (and when the plugin must read it per use instead of capturing it); see
 * the module docstring for which leaves are which, and why.
 */
export const Config = z.object({
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  toolName: z.string().default(DEFAULT_TOOL_NAME),
  sessionToolName: z.string().default(DEFAULT_SESSION_TOOL_NAME),
  command: z.string().default('thincoder').volatile(),
  args: z.array(z.string()).default(['acp']).volatile(),
  /** Request override only: non-empty ⇒ absolute + enterable; `''` ⇒ send none. */
  cwd: z.string().default('').volatile(),
  permission: z.union(['allow', 'reject']).default('reject').volatile(),
  env: z.dict(z.string()).default({}).volatile(),
  disposeEofGraceMs: z.number().default(6000).volatile(),
  disposeGraceMs: z.number().default(3000).volatile(),
  runInBackground: z.boolean().default(true).volatile(),
})

/**
 * One config leaf: read through a volatile reference, or used as-is.
 *
 * The loader hands `apply` a config whose volatile leaves are `.get()`-bearing
 * references that the runtime updates in place, so the reference is truthy even
 * when the value behind it is `false` — a plain `if (config.permission)` would
 * read that reference as "always set". Tests and hand-built callers hold plain
 * values, and both shapes must read identically.
 *
 * @param value - A resolved config leaf.
 * @returns The live value, unwrapped when it is a reference.
 */
export function readLiveLeaf(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value
}

/**
 * Resolve the three identity leaves ONCE, at load.
 *
 * Only identity is resolved here; the behaviour leaves are read per delegation
 * by the caller that builds a run (see `src/provider.mjs`). Reading a behaviour
 * leaf here would freeze it for the lifetime of the mount.
 *
 * @param config - The plugin's config (a resolved `Config`, or any object with
 *   the same leaf names for tests and hand-built callers).
 * @returns The identity snapshot: provider name and the two tool names.
 */
export function resolveIdentity(config) {
  const providerName = readLiveLeaf(config?.providerName)
  const toolName = readLiveLeaf(config?.toolName)
  const sessionToolName = readLiveLeaf(config?.sessionToolName)
  return {
    providerName: typeof providerName === 'string' && providerName !== ''
      ? providerName
      : DEFAULT_PROVIDER_NAME,
    toolName: typeof toolName === 'string' && toolName !== ''
      ? toolName
      : DEFAULT_TOOL_NAME,
    sessionToolName: typeof sessionToolName === 'string' && sessionToolName !== ''
      ? sessionToolName
      : DEFAULT_SESSION_TOOL_NAME,
  }
}
