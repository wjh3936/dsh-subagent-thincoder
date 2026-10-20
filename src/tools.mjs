/**
 * The two model-facing tools: one delegation tool and one read-only listing
 * tool.
 *
 * The delegation tool is the plugin's only write-side surface. It validates
 * its parameters BEFORE a child exists (a refused call must start nothing),
 * hands the session choice to the provider through the plugin-private
 * `thincoderSession` field, and reports back the final answer plus the
 * thincoder session id so the next call can name it explicitly.
 *
 * By default a delegation runs as a background JOB (P11): the call returns the
 * job id at once and the child runs inside the job's `done`, so the session's
 * step is not spent waiting on thincoder; the foreground path answers inline.
 *
 * The listing tool is deliberately separate rather than an action on the
 * delegation tool: the delegation tool's parameter surface is pinned
 * (`description` / `prompt` / `sessionId` / `new` / `run_in_background`), and
 * widening it to carry a listing mode would make one tool answer two questions.
 *
 * @module dsh-subagent-thincoder/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { readLiveLeaf, resolveIdentity } from './config.mjs'
import { listWorkspaceSessions } from './driver.mjs'
import { backgroundUnavailable, boundedText, carrierLost, CARRIER_LOST_TEXT, delegationFailed } from './errors.mjs'
import { describeError, jobFailureDetail, workingDirectoryUnavailable } from './errors.mjs'
import { resolveBehaviourSpec, resolveConfiguredCwd } from './provider.mjs'

/**
 * The delegation tool's model-facing description.
 *
 * The last sentence is the concurrency caveat from the design: concurrent
 * delegations of one slot may be silently forked by thincoder, and the
 * reported id then comes from the request rather than the actual slot. It is
 * stated where the model can read it because the model, not the plugin, is the
 * party that can avoid relying on a forked id.
 */
const DELEGATE_DESCRIPTION = [
  'Delegate a task to a ThinCoder CLI subagent over ACP.',
  'By default this resumes the thincoder session recorded for the current dsh session and workspace,',
  'so state held in that slot (an approved design token, a review round) survives into this call.',
  'Pass `sessionId` to resume one specific session, or `new: true` to start a fresh one;',
  'the two are mutually exclusive. Returns the subagent\'s final answer text and the thincoder session id it used.',
  // The gate's three blocking cases, then the one-task-one-session convention.
  'This call starts a background job and returns as soon as the job id is known, so the dsh session is not blocked while the subagent runs; read the answer with `job_output`.',
  'Background is the default. This call blocks only when the run goes to the foreground, in three cases: you pass `run_in_background: false`; this instance defaults to the foreground and you pass nothing; or the jobs service is unavailable — the default path then falls back to the foreground.',
  'Start each new task with `new: true`; when you are continuing a task already delegated here, keep the default so its slot state (an approved design token, a review round) carries over.',
  '',
  '同一工作区并发委派同一槽时，thincoder 可能静默 fork 到新槽；此时回报的会话号取自请求，未必等于实际槽号。',
].join('\n')

/** The listing tool's model-facing description. */
const SESSIONS_DESCRIPTION = [
  'List the ThinCoder sessions that already exist for this workspace.',
  'Read-only: it starts no session. Use it to pick a session id to pass to the delegation tool.',
].join('\n')

/** Join the text blocks of a subagent result into the answer a caller reads. */
function finalText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

function nonEmpty(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The configured cwd override, wrapped so a rejected check is readable. */
function configuredCwd(config) {
  try { return resolveConfiguredCwd(config) } catch (error) { throw new Error(`${describeError(error)} — set \`cwd\` to an absolute existing directory, or leave it empty.`) }
}

/** Append one diagnostic segment to an outcome and turn it into a failure. */
function failWith(outcome, segment, prepend = false) {
  const detail = outcome.detail === undefined || outcome.detail === ''
    ? segment
    : prepend ? `${segment} | ${outcome.detail}` : `${outcome.detail} | ${segment}`
  return { ...outcome, status: 'failed', detail }
}

/** Map a terminal activation result to its job outcome (design §5.3-B12). */
function mapStopReason(result) {
  const { stopReason } = result
  if (stopReason === 'completed') return { status: 'completed', result: finalText(result.output) }
  if (stopReason === 'aborted' && result.diagnostic === undefined) return { status: 'killed' }
  return { status: 'failed', detail: `${stopReason}: ${result.diagnostic ?? 'no diagnostic'}` }
}

/** Settle one activation (§5.3-B12): result → dispose → carrier → outcome.
 * Result first is ATTRIBUTION (a disposed run reports `aborted` and would eat a
 * completed answer); every exit after the receipt passes here, so an empty
 * carrier never skips the disposal. @returns `{ sessionId, result, outcome }`. */
async function settleActivation({ activation, carrier }) {
  let result
  let lost = false
  try { result = await activation.result } catch (error) { lost = true; result = error }
  let outcome = lost ? { status: 'failed', detail: jobFailureDetail(result) } : mapStopReason(result)
  let disposeFailed = false
  let disposeError
  try { await activation.dispose() } catch (error) { disposeFailed = true; disposeError = error }
  if (disposeFailed) {
    outcome = failWith(outcome, `dispose failed: ${boundedText(describeError(disposeError))}`)
  }
  const sessionId = carrier?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { sessionId: undefined, result: lost ? undefined : result, outcome: failWith(outcome, CARRIER_LOST_TEXT, true) }
  }
  return { sessionId, result: lost ? undefined : result, outcome }
}

