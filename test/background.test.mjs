/**
 * B11 background-delegation unit tests — the ten faces of design §6.5: the
 * two-level gate, explicit-wins, the frozen foreground guards, the immediate
 * return, the job spec, the hooks, `done`'s terminal shapes, a start-time
 * rejection, the three degradation states, and the zero-change invariants.
 *
 * Every collaborator is a fake (`ctx.subagents`, `ctx.get('jobs')`): no
 * thincoder process is started and no ACP endpoint is contacted. Lives beside
 * this batch's record and is run directly as stated in §6.5.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createDelegateTool } from '../src/tools.mjs'
import { DEFAULT_DIAGNOSTIC_MAX } from '../src/errors.mjs'

/** The run context a delegation gets: a caller and a step signal. */
const toolExec = (parent = { id: 'parent-1' }) => ({ agent: parent, signal: new AbortController().signal })

/** A fake activation receipt: a terminal result, a dispose counter, and the id the driver would carry. */
const fakeRun = ({ text = 'hello', stopReason = 'completed', sessionId = '7' } = {}) => {
  let disposed = 0
  return {
    childId: 'run-1',
    carrierSessionId: sessionId,
    result: Promise.resolve({ output: [{ type: 'text', text }], stopReason }),
    dispose: async () => { disposed += 1 },
    get disposed() { return disposed },
  }
}

/** A fake jobs registry: like the real one, `start` runs the spec at once. */
function fakeJobs() {
  const specs = []; const ring = []; let hooks
  return { specs, ring,
    start(spec) { specs.push(spec); hooks = spec.run({ id: 'thincoder-1', append: (text) => ring.push(text) }); return 'thincoder-1' },
    hooks() { return hooks } }
}

/** Build a delegation tool over fakes; `withGet: false` = the frozen ctx (no `get`). */
function delegation({ start, jobs, config = {}, withGet = true } = {}) {
  const calls = { subagents: [] }
  const ctx = { subagents: { async startActivation(spec) {
    calls.subagents.push(spec)
    // The driver writes the id at establishment time — the fake does the same (§5.2).
    const carrier = spec.request.thincoderCarrier
    const receipt = start === undefined ? fakeRun() : start(spec, carrier)
    if (carrier !== undefined && receipt.carrierSessionId !== undefined) carrier.sessionId = receipt.carrierSessionId
    return receipt
  } } }
  if (withGet) ctx.get = (name) => (name === 'jobs' ? jobs : undefined)
  return { tool: createDelegateTool({ ctx, config }), calls }
}

/** The promise of one `execute` call, plus the context it ran over. */
function run(options, args) {
  const { tool, calls } = delegation(options)
  return { value: tool.execute({ description: 'd', prompt: 'p', ...args }, toolExec()), calls }
}

// Faces 1 and 2 — the gate: the leaf supplies the default, an explicit argument wins.
test('[1] the gate: explicit wins, else the leaf decides (absent leaf = foreground)', async () => {
  const cases = [
    [{ run_in_background: true }, { runInBackground: false }, 'background'],
    [{ run_in_background: false }, { runInBackground: true }, 'foreground'],
    [{}, { runInBackground: true }, 'background'],
    [{}, { runInBackground: false }, 'foreground'],
    [{}, {}, 'foreground'], // the frozen form: no leaf, no jobs
    [{}, { runInBackground: { get: () => true } }, 'background'], // a volatile reference
  ]
  for (const [args, config, branch] of cases) {
    const jobs = fakeJobs()
    const { tool, calls } = delegation({ jobs, config })
    const value = await tool.execute({ description: 'd', prompt: 'p', ...args }, toolExec())
    const name = JSON.stringify([args, config])
    assert.equal(value.kind === 'background' ? 'background' : 'foreground', branch, name)
    assert.equal(jobs.specs.length, branch === 'background' ? 1 : 0, name)
    // Both branches start the child — only the timing of the return differs.
    assert.equal(calls.subagents.length, 1, name)
  }
})

// Face 3 — the frozen foreground face, asserted inside this batch's own file.
test('[3] frozen foreground: four keys verbatim, the inline render, the four-item inject', async () => {
  const { tool, calls } = delegation({ config: {}, withGet: false })
  const value = await tool.execute({ description: ' work ', prompt: ' do it ' }, toolExec())
  assert.deepEqual(value, { text: 'hello', sessionId: '7', stopReason: 'completed', status: 'completed' })
  assert.equal(calls.subagents.length, 1)
  assert.deepEqual(calls.subagents[0].request.thincoderSession, {})
  const rendered = tool.output.render({}, { text: 'final answer', sessionId: '7', stopReason: 'completed', status: 'completed' })
  assert.equal(rendered[0].text, 'final answer\n\n[thincoder session] 7')
  const module = await import('../src/index.mjs')
  assert.deepEqual(module.inject, ['tools', 'subagents', 'subprocess', 'storageDomain'])
})

// Face 4 — the immediate return: the child is running, the call has returned.
test('[4] the job id comes back while the child is still running', async () => {
  const jobs = fakeJobs()
  const { tool, calls } = delegation({ jobs, config: { runInBackground: true }, start: () => ({ ...fakeRun(), result: new Promise(() => {}) }) })
  const value = await tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  assert.deepEqual(value, { kind: 'background', jobId: 'thincoder-1' })
  assert.equal(calls.subagents.length, 1, 'the child is already running')
  assert.equal(typeof jobs.hooks().done.then, 'function')
})

