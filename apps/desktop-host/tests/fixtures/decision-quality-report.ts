/** Computes held-out precision and abstention behavior from observed model predictions. */
import type { ReviewRequest } from '../../src/strugend-review.ts'
import type { QualityCase } from './decision-quality.ts'

/** One real inference observation; absence of a choice or failure counts as abstention. */
export interface QualityObservation {
  id: string
  choice?: string
  confidence?: number
  durationMs: number
  error?: string
}

/**
 * Qualify each use case independently; calibration observations never count toward acceptance.
 * @param cases - Reviewed tasks and their split/expected labels.
 * @param observations - Actual model choices, confidence, latency, and failures.
 * @param threshold - Deployment acceptance threshold, selected before held-out execution.
 * @returns Per-intent metrics and qualification; this cannot establish general coding superiority.
 */
export function decisionQualityReport(cases: readonly QualityCase[], observations: readonly QualityObservation[], threshold: number): {
  threshold: number
  intents: Record<ReviewRequest['intent'], { cases: number; accepted: number; correct: number; precision: number | null; falseSuggestionsOnAbstention: number; abstentionCases: number; errors: number; qualified: boolean }>
} {
  const result = { threshold, intents: {} as ReturnType<typeof decisionQualityReport>['intents'] }
  for (const intent of ['rank_candidates', 'review_evidence', 'suggest_recovery'] as const) {
    const heldout = cases.filter(item => item.input.intent === intent && item.split === 'held-out')
    let accepted = 0, correct = 0, falseSuggestionsOnAbstention = 0, abstentionCases = 0, errors = 0
    for (const item of heldout) {
      const observation = observations.find(value => value.id === item.id)
      if (!observation || observation.error) errors++
      const suggest = observation?.choice && observation.choice !== 'insufficient_evidence' && (observation.confidence ?? 0) >= threshold && !observation.error
      if (item.expected === 'insufficient_evidence') { abstentionCases++; if (suggest) falseSuggestionsOnAbstention++ }
      if (suggest) { accepted++; if (observation.choice === item.expected) correct++ }
    }
    const precision = accepted ? correct / accepted : null
    result.intents[intent] = { cases: heldout.length, accepted, correct, precision, falseSuggestionsOnAbstention, abstentionCases, errors,
      qualified: heldout.length >= 20 && accepted >= 12 && (precision ?? 0) >= .9
        && abstentionCases >= 3 && falseSuggestionsOnAbstention === 0 && errors === 0 }
  }
  return result
}