/** Normalize one `SessionInfo` into the tool's declared output shape. */
function normalizeSession(info) {
  return {
    sessionId: typeof info?.sessionId === 'string' ? info.sessionId : String(info?.sessionId ?? ''),
    title: typeof info?.title === 'string' ? info.title : '',
    updatedAt: typeof info?.updatedAt === 'string' ? info.updatedAt : '',
  }
}

/** Render one session as a single human-readable line. */
function renderSession(session) {
  const title = session.title === '' ? '(untitled)' : session.title
  const updated = session.updatedAt === '' ? '' : ` (updated ${session.updatedAt})`
  return `${session.sessionId} — ${title}${updated}`
}

/** Render one delegation output: the background `kind` member is the discriminator
 * (K36); a value without it renders exactly as the foreground always has. */
function renderDelegation(value) {
  if (value.kind === 'background') {
    return `background job ${value.jobId} started; read it with job_output`
  }
  return value.text === ''
    ? `thincoder returned no text (${value.status}).\n\n[thincoder session] ${value.sessionId}`
    : `${value.text}\n\n[thincoder session] ${value.sessionId}`
}

/** Start one delegation as a background job (P11, §5.11); only `dispose()` stops the run after publication. */
function startBackgroundDelegation({ jobs, start, owner, label }) {
  return {
    kind: 'background',
    jobId: jobs.start({
      kind: 'thincoder',
      label,
      owner,
      run: (job) => {
        const controller = new AbortController()
        const carrier = { sessionId: undefined }
        let activation
        return {
          cancel: () => {
            controller.abort()
            void activation?.dispose().catch(() => {})
          },
          done: (async () => {
            try {
              activation = await start(controller.signal, carrier)
            } catch (error) {
              return { status: 'failed', detail: jobFailureDetail(error) }
            }
            // An abort that landed after the host's own check but before the
            // receipt came back is heard only here (§5.3-B12).
            if (controller.signal.aborted) void activation.dispose().catch(() => {})
            // Publish the id as soon as it exists (empty box ⇒ nothing to say).
            const earlyId = carrier.sessionId
            if (typeof earlyId === 'string' && earlyId !== '') job.append(`[thincoder session] ${earlyId}`)
            return (await settleActivation({ activation, carrier })).outcome
          })(),
        }
      },
    }),
  }
}

/**
 * Build the delegation tool.
 *
 * Validation runs in two layers, and both are needed: the `defineTool` schema
 * rejects wrong TYPES, while the body rejects blank strings and the
 * mutually-exclusive pair (the implicit parameter root is open, so an
 * undeclared shape is not itself a rejection). Either failure throws before
 * `ctx.subagents.startActivation` is reached, so a refused call starts no process.
 *
 * @param options - The plugin context and config.
 * @returns The registry-ready tool definition.
 */
