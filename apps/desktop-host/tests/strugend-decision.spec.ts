/** Pinned Laya requests and unavailable-provider behavior. */
import { expect, it, vi, afterEach } from 'vitest'
import { prepareDecision, evaluateDecision, decisionEvidence } from '../src/strugend-decision.ts'
import { Config } from '../src/strugend-intelligence.ts'
afterEach(() => vi.unstubAllGlobals())
const settings = Config({} as Config)
const input = { checkpoint: 'verification', state: 'Build exited 0.', questions: { done: { type: 'noul', instructions: 'Did the build exit zero?' } } }
it('pins English and multilingual models and removes credential material from state', () => {
  expect(prepareDecision({ ...input, language: 'en-GB' }, settings).model).toBe('convaiinnovations/laya')
  expect(prepareDecision(input, settings).model).toBe('convaiinnovations/laya-multilingual')
  expect(decisionEvidence('Bearer confidential-value\nimp-rt-' + 'a'.repeat(30))).not.toMatch(/confidential|imp-rt-/u)
  expect(decisionEvidence('a'.repeat(2000))).toContain('omitted')
  expect(() => prepareDecision({ ...input, state: 'a'.repeat(20_000) }, settings)).toThrow('Summarize')
})
it('migrates the former default URL without sending the new key to the former provider', async () => {
  const fetcher = vi.fn(async (_url: URL, _options?: RequestInit) => Response.json({ model: 'convaiinnovations/laya', answers: { done: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 8, output_tokens: 0 } }))
  vi.stubGlobal('fetch', fetcher)
  const payload = prepareDecision({ ...input, language: 'en' }, settings)
  expect((await evaluateDecision(payload, 'synthetic-key', { decisionUrl: 'https://api.typesafe.ai/v1/systemone', decisionModels: settings.decisionModels, timeoutMs: settings.timeoutMs, maxBytes: settings.maxBytes, maxQuestions: settings.maxQuestions }, new AbortController().signal)).model).toBe(payload.model)
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://api.impossibl.com/v1/systemone')
})
