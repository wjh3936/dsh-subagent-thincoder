/**
 * Diagnostics and readable tool errors.
 *
 * Two different faces live here, and keeping them apart is the point:
 *
 * - **Fixed safe diagnostics** ({@link failureDiagnostic},
 *   {@link permissionDiagnostic}) are built ONLY from provider-owned
 *   structured facts — a stage, a category, a stop reason, an exit code, a
 *   policy. Tool inputs, file contents, environment values, credentials, and
 *   raw protocol payloads can never reach them, because nothing but those
 *   facts is an input. They ride the run result's `diagnostic`, which the
 *   harness bounds to 4096 bytes on its own.
 * - **Readable tool errors** ({@link sessionError}) are the message a model
 *   actually reads when a delegation cannot be established. These DO carry
 *   thincoder's own text — a stable anchor sentence such as `项目不可解析` is
 *   the only thing that tells the caller what to fix, so it must never be
 *   swallowed — bounded and whitespace-collapsed by {@link boundedText} so one
 *   long child message cannot flood the tool result.
 *
 * @module dsh-subagent-thincoder/errors
 */

/** Provider name used in the fixed failure diagnostic. */
const PROVIDER_LABEL = 'thincoder'

/** Default bound for text embedded in a tool error, in characters. */
export const DEFAULT_DIAGNOSTIC_MAX = 1024

/** The stable anchor thincoder emits when the workspace's manifest cannot be parsed. */
const MANIFEST_ANCHOR = '项目不可解析'

/**
 * Fixed safe failure text, derived only from provider-owned structured facts.
 *
 * @param facts - The failure's stage and category, plus the terminal stop
 *   reason and the child's exit facts when they exist.
 * @returns One line naming the provider, stage, category, and any exit facts.
 */
export function failureDiagnostic({ stage, category, stopReason, outcome }) {
  const fields = [`provider: ${PROVIDER_LABEL}`, `stage: ${stage}`, `category: ${category}`]
  if (stopReason !== undefined) fields.push(`stop reason: ${stopReason}`)
  const exitCode = outcome?.exitCode
  if (typeof exitCode === 'number') fields.push(`exit code: ${exitCode}`)
  const signal = outcome?.signal
  if (typeof signal === 'string' && signal !== '') fields.push(`signal: ${signal}`)
  return `Subagent failure (${fields.join('; ')})`
}

/**
 * Fixed permission fact. ACP tool titles and option labels never enter it —
 * they are child-authored text, and this line is written where a caller can
 * read it.
 *
 * @param decision - The policy in force, the requested tool kind, and the
 *   decision that was returned.
 * @returns One line naming policy, request, and decision.
 */
export function permissionDiagnostic({ policy, request, decision }) {
  return `ACP unattended decision (policy: ${policy}; request: ${request}; decision: ${decision})`
}

/**
 * Collapse whitespace in a child-authored message and bound its length.
 *
 * Only the HEAD survives truncation, deliberately: an embedded anchor sentence
 * sits at the start of thincoder's message, so a tail-keeping bound would drop
 * exactly the part the caller needs. The result never exceeds `max`
 * characters.
 *
 * @param text - The child-authored text (any value; non-strings are stringified).
 * @param max - Maximum characters in the result.
 * @returns The collapsed, bounded text.
 */
