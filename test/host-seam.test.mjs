/**
 * B12 host-seam unit tests — design §9.7 cases 70–84 (F1–F10 + the two review interleavings).
 * All collaborators are fakes: no process, no ACP endpoint.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createDelegateTool, createSessionsTool } from '../src/tools.mjs'
import { createProvider } from '../src/provider.mjs'
import { CARRIER_LOST_TEXT } from '../src/errors.mjs'

/** The behaviour graces a real config resolves (the listing path validates them). */
const BEHAVIOUR = { disposeEofGraceMs: 6000, disposeGraceMs: 3000 }
const toolExec = (parent = { id: 'parent-1', session: { id: 's1', header: {} } }, signal) =>
  ({ agent: parent, signal: signal ?? new AbortController().signal })
const tick = () => new Promise((resolve) => setImmediate(resolve))

function fakeSignal() {
  const listeners = new Set()
  return { aborted: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    abort() { this.aborted = true; for (const listener of [...listeners]) listener() },
    get listenerCount() { return listeners.size } }
}

/** A receipt. `dispose()` is idempotent like the seam's (`disposed` = effective
 * disposals, `disposeCalls` = invocations); a deferred result settles as aborted
 * when disposed, because teardown drives settlement. */
function fakeActivation({ sessionId = '7', text = 'answer', stopReason = 'completed', diagnostic, disposeError, deferred = false } = {}) {
  let settle
  const result = deferred ? new Promise((resolve) => { settle = resolve })
    : Promise.resolve({ output: [{ type: 'text', text }], stopReason, ...(diagnostic === undefined ? {} : { diagnostic }) })
  const activation = { sessionId, childId: 'child-1', result, disposed: 0, disposeCalls: 0,
    settle: (value) => settle?.(value ?? { output: [], stopReason: 'aborted' }),
    dispose: async () => {
      activation.disposeCalls += 1
      activation.disposed = 1
      activation.settle()
      if (disposeError !== undefined) throw disposeError
    } }
  return activation
}

/** A jobs registry: like the real one, `start` runs the spec at once. */
function fakeJobs() {
  const specs = []
  const ring = []
  let hooks
  return { specs, ring,
    start(spec) { specs.push(spec); hooks = spec.run({ id: 'thincoder-1', append: (text) => ring.push(text) }); return 'thincoder-1' },
    hooks: () => hooks }
}

/** A delegation tool over a fake seam; `write: false` models an empty carrier. */
function delegation({ activation = fakeActivation(), write = true, config = BEHAVIOUR, jobs } = {}) {
  const specs = []
  const ctx = { subagents: { async startActivation(spec) {
    specs.push(spec)
    if (write) spec.request.thincoderCarrier.sessionId = activation.sessionId
    return activation
  } } }
  if (jobs !== undefined) ctx.get = (name) => (name === 'jobs' ? jobs : undefined)
  return { tool: createDelegateTool({ ctx, config }), specs, activation }
}

test('[70/71/F1/F2] the spec is verbatim and the carrier survives the receipt and the disposal', async () => {
  const { tool, specs, activation } = delegation({ activation: fakeActivation({ text: 'final answer' }) })
  const value = await tool.execute({ description: ' work ', prompt: ' do it ' }, toolExec())
  assert.deepEqual(value, { text: 'final answer', sessionId: '7', stopReason: 'completed', status: 'completed' })
  const spec = specs[0]
  assert.deepEqual(Object.keys(spec).sort(), ['delivery', 'label', 'provider', 'request', 'signal'])
  assert.deepEqual([spec.provider, spec.label, spec.delivery], ['thincoder', 'work', 'caller'])
  assert.equal(typeof spec.signal.addEventListener, 'function')
  assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'do it' }])
  assert.deepEqual(spec.request.thincoderSession, {})
  assert.deepEqual(['label' in spec.request, 'signal' in spec.request], [false, false])
  assert.equal(activation.disposed, 1)
  assert.equal(spec.request.thincoderCarrier.sessionId, '7')
})

