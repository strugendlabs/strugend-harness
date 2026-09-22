/** Automatic review activation requires reviewed native-payload and paired-task evidence for the served model. */
import manifest from './strugend-review-qualification.json' with { type: 'json' }
import type { ReviewRequest } from './strugend-review.ts'

interface QualifiedReviewRecord {
  model: string
  revision: string
  intents: ReviewRequest['intent'][]
  nativePayloadReport: string
  pairedTaskReport: string
}

const qualification: { version: number; records: QualifiedReviewRecord[] } = manifest

/**
 * Read release-reviewed use cases; configuration and component installation cannot fabricate qualification.
 * @param model - Actual served model identifier.
 * @param revision - Immutable local revision, or the verified remote model revision.
 * @returns Qualified automatic review intents; unknown models and revisions have none.
 */
export function qualifiedReviewIntents(model: string, revision: string): readonly ReviewRequest['intent'][] {
  return qualification.records.filter(record => record.model === model && record.revision === revision
    && record.nativePayloadReport.length > 0 && record.pairedTaskReport.length > 0).flatMap(record => record.intents)
}
