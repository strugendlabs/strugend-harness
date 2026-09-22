/** Qualification requires supported suggestions; always abstaining and leaked calibration results fail. */
import { expect, it } from 'vitest'
import { qualifiedReviewIntents } from '../src/strugend-review-qualification.ts'
import { layaManifest } from '../src/strugend-laya-assets.ts'
import { compileReview } from '../src/strugend-review.ts'
import { prepareDecision } from '../src/strugend-decision.ts'
import { decisionQualityCases } from './fixtures/decision-quality.ts'
import { decisionQualityReport } from './fixtures/decision-quality-report.ts'

it('compiles every calibration and held-out task through the production request validator', () => {
  for (const fixture of decisionQualityCases) {
    const payload = prepareDecision(compileReview(fixture.input), { decisionUrl: 'https://api.impossibl.com/v1/systemone', decisionModels: ['convaiinnovations/laya-multilingual'], timeoutMs: 2000, maxBytes: 1_048_576, maxQuestions: 5 })
    expect(payload.questions.review?.type).toBe('choice')
    expect(payload.state).toContain(fixture.input.goal)
  }
})

it('requires accepted precision and sufficient held-out support, and rejects false suggestions when evidence is insufficient', () => {
  const observations = decisionQualityCases.map(item => ({ id: item.id, choice: item.expected, confidence: .99, durationMs: 1 }))
  const qualified = decisionQualityReport(decisionQualityCases, observations, .9)
  expect(Object.values(qualified.intents).every(result => result.qualified)).toBe(true)
  const abstained = decisionQualityReport(decisionQualityCases, observations.map(item => ({ ...item, confidence: .1 })), .9)
  expect(Object.values(abstained.intents).every(result => !result.qualified && result.accepted === 0)).toBe(true)
  const calibration = decisionQualityReport(decisionQualityCases.filter(item => item.split === 'calibration'), observations, .9)
  expect(Object.values(calibration.intents).every(result => !result.qualified)).toBe(true)
  const missing = decisionQualityReport(decisionQualityCases, [], .9)
  expect(Object.values(missing.intents).every(result => !result.qualified && result.errors === 20)).toBe(true)
  const invalid = decisionQualityCases.filter(item => item.split === 'held-out' && item.expected === 'insufficient_evidence').map(item => item.id)
  const unsupported = decisionQualityReport(decisionQualityCases, observations.map(item => invalid.includes(item.id) ? { ...item, choice: 'unsupported' } : item), .9)
  expect(Object.values(unsupported.intents).every(result => !result.qualified && result.falseSuggestionsOnAbstention > 0)).toBe(true)
})

it('does not enable automatic advice without release-reviewed native and paired-task evidence', () => {
  expect(qualifiedReviewIntents(layaManifest.model, layaManifest.revision)).toEqual([])
  expect(qualifiedReviewIntents('unverified-remote-model', 'unknown')).toEqual([])
})

it('rejects ambiguous alternatives and empty evidence before contacting Decision', () => {
  const input = { intent: 'rank_candidates' as const, goal: 'Choose an implementation', evidence: 'Two supported options', candidates: [{ id: 'first', description: 'First option' }, { id: 'second', description: 'Second option' }] }
  expect(() => compileReview({ ...input, candidates: [input.candidates[0]!, input.candidates[0]!] })).toThrow('unique identifier')
  expect(() => compileReview({ ...input, candidates: [{ id: 'insufficient_evidence', description: 'Reserved' }, input.candidates[1]!] })).toThrow('unique identifier')
  expect(() => compileReview({ ...input, evidence: ' ' })).toThrow('evidence must contain')
  expect(() => compileReview({ ...input, intent: 'review_evidence' })).toThrow('candidates is only used')
})