test('[72/73/F3/F4] an empty carrier is a readable loss; a rejected start keeps its own error face', async () => {
  await assert.rejects(
    () => delegation({ write: false }).tool.execute({ description: 'd', prompt: 'p' }, toolExec()),
    /not carried back to the plugin/,
  )
  const jobs = fakeJobs()
  await delegation({ write: false, jobs, config: { ...BEHAVIOUR, runInBackground: true } }).tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  const outcome = await jobs.hooks().done
  assert.equal(outcome.status, 'failed')
  assert.ok(outcome.detail.includes('not carried back to the plugin'), outcome.detail)
  assert.deepEqual(jobs.ring, [])

  const ctx = { subagents: { async startActivation() { throw new Error('session/new failed: 项目不可解析') } } }
  await assert.rejects(
    () => createDelegateTool({ ctx, config: BEHAVIOUR }).execute({ description: 'd', prompt: 'p' }, toolExec()),
    (error) => /项目不可解析/.test(error.message) && !/carried back/.test(error.message),
  )
  const failed = fakeJobs()
  const failing = createDelegateTool({ ctx: { ...ctx, get: () => failed }, config: { ...BEHAVIOUR, runInBackground: true } })
  await failing.execute({ description: 'd', prompt: 'p' }, toolExec())
  const failedOutcome = await failed.hooks().done
  assert.equal(failedOutcome.status, 'failed')
  assert.match(failedOutcome.detail, /^failed to start: .*项目不可解析/)
})

test('[74/75/F5] completed carries the text after the result (never before); the settle table holds', async () => {
  const activation = fakeActivation({ deferred: true })
  const running = delegation({ activation }).tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  await tick()
  assert.equal(activation.disposeCalls, 0, 'nothing is disposed while the result is still pending')
  activation.settle({ output: [{ type: 'text', text: 'late answer' }], stopReason: 'completed' })
  assert.deepEqual(await running, { text: 'late answer', sessionId: '7', stopReason: 'completed', status: 'completed' })
  assert.equal(activation.disposeCalls, 1)

  const cases = [
    [{ stopReason: 'aborted' }, 'killed', undefined],
    [{ stopReason: 'aborted', diagnostic: 'the host asked the child to stop' }, 'failed', /^aborted: the host/],
    [{ stopReason: 'error', diagnostic: 'transport lost' }, 'failed', /^error: transport lost/],
    [{ stopReason: 'refusal' }, 'failed', /^refusal: /],
  ]
  for (const [shape, status, pattern] of cases) {
    const jobs = fakeJobs()
    const target = delegation({ activation: fakeActivation(shape), jobs, config: { ...BEHAVIOUR, runInBackground: true } })
    await target.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
    const outcome = await jobs.hooks().done
    assert.equal(outcome.status, status, JSON.stringify(shape))
    if (pattern !== undefined) assert.match(outcome.detail, pattern)
  }

  const disposeJobs = fakeJobs()
  const disposed = fakeActivation({ disposeError: new Error('the child was already gone') })
  const teardown = delegation({ activation: disposed, jobs: disposeJobs, config: { ...BEHAVIOUR, runInBackground: true } })
  await teardown.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  const failed = await disposeJobs.hooks().done
  assert.deepEqual([failed.status, disposed.disposed], ['failed', 1])
  assert.match(failed.detail, /dispose failed: the child was already gone$/)
})

