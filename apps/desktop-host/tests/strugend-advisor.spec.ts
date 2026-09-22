/** The primary agent stays independent of auxiliary latency, confidence and device size. */
import { expect, it, vi } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { BackgroundAdvisor, confidentAdvice } from '../src/strugend-advisor.ts'
import { localDecisionAdmission } from '../src/strugend-resources.ts'

const input = { checkpoint: 'verification', state: 'Build exited zero.', questions: { passed: { type: 'noul', instructions: 'Did the build pass?' } } }
const options = { intervalMs: 5000, deadlineMs: 1000, maxConcurrent: 1, maxAgeMs: 5000, minConfidence: 0.85 }
const answer = { available: true, answers: { passed: { type: 'noul', noul: 0.99 } } }

it('returns immediately, rejects stale advice, bounds all tasks, and only consumes fresh confident results once', async () => {
  vi.useFakeTimers()
  let finish: (value: Record<string, JsonValue>) => void = () => {}
  const evaluate = vi.fn(() => new Promise<Record<string, JsonValue>>((resolve) => { finish = resolve }))
  const advisor = new BackgroundAdvisor(evaluate), owner = {}, other = {}
  try {
    advisor.submit(owner, input, new AbortController().signal, options)
    await Promise.resolve()
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(advisor.take(owner, options.maxAgeMs)).toBeUndefined()
    advisor.submit(other, input, new AbortController().signal, options)
    advisor.invalidate(owner)
    finish(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(advisor.take(owner, options.maxAgeMs)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(5000)
    advisor.submit(owner, input, new AbortController().signal, options)
    await Promise.resolve(); finish(answer); await vi.advanceTimersByTimeAsync(0)
    expect(advisor.take(owner, options.maxAgeMs)?.result).toEqual(answer)
    expect(advisor.take(owner, options.maxAgeMs)).toBeUndefined()
    advisor.reset(owner)
    advisor.submit(owner, input, new AbortController().signal, options)
    await Promise.resolve(); finish(answer); await vi.advanceTimersByTimeAsync(6000)
    expect(advisor.take(owner, options.maxAgeMs)).toBeUndefined()
  } finally { finish(answer); await advisor.dispose(); vi.useRealTimers() }
})

it('cancels timed-out auxiliary calls without requiring a primary-agent await or another model turn', async () => {
  vi.useFakeTimers()
  let stopped = false
  const advisor = new BackgroundAdvisor(async (_input, _owner, signal) => {
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { stopped = true; reject(new Error('cancelled')) }, { once: true })
    })
    return answer
  })
  const owner = {}
  try {
    advisor.submit(owner, input, new AbortController().signal, options)
    await vi.advanceTimersByTimeAsync(options.deadlineMs)
    expect(stopped).toBe(true)
    expect(advisor.take(owner, options.maxAgeMs)).toBeUndefined()
  } finally { await advisor.dispose(); vi.useRealTimers() }
})

it('does not inject uncertain, unavailable, empty or malformed judgments', () => {
  expect(confidentAdvice(answer, 0.85)).toBe(true)
  expect(confidentAdvice({ available: false, answers: answer.answers }, 0.85)).toBe(false)
  expect(confidentAdvice({ available: true, answers: {} }, 0.85)).toBe(false)
  expect(confidentAdvice({ available: true, answers: { choice: { type: 'choice', confidence: 0.2 } } }, 0.85)).toBe(false)
  expect(confidentAdvice({ available: true, answers: { passed: { type: 'noul', noul: 0.52 } } }, 0.85)).toBe(false)
})

it('keeps 4 GB Windows and other low-memory devices from loading local weights, including forced Local mode', () => {
  const limits = { minTotalMemoryMiB: 8192, minFreeMemoryMiB: 2048, criticalFreeMemoryMiB: 768 }
  for (const warm of [false, true]) {
    expect(localDecisionAdmission({ totalMiB: 4096, freeMiB: 3500 }, limits, warm).allowed).toBe(false)
  }
  expect(localDecisionAdmission({ totalMiB: 16384, freeMiB: 1000 }, limits, false).allowed).toBe(false)
  expect(localDecisionAdmission({ totalMiB: 16384, freeMiB: 1000 }, limits, true).allowed).toBe(true)
  expect(localDecisionAdmission({ totalMiB: 16384, freeMiB: 500 }, limits, true).allowed).toBe(false)
  expect(localDecisionAdmission({ totalMiB: 16384, freeMiB: 5000 }, limits, false).allowed).toBe(true)
})