export function createDelegateTool({ ctx, config }) {
  const { providerName, toolName } = resolveIdentity(config)

  return defineTool({
    name: toolName,
    description: DELEGATE_DESCRIPTION,
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short human-readable label for this delegation.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The task text to hand to the ThinCoder subagent.',
      },
      sessionId: {
        type: 'string',
        description: 'The thincoder session to resume; mutually exclusive with `new`.',
      },
      new: {
        type: 'boolean',
        description: 'Start a fresh thincoder session instead of resuming; mutually exclusive with `sessionId`.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run the delegation as a background job and return its job id (read it with `job_output`,'
          + ' stop it with `job_kill`); defaults to this instance\'s setting. Pass false to block for the inline answer.',
      },
    },
    output: {
      // A discriminated union (K35): the foreground branch stays the four keys.
      schema: { oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            sessionId: { type: 'string', required: true },
            stopReason: { type: 'string', required: true },
            status: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'background' },
            jobId: { type: 'string', required: true },
          },
        },
      ] },
      render: (_args, value) => [{ type: 'text', text: renderDelegation(value) }],
    },

    /**
     * Run one delegation and report its terminal facts.
     *
     * @param args - The validated arguments.
     * @param exec - The tool run context (caller agent and cancellation).
     * @returns The background `{ kind: 'background', jobId }`, or the foreground
     *   `{ text, sessionId, stopReason, status }`.
     */
    execute: async (args, exec) => {
      const description = typeof args.description === 'string' ? args.description.trim() : ''
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (description === '') {
        throw new Error(`${toolName} requires a non-empty description`)
      }
      if (prompt === '') {
        throw new Error(`${toolName} requires a non-empty prompt`)
      }

      const sessionId = args.sessionId
      const forceNew = args.new === true
      if (sessionId !== undefined && forceNew) {
        // Readable, and before any child: the caller meant one of the two, and
        // guessing which would silently pick a session for them.
        throw new Error(`${toolName}: sessionId and new are mutually exclusive — pass one, not both`)
      }
      if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId === '')) {
        throw new Error(`${toolName}: sessionId must be a non-empty string`)
      }

      const parent = exec.agent
      if (parent === undefined) {
        throw new Error(`${toolName} requires a calling agent`)
      }

      // A configured `cwd` is a validated request override; `''` sends no key (§5.9-B12).
      const configured = configuredCwd(config)
      const request = {
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(configured === undefined ? {} : { cwd: configured }),
        thincoderSession: {
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(forceNew ? { new: true } : {}),
        },
      }

      // One call shape for both faces (§5.3-B12): `label` on the spec, no
      // `label`/`signal` in the request, `delivery: 'caller'` (this plugin settles).
      const start = (signal, carrier) => ctx.subagents.startActivation({
        provider: providerName,
        label: description,
        request: { ...request, thincoderCarrier: carrier },
        signal,
        delivery: 'caller',
      })

      // Two levels (K39): an explicit argument always wins, else the instance's
      // own default — and a missing leaf reads as `undefined` ⇒ the foreground.
      const explicit = args.run_in_background
      const background = explicit ?? readLiveLeaf(config.runInBackground)
      if (background === true) {
        // Soft and lazy (K37): the foreground path never resolves the service.
        const jobs = ctx.get?.('jobs')
        if (jobs !== undefined) {
          return startBackgroundDelegation({ jobs, start, owner: parent.id, label: description })
        }
        // Explicit must never be answered by blocking (P11); the default path
        // degrades to the foreground instead (K38).
        if (explicit === true) throw backgroundUnavailable()
      }

      // The carrier box is private to this delegation and survives disposal (§5.2).
      const carrier = { sessionId: undefined }
      const activation = await start(exec.signal, carrier)

      // Only dispose stops the run after publication; re-check the pre-listener window.
      const onAbort = () => void activation.dispose().catch(() => {})
      exec.signal.addEventListener('abort', onAbort, { once: true })
      try {
        if (exec.signal.aborted) onAbort()
        const settled = await settleActivation({ activation, carrier })
        // The disposal already ran, so a lost id never skips cleanup.
        if (settled.sessionId === undefined) throw carrierLost(settled.outcome.detail)
        // A failure is thrown, never returned as an empty-looking answer (D4).
        if (settled.outcome.status === 'failed') throw delegationFailed(settled.outcome.detail)
        return {
          text: finalText(settled.result?.output),
          sessionId: settled.sessionId,
          stopReason: settled.result?.stopReason ?? 'error',
          status: settled.outcome.status,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
      }
    },
  })
}

/**
 * Build the read-only session-listing tool (P7).
 *
 * @param options - The plugin context, config, and an optional lister override
 *   for tests (defaults to the real ACP listing path).
 * @returns The registry-ready tool definition.
 */
export function createSessionsTool({ ctx, config, listSessions = listWorkspaceSessions }) {
  const { sessionToolName } = resolveIdentity(config)

  return defineTool({
    name: sessionToolName,
    description: SESSIONS_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                updatedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sessions.length === 0
          ? 'No thincoder sessions found for this workspace.'
          : value.sessions.map(renderSession).join('\n'),
      }],
    },

    /**
     * List this workspace's thincoder sessions.
     *
     * @param _args - No parameters.
     * @param exec - The tool run context (caller agent and cancellation).
     * @returns `{ sessions: [{ sessionId, title, updatedAt }] }`.
     */
    execute: async (_args, exec) => {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error(`${sessionToolName} requires a calling agent`)
      }
      // Three cwd sources (§5.9-B12): configured override, the host's SOFT
      // `workingDirectory` projection (`get(session)`), then the session header.
      const wd = ctx.get?.('workingDirectory')
      const projected = typeof wd?.get === 'function' ? wd.get(parent.session) : undefined
      const cwd = configuredCwd(config) ?? nonEmpty(projected) ?? nonEmpty(parent?.session?.header?.cwd)
      if (cwd === undefined) throw workingDirectoryUnavailable()
      const behaviour = resolveBehaviourSpec(config)
      const sessions = await listSessions(
        { parent, signal: exec.signal },
        { ctx, ...behaviour, cwd },
      )
      return { sessions: sessions.map(normalizeSession) }
    },
  })
}
