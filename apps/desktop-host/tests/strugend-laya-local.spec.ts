/** Worker lifecycle failures use a private protocol fixture; model quality uses the real built smoke. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { LocalDecisionRuntime } from '../src/strugend-laya-local.ts'
import { layaManifest, verifyLayaAssets } from '../src/strugend-laya-assets.ts'
import * as resources from '../src/strugend-resources.ts'

it('cancels queued and active work, bounds the queue, and restarts after crashes and deadlines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strugend-worker-'))
  const worker = join(directory, 'fixture.mjs')
  await writeFile(worker, `import { parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
parentPort.on('message', ({id, state}) => {
  writeFileSync(join(workerData.directory, 'started'), state);
  if (state === 'hold') return;
  if (state === 'crash') process.exit(1);
  parentPort.postMessage({id, result: { model: ${JSON.stringify(layaManifest.model)}, revision: state === 'wrong' ? 'bad' : ${JSON.stringify(layaManifest.revision)}, answers: { built: {type: 'noul', noul: .9}}, usage: {input_tokens: 5, output_tokens: 0}}});
});`)
  const runtime = new LocalDecisionRuntime(pathToFileURL(worker))
  const options = { directory, threads: 1, idleMs: 45_000, timeoutMs: 10_000, maxQueued: 1,
    memory: { minTotalMemoryMiB: 8192, minFreeMemoryMiB: 2048, criticalFreeMemoryMiB: 768 } }
  const memory = vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
  const payload = { model: layaManifest.model, state: 'hold', questions: { built: { type: 'noul' as const, instructions: 'Did it build?' } } }
  const signal = new AbortController().signal
  try {
    const active = new AbortController()
    const running = runtime.evaluate(payload, options, active.signal)
    const rejected = expect(running).rejects.toThrow('active cancelled')
    await expect.poll(async () => readFile(join(directory, 'started'), 'utf8'), { timeout: 8000 }).toBe('hold')
    await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('queue is full')
    const queued = new AbortController()
    const cancelled = runtime.evaluate(payload, { ...options, maxQueued: 2 }, queued.signal)
    queued.abort(new Error('queued cancelled'))
    await expect(cancelled).rejects.toThrow('queued cancelled')
    active.abort(new Error('active cancelled')); await rejected
    expect(await runtime.evaluate({ ...payload, state: 'ready' }, { ...options, idleMs: 1 }, signal)).toMatchObject({ runtime: 'local', revision: layaManifest.revision })
    await expect.poll(() => runtime.isResident, { timeout: 8000 }).toBe(false)
    await expect(runtime.evaluate({ ...payload, state: 'crash' }, options, signal)).rejects.toThrow('worker exited')
    await expect(runtime.evaluate({ ...payload, state: 'wrong' }, options, signal)).rejects.toThrow('invalid answer')
    await expect(runtime.evaluate(payload, { ...options, timeoutMs: 100 }, signal)).rejects.toThrow('timed out')
    await rm(join(directory, 'started'), { force: true })
    const holding = new AbortController()
    const beforePressure = runtime.evaluate(payload, options, holding.signal)
    const released = expect(beforePressure).rejects.toThrow('release for pressure test')
    await expect.poll(async () => readFile(join(directory, 'started'), 'utf8'), { timeout: 8000 }).toBe('hold')
    const afterPressure = runtime.evaluate({ ...payload, state: 'ready' }, { ...options, maxQueued: 2 }, signal)
    const denied = expect(afterPressure).rejects.toThrow('reserve memory')
    memory.mockReturnValue({ totalMiB: 16384, freeMiB: 500 })
    holding.abort(new Error('release for pressure test')); await released; await denied
    expect(runtime.isResident).toBe(false)
    memory.mockReturnValue({ totalMiB: 16384, freeMiB: 8192 })
    expect(await runtime.evaluate({ ...payload, state: 'ready' }, options, signal)).toHaveProperty('runtime', 'local')
    const closing = runtime.evaluate(payload, options, signal)
    const closed = expect(closing).rejects.toThrow(/closed|exited/u)
    await runtime.dispose(); await closed
    await expect(runtime.evaluate(payload, options, signal)).rejects.toThrow('closed')
  } finally { await runtime.dispose(); memory.mockRestore(); await rm(directory, { recursive: true, force: true }) }
}, 30_000)

it('rejects missing, truncated and same-size corrupted assets before inference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strugend-model-'))
  try {
    await expect(verifyLayaAssets(directory)).rejects.toThrow('ENOENT')
    const first = layaManifest.files[0]!
    await writeFile(join(directory, first.file), 'incomplete')
    await expect(verifyLayaAssets(directory)).rejects.toThrow('size mismatch')
    await writeFile(join(directory, first.file), Buffer.alloc(first.size))
    await expect(verifyLayaAssets(directory)).rejects.toThrow('checksum mismatch')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
