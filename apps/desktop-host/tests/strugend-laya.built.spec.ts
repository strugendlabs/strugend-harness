/** Qualification of the actual pinned model and compiled inference worker, without an API key. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { LocalDecisionRuntime } from '../src/strugend-laya-local.ts'

it.skipIf(!process.env.LAYA_MODEL_TEST)('runs real multilingual local decisions, reuses warm weights, and cancels without network', async () => {
  const packaged = process.env.LAYA_PACKAGED_ROOT
  const worker = packaged ? join(packaged, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/strugend-laya-worker.js')
    : 'apps/desktop-host/lib/strugend-laya-worker.js'
  const runtime = new LocalDecisionRuntime(pathToFileURL(resolve(worker)))
  // This opt-in measurement qualifies native inference; device admission has separate mocked-memory tests.
  const options = { directory: resolve(packaged ? join(packaged, 'runtime/laya') : '.artifacts/laya-model'), threads: 1, idleMs: 45_000, timeoutMs: 90_000, maxQueued: 4,
    memory: { minTotalMemoryMiB: 4096, minFreeMemoryMiB: 0, criticalFreeMemoryMiB: 0 } }
  const payload = { model: 'convaiinnovations/laya-multilingual', state: 'The build exited with code 0. No browser test has run.', questions: {
    built: { type: 'noul' as const, instructions: 'Did the build exit with code zero?' },
    next: { type: 'choice' as const, instructions: 'Which verification is missing?', criteria: { browser: 'Browser verification', build: 'Build exit status' } },
  } }
  try {
    const baselineRss = process.memoryUsage().rss
    const started = Date.now()
    const first = await runtime.evaluate(payload, options, new AbortController().signal)
    const coldMs = Date.now() - started
    expect(first.model).toBe(payload.model); expect(first.runtime).toBe('local')
    const warm = Date.now()
    const second = await runtime.evaluate({ ...payload, state: '构建以退出代码零结束。还没有运行浏览器测试。' }, options, new AbortController().signal)
    const warmMs = Date.now() - warm
    const loadedRss = process.memoryUsage().rss
    await runtime.unload()
    const unloadedRss = process.memoryUsage().rss
    expect(runtime.isResident).toBe(false)
    await mkdir('.artifacts/strugend', { recursive: true })
    await writeFile(`.artifacts/strugend/local-laya-${packaged ? 'payload-' : ''}${process.platform}-${process.arch}.json`, JSON.stringify({ coldMs, warmMs, baselineRss, loadedRss, unloadedRss, first, second }, null, 2) + '\n')
    expect(second.runtime).toBe('local'); expect(second.answers).toHaveProperty('built')
    const abort = new AbortController(); abort.abort(new Error('cancelled by fixture'))
    await expect(runtime.evaluate(payload, options, abort.signal)).rejects.toThrow('cancelled by fixture')
  } finally { await runtime.dispose() }
}, 180_000)
