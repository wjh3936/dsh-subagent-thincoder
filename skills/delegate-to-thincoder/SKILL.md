---
name: delegate-to-thincoder
description: Use when the user asks to delegate work to ThinCoder (e.g. "派给 thincoder"、"调用 thincoder"、"走 ACP"、"subagent_thincoder"), or when you are about to call the `subagent_thincoder` tool. Covers the delegation tools' parameters, the ACP session-slot mechanism, background job mode, and the two failure modes that silently break multi-step work.
---

# Delegating work to ThinCoder over ACP

Two tools, provided by the `dsh-subagent-thincoder` DSH plugin:

| Tool | Purpose |
|---|---|
| `subagent_thincoder` | Start or resume a delegation; runs in the background by default and returns a job id |
| `subagent_thincoder_sessions` | List ThinCoder sessions that already exist for this workspace (read-only; starts nothing) |

Each delegation spawns one `thincoder acp` child, speaks ACP to it
(`initialize` → `session/new` or `session/resume` → `session/prompt`), takes the
final answer, releases the slot with `session/close`, and reaps the process.

## Parameters

`subagent_thincoder(description, prompt, sessionId?, new?, run_in_background?)`

- `description` — short human-readable label for this delegation (required)
- `prompt` — the task body handed to ThinCoder (required)
- `sessionId` — resume one specific session; **mutually exclusive with `new`**
- `new` — explicitly start a fresh session (default `false`, meaning *resume*)
- `run_in_background` — run as a background job (default: the instance's
  `runInBackground` leaf, `true` out of the box); an explicit value always wins

Passing both `sessionId` and `new` is a readable error: no child process starts.

## Background by default — the delegation does not block the session

The call starts a background job and returns as soon as the job id is known:
`{kind: 'background', jobId}`. The dsh session is **not** blocked while ThinCoder
runs — you can keep working, and a message injected mid-run is consumed at the
next step boundary. Read the answer back with `job_output`.

**It blocks only in three cases**, and then returns the answer inline:

1. you pass `run_in_background: false`;
2. this instance is configured to default to the foreground and you pass nothing;
3. the jobs service is unavailable — the default path then falls back to the
   foreground.

In cases (1) and (2) a **successful** run returns the foreground shape
`{text, sessionId, stopReason, status}`. A run that ends with any status other
than `completed` (and any run whose teardown fails) **throws** instead — the
error message carries the failure detail (stop reason, diagnostic, teardown
error). A `killed` run still returns the four keys, because cancellation is a
reported outcome rather than a failure.

This asymmetry is deliberate: a failed delegation must not come back as a
four-key object with empty text, since that is indistinguishable from a child
that answered with nothing. If the call throws, read the message — it names
whether the session was never established, whether the final answer came back
but the session id was lost, or whether the cleanup after the run failed.

**The session id is reachable while the job runs**, not only at settlement: it
enters the job's output ring as soon as the session is established. The final
answer text arrives with `job_output` after the run settles.

Do not busy-poll a background job; you are notified in-session when it finishes.

## Session-slot continuity — the part that matters

Each delegation spawns a **fresh `thincoder acp` process**. Continuity does not
come from a long-lived process; it comes from **resuming the same session slot**.

The plugin remembers one session id per **`(dsh session, workspace)`** pair, in
`$DSH_HOME/storages/subagent_thincoder.json` (`session_links` table; `$DSH_HOME`
defaults to `~/.dsh`). Resolution order:

1. explicit `sessionId` → `session/resume`
2. `new: true` → `session/new`
3. neither → look up the recorded slot for this dsh session + workspace:
   - found → resume it
   - not found → start a new one

**Why this matters:** state held in the slot — an approved design token, a review
round, accumulated context — lives *in that slot*. A second delegation that
silently opens a new slot cannot see any of it, so a multi-step workflow breaks
at the seam. If a workflow depends on state from an earlier delegation,
**resume the same slot**; only pass `new: true` when you deliberately want a
clean slate.

**When unsure, keep the default.** The two mistakes do not cost the same: passing
`new: true` by mistake silently loses the slot's state, while not passing it
merely resumes a slot carrying an older context, which is visible and can be
re-sent with `new: true`.

There is **no automatic fallback**. If an explicit `sessionId` does not exist, or
the recorded slot is gone, the call fails with a readable error rather than
quietly starting a new session. The record is only rewritten after a session is
successfully established — a failed resume never overwrites it. On such an error:
use `subagent_thincoder_sessions` to pick a live id, or pass `new: true` on
purpose.

## Pitfall: silent fork under concurrency

