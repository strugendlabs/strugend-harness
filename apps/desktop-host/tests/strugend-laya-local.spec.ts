/** Process lifecycle fixtures do not assert model quality; real-payload qualification owns those judgments. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalDecisionRuntime, type LocalDecisionOptions } from '../src/strugend-laya-local.ts'
import { layaManifest, verifyLayaAssets } from '../src/strugend-laya-assets.ts'
import * as resources from '../src/strugend-resources.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const signal = new AbortController().signal
const payload = { model: layaManifest.model, state: 'ready', questions: { built: { type: 'noul' as const, instructions: 'Did it build?' } } }

async function fixture(): Promise<{
  directory: string
  runtime: LocalDecisionRuntime
  options: LocalDecisionOptions
  started: () => Promise<{ state: string; pid: number; secretPresent: boolean }>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'strugend-helper-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const helper = join(directory, 'fixture.mjs')
  await writeFile(helper, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
process.on('disconnect', () => process.exit(0));
process.on('message', ({ id, state, options }) => {
  writeFileSync(join(options.directory, 'started'), JSON.stringify({state, pid: process.pid, secretPresent: Object.hasOwn(process.env, 'STRUGEND_TEST_API_KEY')}));
  if (state === 'hold') return;
  if (state === 'crash') process.exit(1);
  if (state === 'load-error') { process.send({id, error: 'Native fixture missing api_key=synthetic-secret'}); return; }
  process.send({id: state === 'wrong-id' ? -1 : id, result: { model: ${JSON.stringify(layaManifest.model)}, revision: state === 'wrong' ? 'bad' : ${JSON.stringify(layaManifest.revision)}, answers: { built: {type: 'noul', noul: .9}}, usage: {input_tokens: 5, output_tokens: 0}}, memory: {rss: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024}});
});`)
  const runtime = new LocalDecisionRuntime(pathToFileURL(helper))
  cleanups.push(() => runtime.dispose())
  const options = { directory, threads: 1, idleMs: 45_000, timeoutMs: 10_000, warmTimeoutMs: 2000, maxQueued: 2,
    pressurePollMs: 2000, restartCooldownMs: 0,
    memory: { minTotalMemoryMiB: 8192, minFreeMemoryMiB: 3072, criticalFreeMemoryMiB: 768 } }
  return { directory, runtime, options, started: async () => JSON.parse(await readFile(join(directory, 'started'), 'utf8')) as { state: string; pid: number; secretPresent: boolean } }
}

it('isolates native memory and credentials in another process, reuses it, and awaits its exit', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  vi.stubEnv('STRUGEND_TEST_API_KEY', 'synthetic-secret')
  const { runtime, options, started } = await fixture()
  expect(await runtime.evaluate(payload, options, signal)).toMatchObject({ runtime: 'local', revision: layaManifest.revision })
  const first = await started()
  expect(first.pid).not.toBe(process.pid)
  expect(first.secretPresent).toBe(false)
  expect(runtime.memoryUsage.rss).toBeGreaterThan(0)
  await runtime.evaluate(payload, options, signal)
  expect((await started()).pid).toBe(first.pid)
  await runtime.unload()
  expect(runtime.isResident).toBe(false)
  expect(runtime.memoryUsage).toEqual({ rss: 0, peakRss: 0 })
  expect(() => process.kill(first.pid, 0)).toThrow()
})

it('admits one active and one pending request, removes cancelled waiting work, and rejects overflow', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options, started } = await fixture()
  const active = new AbortController()
  const running = runtime.evaluate({ ...payload, state: 'hold' }, options, active.signal)
  const rejected = expect(running).rejects.toThrow('active cancelled')
  await expect.poll(async () => (await started()).state).toBe('hold')
  const queued = new AbortController()
  const pending = runtime.evaluate(payload, options, queued.signal)
  const cancelled = expect(pending).rejects.toThrow('queued cancelled')
  await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('queue is full')
  queued.abort(new Error('queued cancelled')); await cancelled
  const replacement = runtime.evaluate(payload, options, signal)
  active.abort(new Error('active cancelled')); await rejected
  expect(await replacement).toHaveProperty('runtime', 'local')
})

it('restarts after a crash or invalid reply and redacts helper errors', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options } = await fixture()
  for (const [state, error] of [['crash', 'helper exited'], ['wrong', 'invalid answer'], ['wrong-id', 'Invalid local Decision reply'], ['load-error', 'api_key=[removed]']]) {
    await expect(runtime.evaluate({ ...payload, state: state! }, options, signal)).rejects.toThrow(error)
    expect(runtime.isResident).toBe(false)
    expect(await runtime.evaluate(payload, options, signal)).toHaveProperty('runtime', 'local')
  }
})

it('does not start another helper during the failure cooldown', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options, started } = await fixture()
  await expect(runtime.evaluate({ ...payload, state: 'crash' }, { ...options, restartCooldownMs: 60_000 }, signal)).rejects.toThrow('helper exited')
  const first = await started()
  await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('recovering')
  expect(await started()).toEqual(first)
})

it('bounds cold and warm execution separately and unloads the idle helper', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options } = await fixture()
  await expect(runtime.evaluate({ ...payload, state: 'hold' }, { ...options, timeoutMs: 100 }, signal)).rejects.toThrow('timed out')
  await runtime.evaluate(payload, options, signal)
  await expect(runtime.evaluate({ ...payload, state: 'hold' }, { ...options, warmTimeoutMs: 100 }, signal)).rejects.toThrow('timed out')
  await runtime.evaluate(payload, { ...options, idleMs: 1 }, signal)
  await expect.poll(() => runtime.isResident).toBe(false)
})

it('does not spawn on a 4 GB machine and terminates resident inference under critical memory pressure', async () => {
  const memory = vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 4096, freeMiB: 3500 })
  const { runtime, options, started } = await fixture()
  await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('memory tier')
  await expect(started()).rejects.toThrow('ENOENT')
  memory.mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const running = runtime.evaluate({ ...payload, state: 'hold' }, { ...options, pressurePollMs: 10 }, signal)
  const stopped = expect(running).rejects.toThrow('helper exited')
  await expect.poll(async () => (await started()).state).toBe('hold')
  const { pid } = await started()
  memory.mockReturnValue({ totalMiB: 16384, freeMiB: 500 })
  await stopped
  expect(() => process.kill(pid, 0)).toThrow()
  expect(runtime.isResident).toBe(false)
})

it('rejects waiting work and reaches process-exit quiescence on disposal', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options, started } = await fixture()
  const running = runtime.evaluate({ ...payload, state: 'hold' }, options, signal)
  const stopped = expect(running).rejects.toThrow('helper exited')
  await expect.poll(async () => (await started()).state).toBe('hold')
  const { pid } = await started()
  const waiting = runtime.evaluate(payload, options, signal)
  const closed = expect(waiting).rejects.toThrow('closed')
  await runtime.dispose(); await stopped; await closed
  expect(() => process.kill(pid, 0)).toThrow()
  await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('closed')
})

it.each([false, true])('unloads active and queued work before component removal, with helper already started: %s', async (startedHelper) => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options, started } = await fixture()
  const running = runtime.evaluate({ ...payload, state: 'hold' }, options, signal)
  const stopped = expect(running).rejects.toThrow(startedHelper ? 'helper exited' : 'unloading')
  if (startedHelper) await expect.poll(async () => (await started()).state).toBe('hold')
  const first = startedHelper ? await started() : undefined
  const waiting = runtime.evaluate(payload, options, signal)
  const cancelled = expect(waiting).rejects.toThrow('unloading')
  const unloading = runtime.unload()
  expect(runtime.unload()).toBe(unloading)
  const refused = expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('unloading')
  await Promise.all([unloading, stopped, cancelled, refused])
  expect(runtime.isResident).toBe(false)
  if (first) {
    expect(() => process.kill(first.pid, 0)).toThrow()
    expect(await started()).toEqual(first)
  } else await expect(started()).rejects.toThrow('ENOENT')
  // The component owner can now replace its files; only a fresh request may restart inference.
  await rm(join(options.directory, 'started'), { force: true })
  expect(await runtime.evaluate(payload, options, signal)).toHaveProperty('runtime', 'local')
  expect((await started()).state).toBe('ready')
})

it('replaces a warm helper for a different component identity without awaiting its own active request', async () => {
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const { runtime, options, started } = await fixture()
  await runtime.evaluate(payload, options, signal)
  const first = await started()
  await runtime.evaluate(payload, { ...options, threads: 2 }, signal)
  expect((await started()).pid).not.toBe(first.pid)
  expect(() => process.kill(first.pid, 0)).toThrow()
})

it('rejects missing, truncated and same-size corrupted assets before inference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strugend-model-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  await expect(verifyLayaAssets(directory)).rejects.toThrow('ENOENT')
  const first = layaManifest.files[0]!
  await writeFile(join(directory, first.file), 'incomplete')
  await expect(verifyLayaAssets(directory)).rejects.toThrow('size mismatch')
  await writeFile(join(directory, first.file), Buffer.alloc(first.size))
  await expect(verifyLayaAssets(directory)).rejects.toThrow('checksum mismatch')
})

it('does not let custom settings lower the physical-memory safety floors', () => {
  const limits = { minTotalMemoryMiB: 0, minFreeMemoryMiB: 0, criticalFreeMemoryMiB: 0 }
  for (const warm of [false, true]) {
    expect(resources.localDecisionAdmission({ totalMiB: 4096, freeMiB: 3500 }, limits, warm).allowed).toBe(false)
  }
  expect(resources.localDecisionAdmission({ totalMiB: 16384, freeMiB: 2500 }, limits, false).allowed).toBe(false)
  expect(resources.localDecisionAdmission({ totalMiB: 16384, freeMiB: 700 }, limits, true).allowed).toBe(false)
})