export function boundedText(text, max = DEFAULT_DIAGNOSTIC_MAX) {
  const collapsed = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Build the readable error a caller sees when a thincoder request fails.
 *
 * Three things are unconditional, because each one is the difference between a
 * caller who can act and one who cannot:
 *
 * 1. thincoder's own text is preserved (bounded, never dropped) — the anchor
 *    sentence is the only statement of WHAT went wrong;
 * 2. when that text carries thincoder's manifest anchor, the message says
 *    which fact about the target workspace produced it;
 * 3. when thincoder reports `AUTH_REQUIRED`, the message says that thincoder's
 *    own credentials are what is missing, rather than leaving a bare protocol
 *    code.
 *
 * The two establishment kinds then add the recovery hint a caller needs
 * (`new: true`, or pick a session from the listing tool).
 *
 * @param kind - Which thincoder request failed: `'new'`, `'resume'`, or `'list'`.
 * @param sessionId - The session the request named, when it named one.
 * @param serverText - thincoder's own failure text.
 * @returns An Error whose message is safe to hand to a model.
 */
export function sessionError(kind, sessionId, serverText) {
  const detail = boundedText(serverText)
  const manifest = detail.includes(MANIFEST_ANCHOR)
    ? "the target workspace's ThinCoder engineering manifest is not parsable. "
    : ''
  const auth = /AUTH_REQUIRED/u.test(detail)
    ? "thincoder is not authenticated (AUTH_REQUIRED) — configure thincoder's own credentials, then retry. "
    : ''

  if (kind === 'list') {
    return new Error(`thincoder could not list sessions for this workspace: ${manifest}${auth}${detail}`)
  }
  const subject = kind === 'resume'
    ? `thincoder could not resume session "${sessionId}"`
    : 'thincoder could not start a new thincoder session'
  return new Error(
    `${subject}: ${manifest}${auth}${detail}`
    + ' — use new: true to start a fresh session, or list sessions with the sessions tool to pick an existing one.',
  )
}

/**
 * Build the readable error a caller sees when a child cannot be launched: the
 * configured command could not be resolved, or a configured `args` entry carries a
 * command-interpreter metacharacter (design §5.9). Both are refused BEFORE a
 * process exists, so this message is all the caller gets — it names the configured
 * command and says what to fix, never an environment value or a resolved path.
 *
 * @param command - The configured command (an executable name or a path).
 * @param detail - The reason, e.g. the resolver's own text.
 * @returns An Error whose message is safe to hand to a model.
 */
export function launchError(command, detail) {
  const named = typeof command === 'string' && command !== '' ? command : 'the configured command'
  return new Error(
    `dsh-subagent-thincoder could not launch "${named}": ${boundedText(detail)}`
    + ' — check the `command` (an executable name or a path) and the `args` entries in the plugin config.',
  )
}

/**
 * Normalize a thrown value to a readable one-line description.
 *
 * @param error - Any thrown value.
 * @returns Its message when it is an Error, else its string form.
 */
export function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Readable error for an EXPLICIT background request with no jobs service; the
 * default path falls back to the foreground instead. */
export function backgroundUnavailable() {
  return new Error(
    'dsh-subagent-thincoder cannot run this delegation in the background: the jobs service is not available in this instance'
    + ' — pass run_in_background: false to get the answer inline instead.',
  )
}

/** Terminal detail of a job whose background start failed: fixed prefix + cause.
 * @param error - The thrown value from the background start. */
export function jobFailureDetail(error) {
  return `failed to start: ${boundedText(describeError(error))}`
}

/** Stable text for a delegation whose established id never reached the plugin (host receipt: three keys). */
export const CARRIER_LOST_TEXT = 'thincoder established a session but its id was not carried back to the plugin — the slot exists; list sessions with the sessions tool, or pass sessionId explicitly.'

/** Readable error for that loss; `detail` is the already-merged diagnostic text. */
export function carrierLost(detail) {
  return new Error(typeof detail === 'string' && detail !== '' ? detail : CARRIER_LOST_TEXT)
}

/** Readable error for a failed foreground outcome — a failure never comes back as
 * an empty-looking answer (design §5.3-B12). */
export function delegationFailed(detail) {
  return new Error(`dsh-subagent-thincoder: the delegation failed — ${detail}`)
}

/** Readable error for an enumeration no cwd source can answer (design §5.9-B12). */
export function workingDirectoryUnavailable() {
  return new Error('dsh-subagent-thincoder cannot resolve a working directory for this delegation:'
    + ' the `cwd` config is empty, no workingDirectory service is mounted, and the session header names no cwd.')
}