ThinCoder's own slot semantics are "if the slot is claimed by another live
process, fork to a new one". The plugin **does not add a lock** — concurrent
delegations of the same slot are allowed, and a fork is **invisible to the
plugin**.

Consequence: **the session id reported back is taken from the request, and may
not equal the slot that was actually used.** The plugin states this in its own
tool description.

Practical rules:

- Do not delegate to the same workspace concurrently and then rely on the
  reported id to identify "the" slot.
- When a multi-step workflow must stay on one slot, run those delegations
  **sequentially**, not in parallel.
- Treat a mid-workflow "state vanished" symptom (e.g. a credential or review
  round that an earlier delegation reported obtaining) as a possible slot fork
  before concluding the child simply lost its context.

**Where a fork leaves a trace.** The child's stderr is inherited by the
delegating process (`src/connection.mjs`, `stdio.stderr: 'inherit'`), and
ThinCoder writes a `slot busy, forked to <N>` line there when it forks. The
plugin does not parse that line, so the tool result still reports the requested
id — but the text reaches the host's stderr, which makes it a usable diagnostic:
if a workflow lost its slot state, look for that line rather than assuming the
child forgot.

## Pitfall: async child results do not survive the delegation

ThinCoder's "async" work — a `subagent` spawn that answers
`{id, status: "running"}`, and async advisor reviews — lives in an **in-process
pool** owned by the `thincoder acp` child this plugin starts. That pool is not
persisted, and the plugin reaps the child at the end of every delegation
(`src/driver.mjs`: `session/close`, then process teardown).

The mode the plugin launches is ThinCoder's **ACP mode**, and in that mode the
suspension driver never runs: `suspension-drive.mjs` is imported only by
`src/tui/*`, and the ACP session wrapper (`src/acp/session.mjs`) simply awaits
`runAgent` and returns `end_turn`. `runAgent` defaults `suspDriven: false`, and
only the TUI turn driver passes `suspDriven: true`, so nothing drains the pool
after the turn returns.

Consequences:

- A child that has **not settled by the time the prompt returns** is reaped with
  the process; its report never reaches the model, in this or a later
  delegation.
- A spawn answering `status: "running"` is **not** a promise that a result will
  follow. Polling it later cannot work — the next delegation is a new process
  with an empty pool, so a status query answers `unknown async subagent id`.
- An auto-delivery round (the channel that hands over a settled child's report)
  needs the suspension driver, so a report that settles after the turn is not
  delivered.

Note the narrower case that *does* work: a child that settles **during** the
same turn is injected at turn end. The risk is strictly about outliving the
turn.

**This limitation is about ThinCoder's *inner* async pool, not about dsh's
background jobs — the two are different layers and the outer one does not lift
the inner one.** A delegation returns a dsh job id immediately, but the
`thincoder acp` child behind that job still ends its turn when its prompt
returns, and is still reaped with the process. So a `subagent` spawn or advisor
review that is still running when that inner turn ends is **still lost** — the
dsh job merely outlives the *dsh* step, not the child's turn.

Practical rules:

- **Never end a delegation by handing off to an async child and expecting its
  result to arrive later.** If the work matters, have it written to a file and
  read that file.
- **Do not poll `subagent` / `advisor` status from a later delegation** to
  collect an earlier child's result.
- **Judge a workflow by its artifacts, not by a summary arriving on the auto
  channel.** If a workflow records its rounds in a file (e.g. a review record),
  read that file to decide whether a round completed — a missing digest means
  "not delivered", not "never ran".

## Other behaviour worth knowing

- **The final answer text comes back through `job_output`.** Thinking, tool calls,
  and plans are not surfaced. The session id is reported on the job's output ring
  during the run, and the tool result for a foreground call carries it on its own
  line.
- **The child runs in the delegating session's working directory.** A delegation
  cannot be pointed at an arbitrary directory through these tools; the plugin's
  `cwd` config leaf is an override that defaults to empty (= inherit the
  delegating session's current directory).
- **The child does not inherit the parent's model credentials.** It reads its own
  config; an unconfigured child surfaces an auth error rather than degrading.
- **`(dsh session, workspace)` scoping means slots do not leak across
  workspaces** — the same dsh session in a different directory is a different
  slot.

## What this skill does not cover

This skill documents **the tool and its ACP mechanics**. It deliberately says
nothing about what a delegated task must produce, whether a review or an approval
is required, or how a project records its decisions — those belong to the project
you are working in. When a project has its own instructions (`AGENTS.md`,
methodology docs, process rules), read and follow those.