// Face 5 — the job spec, verbatim, with no plugin-side read-back limit.
test('[5] the job spec is exactly kind / label / owner / run — no outputLimitBytes', async () => {
  const jobs = fakeJobs()
  await run({ jobs, config: { runInBackground: true } }, { description: '  a labelled task  ' }).value
  const spec = jobs.specs[0]
  assert.deepEqual(Object.keys(spec).sort(), ['kind', 'label', 'owner', 'run'])
  assert.equal(spec.kind, 'thincoder')
  assert.equal(spec.label, 'a labelled task')
  assert.equal(spec.owner, 'parent-1')
  assert.equal(typeof spec.run, 'function')
  assert.equal('outputLimitBytes' in spec, false)
})

// Face 6 — the hooks: synchronous, idempotent, wired to the job's own signal.
test('[6] run returns hooks synchronously and cancel aborts the child signal idempotently', async () => {
  const jobs = fakeJobs(); let seen
  const start = (spec) => { seen = spec; return fakeRun() }
  const { tool } = delegation({ jobs, config: { runInBackground: true }, start })
  const exec = toolExec()
  await tool.execute({ description: 'd', prompt: 'p' }, exec)
  const hooks = jobs.hooks()
  assert.equal(typeof hooks.cancel, 'function')
  assert.equal(typeof hooks.done.then, 'function')
  await hooks.done
  assert.equal(seen.signal.aborted, false)
  hooks.cancel()
  hooks.cancel()
  assert.equal(seen.signal.aborted, true)
  assert.equal(exec.signal.aborted, false, 'the job never reuses the step signal')
})

// Face 7 — done's terminal shapes, and the one session chunk in the ring.
test('[7] done resolves the settled outcome; the ring holds one session chunk', async () => {
  const runs = {}
  const options = (jobs, stopReason) => ({ jobs, config: { runInBackground: true }, start: () => (runs[stopReason] = fakeRun({ text: 'the answer', stopReason })) })

  const jobs = fakeJobs()
  await run(options(jobs, 'completed'), {}).value
  assert.deepEqual(await jobs.hooks().done, { status: 'completed', result: 'the answer' })
  assert.deepEqual(jobs.ring, ['[thincoder session] 7'])
  assert.equal(runs.completed.disposed, 1, 'settling releases the run')

  for (const stopReason of ['error', 'refusal']) {
    const failed = fakeJobs()
    await run(options(failed, stopReason), {}).value
    const outcome = await failed.hooks().done
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.detail, new RegExp(stopReason))
    assert.deepEqual(failed.ring, ['[thincoder session] 7'])
  }

  const killed = fakeJobs()
  await run(options(killed, 'aborted'), {}).value
  assert.deepEqual(await killed.hooks().done, { status: 'killed' })
})

// Face 8 — a start-time rejection settles in place, bounded and prefixed.
test('[8] a start-time rejection resolves done as failed with a bounded, prefixed detail', async () => {
  const jobs = fakeJobs()
  const start = () => { throw new Error('x'.repeat(4096)) }
  const { tool } = delegation({ jobs, config: { runInBackground: true }, start })
  await tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  const outcome = await jobs.hooks().done
  assert.equal(outcome.status, 'failed')
  assert.ok(outcome.detail.startsWith('failed to start: '), outcome.detail)
  assert.ok(outcome.detail.length <= 'failed to start: '.length + DEFAULT_DIAGNOSTIC_MAX)
  assert.deepEqual(jobs.ring, [])
})

// Face 9 — degradation: explicit errors, the default path falls back.
test('[9] an explicit request errors without a jobs service; the default path falls back', async () => {
  const explicit = delegation({ config: {}, withGet: false })
  const asked = { description: 'd', prompt: 'p', run_in_background: true }
  await assert.rejects(() => explicit.tool.execute(asked, toolExec()), /jobs service is not available/)
  assert.equal(explicit.calls.subagents.length, 0)

  const soft = delegation({ jobs: undefined, config: {} })
  await assert.rejects(() => soft.tool.execute(asked, toolExec()), /run_in_background: false/)
  assert.equal(soft.calls.subagents.length, 0)

  for (const options of [{ jobs: undefined, config: { runInBackground: true } }, { config: {}, withGet: false }]) {
    const fallback = delegation(options)
    const value = await fallback.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
    assert.deepEqual(value, { text: 'hello', sessionId: '7', stopReason: 'completed', status: 'completed' })
    assert.equal(fallback.calls.subagents.length, 1)
  }
})

// Face 10 — the entry point's structural contract.
//
// B11 originally pinned this with `git diff --stat -- src/index.mjs` ("this batch
// promised not to touch it"). That was a one-shot batch invariant: it goes red on
// ANY later change, including a legitimate rename, so it is not a property worth
// asserting forever. What actually matters is the contract the host depends on —
// the plugin name, the four hard injections, and the exported Config — so that is
// what this face checks now.
test('[10] the entry point keeps its host-facing contract', async () => {
  const module = await import('../src/index.mjs')
  assert.equal(module.name, 'dsh-subagent-thincoder')
  assert.deepEqual(module.inject, ['tools', 'subagents', 'subprocess', 'storageDomain'])
  // schemastery's Config is a callable factory that also carries schema metadata.
  assert.ok(module.Config !== undefined && (typeof module.Config === 'function' || typeof module.Config === 'object'))
  assert.equal(typeof module.apply, 'function')
})