test('[77/78/F7] a foreground abort disposes once; a startup cancel only aborts; a post-receipt cancel disposes', async () => {
  const signal = fakeSignal()
  const activation = fakeActivation({ deferred: true })
  const running = delegation({ activation }).tool.execute({ description: 'd', prompt: 'p' }, toolExec(undefined, signal))
  await tick()
  signal.abort()
  assert.deepEqual(await running, { text: '', sessionId: '7', stopReason: 'aborted', status: 'killed' })
  assert.deepEqual([activation.disposeCalls, activation.disposed], [2, 1], 'the abort and the settle each dispose once')
  assert.equal(signal.listenerCount, 0, 'the listener is removed in finally')
  const startupJobs = fakeJobs()
  const startupCtx = { subagents: { startActivation: (spec) => new Promise((_resolve, reject) => {
    spec.signal.addEventListener('abort', () => reject(new Error('aborted before publication')))
  }) }, get: () => startupJobs }
  await createDelegateTool({ ctx: startupCtx, config: { ...BEHAVIOUR, runInBackground: true } }).execute({ description: 'd', prompt: 'p' }, toolExec())
  startupJobs.hooks().cancel()
  const startupOutcome = await startupJobs.hooks().done
  assert.equal(startupOutcome.status, 'failed')
  assert.match(startupOutcome.detail, /^failed to start: aborted before publication/)
  assert.deepEqual(startupJobs.ring, [], 'a startup cancel reclaims nothing and publishes nothing')
  const jobs = fakeJobs()
  const published = fakeActivation({ deferred: true })
  const target = delegation({ activation: published, jobs, config: { ...BEHAVIOUR, runInBackground: true } })
  await target.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  await tick()
  jobs.hooks().cancel()
  assert.deepEqual([published.disposeCalls, published.disposed], [1, 1], 'cancel reaches the activation')
  assert.equal((await jobs.hooks().done).status, 'killed')
  assert.deepEqual([published.disposeCalls, published.disposed], [2, 1], 'settlement disposes again, once')
})

test('[79/80/F8] config.cwd is an override; empty sends no key; bad values are refused before any activation', async () => {
  const configured = delegation({ config: { ...BEHAVIOUR, cwd: process.cwd() } })
  await configured.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  assert.equal(configured.specs[0].request.cwd, process.cwd())
  const empty = delegation({ config: { ...BEHAVIOUR, cwd: '' } })
  await empty.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  assert.equal('cwd' in empty.specs[0].request, false)
  for (const cwd of ['relative/path', `/nonexistent-${process.pid}-b12`]) {
    const { tool, specs } = delegation({ config: { ...BEHAVIOUR, cwd } })
    await assert.rejects(() => tool.execute({ description: 'd', prompt: 'p' }, toolExec()), /config cwd/)
    assert.equal(specs.length, 0)
  }
  await assert.rejects(() => createProvider({}, {}, {}).start({ cwd: '' }), /resolved no working directory/)
})

test('[81/F9] enumeration falls back projection → session header and errors when all are empty', async () => {
  const seen = []
  const lister = async (_request, spec) => { seen.push(spec.cwd); return [] }
  const parent = { id: 'p', session: { id: 's', header: { cwd: '/header/ws' } } }
  await createSessionsTool({ ctx: {}, config: BEHAVIOUR, listSessions: lister }).execute({}, toolExec(parent))
  let given
  const wd = { get: (session) => { given = session; return '/projected/ws' } }
  const withService = { ctx: { get: (name) => (name === 'workingDirectory' ? wd : undefined) }, config: BEHAVIOUR, listSessions: lister }
  await createSessionsTool(withService).execute({}, toolExec(parent))
  assert.deepEqual([seen, given.id], [['/header/ws', '/projected/ws'], 's'], 'the projection receives the Session object')
  let listed = 0
  const bare = createSessionsTool({ ctx: {}, config: BEHAVIOUR, listSessions: async () => { listed += 1; return [] } })
  await assert.rejects(() => bare.execute({}, toolExec({ id: 'p', session: { id: 's', header: {} } })), /cannot resolve a working directory/)
  assert.equal(listed, 0)
})

test('[82/F10] two concurrent delegations carry their own session ids', async () => {
  const boxes = []
  let release
  const both = new Promise((resolve) => { release = resolve })
  const ctx = { subagents: { async startActivation(spec) {
    const id = spec.label
    boxes.push(spec.request.thincoderCarrier)
    if (boxes.length === 2) release()
    await both
    spec.request.thincoderCarrier.sessionId = id
    return { childId: id, result: Promise.resolve({ output: [{ type: 'text', text: id }], stopReason: 'completed' }), dispose: async () => {} }
  } } }
  const tool = createDelegateTool({ ctx, config: BEHAVIOUR })
  const [a, b] = await Promise.all([
    tool.execute({ description: 'A', prompt: 'p' }, toolExec()),
    tool.execute({ description: 'B', prompt: 'p' }, toolExec())])
  assert.notEqual(boxes[0], boxes[1], 'each delegation owns its box')
  assert.deepEqual([a.sessionId, a.text, b.sessionId, b.text], ['A', 'A', 'B', 'B'])
})

