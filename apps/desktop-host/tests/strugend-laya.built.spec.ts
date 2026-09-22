/** Qualification of the real optional Decision component and compiled process helper. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { LocalDecisionRuntime } from '../src/strugend-laya-local.ts'
import { decisionResources, localDecisionAdmission } from '../src/strugend-resources.ts'
import { compileReview } from '../src/strugend-review.ts'
import { prepareDecision } from '../src/strugend-decision.ts'
import { layaManifest } from '../src/strugend-laya-assets.ts'
import { decisionQualityCases } from './fixtures/decision-quality.ts'
import { decisionQualityReport, type QualityObservation } from './fixtures/decision-quality-report.ts'

it.skipIf(!process.env.LAYA_MODEL_TEST)('qualifies the real native helper without weakening device admission', async (context) => {
  const packaged = process.env.LAYA_PACKAGED_ROOT
  const worker = packaged ? join(packaged, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/strugend-laya-worker.js')
    : 'apps/desktop-host/lib/strugend-laya-worker.js'
  const component = resolve(process.env.LAYA_COMPONENT_ROOT ?? (packaged ? join(packaged, 'components/decision') : '.artifacts/components/decision'))
  const options = { directory: join(component, 'model'), runtimeDirectory: component, threads: 1, idleMs: 45_000,
    timeoutMs: 15_000, warmTimeoutMs: 2000, maxQueued: 2, pressurePollMs: 2000, restartCooldownMs: 60_000,
    memory: { minTotalMemoryMiB: 8192, minFreeMemoryMiB: 3072, criticalFreeMemoryMiB: 768 } }
  const resources = decisionResources()
  const admission = localDecisionAdmission(resources, options.memory, false)
  await mkdir('.artifacts/strugend', { recursive: true })
  const artifact = `.artifacts/strugend/local-laya-${packaged ? 'payload-' : ''}${process.platform}-${process.arch}.json`
  if (!admission.allowed) {
    await writeFile(artifact, JSON.stringify({ status: 'skipped-resource-admission', resources, reason: admission.reason, qualified: false }, null, 2) + '\n')
    context.skip(admission.reason)
  }
  const runtime = new LocalDecisionRuntime(pathToFileURL(resolve(worker)))
  const payload = { model: layaManifest.model, state: 'The build exited with code 0. No browser test has run.', questions: {
    built: { type: 'noul' as const, instructions: 'Did the build exit with code zero?' },
  } }
  try {
    const baselineHostRss = process.memoryUsage().rss
    const started = performance.now()
    const first = await runtime.evaluate(payload, options, new AbortController().signal)
    const coldMs = performance.now() - started
    expect(first.model).toBe(payload.model); expect(first.runtime).toBe('local')
    const warm = performance.now()
    const second = await runtime.evaluate({ ...payload, state: '构建以退出代码零结束。还没有运行浏览器测试。' }, options, new AbortController().signal)
    const warmMs = performance.now() - warm
    const loadedHostRss = process.memoryUsage().rss
    const helperMemory = runtime.memoryUsage
    const observations: QualityObservation[] = []
    for (const fixture of decisionQualityCases) {
      const start = performance.now()
      try {
        const request = prepareDecision(compileReview(fixture.input), { decisionUrl: 'https://api.impossibl.com/v1/systemone', decisionModels: [layaManifest.model], timeoutMs: 2000, maxBytes: 1_048_576, maxQuestions: 5 })
        const result = await runtime.evaluate(request, options, new AbortController().signal)
        const answers = result.answers
        const answer = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers.review : undefined
        const value = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : undefined
        observations.push({ id: fixture.id, durationMs: performance.now() - start,
          ...(typeof value?.choice === 'string' ? { choice: value.choice } : {}), ...(typeof value?.confidence === 'number' ? { confidence: value.confidence } : {}) })
      } catch (error) {
        observations.push({ id: fixture.id, durationMs: performance.now() - start, error: error instanceof Error ? error.message : 'Inference failed.' })
      }
    }
    const quality = decisionQualityReport(decisionQualityCases, observations, .9)
    await runtime.unload()
    const unloadedHostRss = process.memoryUsage().rss
    expect(runtime.isResident).toBe(false)
    expect(runtime.memoryUsage).toEqual({ rss: 0, peakRss: 0 })
    await writeFile(artifact, JSON.stringify({ status: 'measured', model: layaManifest.model, revision: layaManifest.revision,
      coldMs, warmMs, baselineHostRss, loadedHostRss, unloadedHostRss, helperMemory, resources, first, second, quality, observations }, null, 2) + '\n')
    expect(second.runtime).toBe('local'); expect(second.answers).toHaveProperty('built')
    if (process.env.LAYA_REQUIRE_QUALIFIED === '1') expect(Object.values(quality.intents).every(result => result.qualified)).toBe(true)
    const abort = new AbortController(); abort.abort(new Error('cancelled by fixture'))
    await expect(runtime.evaluate(payload, options, abort.signal)).rejects.toThrow('cancelled by fixture')
  } finally { await runtime.dispose() }
}, 180_000)
