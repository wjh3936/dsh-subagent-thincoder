# dsh-subagent-thincoder

A continuable [ThinCoder](https://github.com/xinbo-tech/thincoder) subagent for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), speaking ACP.

The problem it solves is one sentence: **a delegation that starts a fresh session
every time cannot continue the work it started.** ThinCoder keeps its workflow
state — an approved design token, a review round, accumulated context — inside a
*session slot*. If every delegation opens a new slot, none of that state is
visible, and a multi-step workflow breaks at the seam.

This plugin gives DSH a delegation path that **reuses the same slot across calls**:
it spawns one `thincoder acp` child, resumes the slot recorded for the current
DSH session and workspace, prompts it, takes the final answer, and releases the
slot before the process is reaped.

## What it adds

| Contribution | Kind | What it does |
|---|---|---|
| `thincoder` provider | subagent provider | One ACP delegation per call. Registers with `ctx.subagents`, so DSH's own subagent machinery drives the lifecycle. |
| `subagent_thincoder` | tool | Starts or resumes a delegation. Background job by default; returns the final answer plus the ThinCoder session id. |
| `subagent_thincoder_sessions` | tool | Lists the ThinCoder sessions that already exist for this workspace. Read-only; starts nothing. |
| Slot record | `storageDomain` (`subagent_thincoder`) | Remembers one session id per *(DSH session, workspace)* pair, so continuation survives a DSH restart. |

The provider deliberately advertises **no start-time capabilities** and
`inheritsParentContext = false`. A child in another process shares no Cordis
context, so it can honor none of the parent-enforced start features; claiming
otherwise would be a silent degradation the service cannot detect.

## Requirements

| | Version | Notes |
|---|---|---|
| DSH | `0.2.1-rc.2` | **Single-version support.** The earlier `0.2.0-rc.2` seam is not supported. |
| ThinCoder CLI | `0.12.76` | Must be on `PATH` as `thincoder`, and its ACP mode must have a provider configured. Verification baseline; see [Compatibility](#compatibility). |
| Node.js | `>=22` | Uses the built-in test runner and `node:test` only. |

ThinCoder is a **separate program**, not a dependency of this package. The plugin
does not install it, and does not read its config: an unauthenticated ThinCoder
surfaces a readable auth error to the caller rather than degrading silently.

Configure it with `thincoder`'s own login flow:

```sh
thincoder acp --login
```

## Install

Install as a DSH plugin bundle. Its `package.json` declares `dsh.bundle`, so the
bundle's patch layer activates on install:

```sh
dsh plugin --profile web add /path/to/dsh-subagent-thincoder
```

The row it inserts injects `tools`, `subagents`, `subprocess`, and
`storageDomain`. A profile missing any of them fails the row loudly instead of
degrading: a delegation path without the subprocess seam or the session store
cannot keep the cross-delegation continuity this plugin exists to provide.

It ships `permission: allow` in its own bundle patch. That is the deployment-side
opt-in the plugin's *own* default (`reject`) keeps safe: a delegating subagent
writes files, and `reject` would cancel every one of the child's permission
requests. If you mount the plugin with your own config, `permission` defaults to
`reject` — set it deliberately.

### Install the skill (optional, recommended)

The repository ships a model-facing usage guide at
[`skills/delegate-to-thincoder/SKILL.md`](skills/delegate-to-thincoder/SKILL.md).
DSH loads skills from `$DSH_HOME/skills/`, so copy it there:

```sh
mkdir -p "${DSH_HOME:-$HOME/.dsh}/skills"
cp -r skills/delegate-to-thincoder "$_/"
```

With it installed, the model gets the tool contract and the two failure modes
(see [Known limitations](#known-limitations)) without having to rediscover them.
It is not part of the npm package — it ships with the Git repo.

## Use

```text
subagent_thincoder(description, prompt, sessionId?, new?, run_in_background?)
```

| Parameter | Meaning |
|---|---|
| `description` | Short human-readable label for this delegation (required) |
| `prompt` | The task text handed to ThinCoder (required) |
| `sessionId` | Resume one specific session. **Mutually exclusive with `new`.** |
| `new` | Explicitly start a fresh session. Default `false`, i.e. *resume*. |
| `run_in_background` | Run as a background job. Defaults to the instance's `runInBackground` leaf, `true` out of the box. |

Resolution order for the session slot:

1. explicit `sessionId` → `session/resume`
2. `new: true` → `session/new`
3. neither → look up the slot recorded for this DSH session + workspace
   - found → resume it
   - not found → start a new one

**There is no automatic fallback.** If an explicit `sessionId` does not exist, or
the recorded slot is gone, the call fails with a readable error rather than
quietly starting a new session. That is deliberate: silently starting over is the
exact failure this plugin exists to remove.

### Background by default

The call starts a background job and returns as soon as the job id is known:

```json
{ "kind": "background", "jobId": "..." }
```

Read the answer with `job_output`. The session id appears in the job's output ring
as soon as the session is established, so it is reachable while the run is still
in flight.

It blocks and answers inline only in three cases: you pass
`run_in_background: false`; this instance defaults to the foreground and you pass
nothing; or the jobs service is unavailable (the default path then falls back).
A **successful** foreground run returns
`{ text, sessionId, stopReason, status }`. Any run ending in a status other than
`completed` — and any run whose teardown fails — **throws** instead, with the
failure detail in the message. A `killed` run still returns the four keys,
because cancellation is a reported outcome rather than a failure.

## Configuration

`config:` on the bundle's mount row is the settings surface. The host projects it
into an editable form under that row's id.

| Leaf | Default | Volatile | Meaning |
|---|---|---|---|
| `providerName` | `thincoder` | no | Provider name registered with `ctx.subagents` |
| `toolName` | `subagent_thincoder` | no | Delegation tool name |
| `sessionToolName` | `subagent_thincoder_sessions` | no | Listing tool name |
| `command` | `thincoder` | yes | Executable name or path |
| `args` | `['acp']` | yes | Arguments passed to the command |
| `cwd` | `''` | yes | `''` ⇒ inherit the delegating session's current directory; a non-empty value is a request override and must be absolute and enterable |
| `permission` | `reject` | yes | `allow` answers the child's permission requests with its first `allow_once`/`allow_always` option; `reject` always answers `cancelled` |
| `env` | `{}` | yes | Extra environment for the child |
| `disposeEofGraceMs` | `6000` | yes | Window after stdin EOF before escalation |
| `disposeGraceMs` | `3000` | yes | Termination-escalation grace |
| `runInBackground` | `true` | yes | Instance default for `run_in_background` |

The three **identity** leaves are not volatile: renaming a provider or a tool
changes the registered catalog, so it remounts the fiber. Every other leaf is
read per delegation, so a settings write takes effect on the next call without
re-registering anything.

### cwd is resolved by the host

With `cwd: ''` (the default) the plugin sends **no** `cwd`, and DSH uses the
delegating session's **current** directory. That is not the session header's
`cwd` — the header carries the session's original project identity and goes stale
the moment the user changes directory. A non-empty `cwd` is validated as absolute
and enterable **before any process exists**.

## Storage

The slot record lives in the `subagent_thincoder` storage domain, which DSH
materializes at:

```
$DSH_HOME/storages/subagent_thincoder.json
```

with one table, `session_links`. The domain name uses an **underscore**, not a
hyphen: DSH's `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so a hyphenated name fails
at declaration time. It also cannot be `thincoder` — a domain may only be opened
once per facility, and the separate `dsh-thincoder` plugin already holds that
name open.

Deleting that file drops every slot link. The effect is that the next delegation
in each workspace starts a new session — records are pointers, not caches, so a
deleted or unreadable record is reported rather than silently rebuilt.

## Known limitations

Two behaviours are ThinCoder's, not this plugin's, and both are worth knowing
before relying on a delegation:

**Silent fork under concurrency.** ThinCoder's slot semantics are "if the slot is
claimed by another live process, fork to a new one". The plugin adds no lock, so
the session id it reports back is taken from the request and **may not equal the
slot actually used**. A fork leaves a trace on the child's inherited stderr —
`slot busy, forked to <N>` — which the plugin does not parse but a human can read.
Run slot-dependent workflows sequentially.

**Async children do not survive the delegation.** ThinCoder's async work (a
`subagent` spawn that answers `{id, status: "running"}`, async advisor reviews)
lives in an in-process pool owned by the `thincoder acp` child. In ACP mode the
suspension driver never runs, and the plugin reaps the child at the end of every
delegation — so a child still running when the prompt returns is lost. This is
about ThinCoder's *inner* pool; DSH's background jobs are a different layer and
do not lift it. Have long work write to a file and read that file back.

Both are documented in full, with the reasoning and the observation points, in the
[skill](skills/delegate-to-thincoder/SKILL.md).

## Compatibility

The contract with ThinCoder is **the ACP surface**, not a version number. The
plugin does not read `thincoder --version`, and does not gate on it. What it
depends on is eight protocol faces — `initialize`, `session/new`, `session/resume`,
`session/prompt`, `session/cancel`, `session/close`, `session/list`, and
`session/request_permission` — each with a defined failure mode if it breaks.

The verification baseline is ThinCoder **`0.12.76`** (core `0.10.9`). Versions
`0.12.73` → `0.12.75` → `0.12.76` were each checked and found to keep every one of
those faces intact. The full surface list, per-face usage, and the reasoning for
"faces rather than a version floor" live in
[`docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md` §5.1](docs/requirements/REQUIREMENTS-dsh-subagent-thincoder.md).

## Platform support

| Platform | Unit tests | End-to-end delegation |
|---|---|---|
| Linux | ✅ CI | not verified |
| macOS | ✅ CI | ✅ verified |
| Windows | ✅ CI | ⚠️ **not verified** |

The Windows-specific code — starting a `.cmd` shim through `cmd /d /s /c call`,
refusing `args` entries that carry command-interpreter metacharacters, folding
case in continuation keys, reading `ComSpec` case-insensitively — is covered by
unit tests that inject the platform, and those run on every OS in CI.

What has **not** been verified on Windows is an end-to-end delegation against a
real DSH host and ThinCoder install. Path/process semantics there differ from
POSIX in ways unit tests cannot fully stand in for. See
[`docs/VERIFY-win32.md`](docs/VERIFY-win32.md) for the exact checklist and what CI
does and does not cover.

## Development

```sh
npm test
```

78 tests, no external test framework — `node:test` only. The suite runs against
stubs and fakes: no real `thincoder` process is started and no ACP endpoint is
contacted.

```sh
npm pack --dry-run   # confirm the package carries src/ and cordis.patch.yml only
```

Docs, tests, and the skill ship with the Git repository but stay out of the npm
package.

## Documentation

| Document | Contents |
|---|---|
| [`docs/requirements/`](docs/requirements/) | Requirements, acceptance criteria, and the pinned external-fact table |
| [`docs/design/`](docs/design/) | Architecture, module design, interface contracts, decision log |
| [`docs/STANDARDS.md`](docs/STANDARDS.md) | Declared criteria and existing facts for review and implementation |
| [`docs/VERIFY-win32.md`](docs/VERIFY-win32.md) | What is verified on Windows, what is not, and how to check |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Release and mirror workflow |
| [`docs/batches/`](docs/batches/) | Per-batch development records, kept append-only and frozen once closed |

The batch records are internal engineering history. They are published for
completeness, not as required reading — start from the requirements and design
documents.

## License

MIT. See [LICENSE](LICENSE).

## Related work

- `dsh-thincoder` — ThinCoder's design-first engineering workflow as a DSH
  bundle (not currently published). That project decides *how* work is carried
  out; this one provides the *delegation channel* to ThinCoder. They compose, and
  neither depends on the other: this plugin is useful on its own, and works with
  or without that bundle.