test('[83] the id is published while the run is pending, and a window cancel still disposes', async () => {
  const jobs = fakeJobs()
  const activation = fakeActivation({ deferred: true })
  activation.dispose = async () => { activation.disposeCalls += 1; activation.disposed = 1 }
  let release
  const ctx = { subagents: { async startActivation(spec) {
    await new Promise((resolve) => { release = resolve })
    spec.request.thincoderCarrier.sessionId = activation.sessionId
    return activation
  } }, get: () => jobs }
  await createDelegateTool({ ctx, config: { ...BEHAVIOUR, runInBackground: true } })
    .execute({ description: 'd', prompt: 'p' }, toolExec())
  jobs.hooks().cancel()
  assert.equal(activation.disposeCalls, 0, 'there is nothing to dispose before the receipt')
  release()
  await tick()
  assert.deepEqual([jobs.ring, activation.disposeCalls], [['[thincoder session] 7'], 1], 'published while the run is still pending')
  activation.settle({ output: [], stopReason: 'aborted' })
  assert.equal((await jobs.hooks().done).status, 'killed', 'the run has a terminal state instead of finishing on its own')
  assert.deepEqual([activation.disposeCalls, activation.disposed], [2, 1], 'the re-check and the settle each dispose once')
})

test('[84] an empty carrier plus a failed teardown keeps both diagnostics', async () => {
  const activate = () => fakeActivation({ disposeError: new Error('teardown could not reach the child') })
  const foreground = delegation({ activation: activate(), write: false })
  await assert.rejects(
    () => foreground.tool.execute({ description: 'd', prompt: 'p' }, toolExec()),
    (error) => error.message.includes(CARRIER_LOST_TEXT)
      && /dispose failed: teardown could not reach the child$/.test(error.message),
  )
  assert.equal(foreground.activation.disposed, 1, 'the disposal ran before the error was raised')
  const jobs = fakeJobs()
  await delegation({ activation: activate(), write: false, jobs, config: { ...BEHAVIOUR, runInBackground: true } })
    .tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  const outcome = await jobs.hooks().done
  assert.equal(outcome.status, 'failed')
  assert.ok(outcome.detail.includes(CARRIER_LOST_TEXT), outcome.detail)
  assert.match(outcome.detail, /dispose failed: teardown could not reach the child$/)
  assert.deepEqual(jobs.ring, [])
})

test('[85] a failed foreground outcome is an error, never an empty-looking answer', async () => {
  const failed = delegation({ activation: fakeActivation({ stopReason: 'error', diagnostic: 'thincoder exited 1' }) })
  await assert.rejects(
    () => failed.tool.execute({ description: 'd', prompt: 'p' }, toolExec()),
    (error) => /the delegation failed — error: thincoder exited 1$/.test(error.message),
  )
  assert.equal(failed.activation.disposed, 1, 'the disposal ran before the error was raised')

  const teardown = delegation({ activation: fakeActivation({ disposeError: new Error('teardown could not reach the child') }) })
  await assert.rejects(
    () => teardown.tool.execute({ description: 'd', prompt: 'p' }, toolExec()),
    (error) => /the delegation failed — dispose failed: teardown could not reach the child$/.test(error.message),
  )

  // A user cancellation is an answer, not an error: it still returns the four keys.
  const killed = delegation({ activation: fakeActivation({ stopReason: 'aborted' }) })
  const value = await killed.tool.execute({ description: 'd', prompt: 'p' }, toolExec())
  assert.equal(value.status, 'killed')
})

