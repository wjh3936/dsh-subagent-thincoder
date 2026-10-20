/**
 * The ACP `StopReason` → harness `SubagentStopReason` mapping.
 *
 * The two vocabularies are close but not identical, and the differences are
 * the interesting part: a terminal reason the harness cannot represent must
 * map to `error`, never to `completed`. Reporting an unclean stop as success
 * is the one failure mode a consumer cannot detect afterwards.
 *
 * The mapping is held here rather than imported from
 * `@deepseek-ai/dsh-subagent-acp` because that package's `acpStopReason` is not
 * on its export surface (`exports["."]` → `lib/index.js` exports only
 * `name`/`inject`/`Config`/`apply`), and its wire driver is the very handshake
 * this plugin exists to replace.
 *
 * @module dsh-subagent-thincoder/stop-reason
 */

/**
 * Map one ACP terminal reason to the harness's stop-reason vocabulary.
 *
 * `max_turn_requests` (the child hit its own turn-request budget) and any
 * unknown future variant mean the task did NOT finish cleanly, so both map to
 * `error`: the consumer turns that into an error result instead of presenting
 * a partial answer as success.
 *
 * @param reason - The `stopReason` off the child's `session/prompt` response.
 * @returns The harness stop reason.
 */
export function acpStopReason(reason) {
  switch (reason) {
    case 'end_turn':
      return 'completed'
    case 'max_tokens':
      return 'max-tokens'
    case 'refusal':
      return 'refusal'
    case 'cancelled':
      return 'aborted'
    case 'max_turn_requests':
      return 'error'
    default:
      return 'error'
  }
}
