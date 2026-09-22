/** Narrow review requests compiled by the harness into the Decision provider's question format. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { InferArgs } from '@deepseek-ai/dsh-tools'
import type { DecisionCheckRequest } from './strugend-decision.ts'

/** Model-visible fields shared by the registered tool and request compiler. */
export const reviewParameters = {
  intent: { type: 'string', required: true, enum: ['rank_candidates', 'review_evidence', 'suggest_recovery'], description: 'Rank supplied alternatives, suggest a missing verification, or investigate a failed action.' },
  goal: { type: 'string', required: true, description: 'The user requirement this review should help satisfy.' },
  evidence: { type: 'string', required: true, description: 'Short observed results and relevant constraints. Never include credentials.' },
  candidates: { type: 'array', description: 'Required only for rank_candidates: two to four alternatives.', items: {
    type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true, description: 'A unique short identifier for this alternative.' },
      description: { type: 'string', required: true, description: 'What this alternative does and when it is appropriate.' },
    },
  } },
} as const

/** A validated model request; provider question syntax stays private to the harness. */
export type ReviewRequest = InferArgs<typeof reviewParameters>

/**
 * Compile a task-specific review without asking the coding model to construct provider questions.
 * @param input - Schema-validated tool arguments or a harness-authored checkpoint.
 * @returns The exact request that will be bounded, logged and evaluated.
 */
export function compileReview(input: ReviewRequest): DecisionCheckRequest {
  if (!input.goal.trim()) throw new Error('goal must describe the requirement being reviewed.')
  if (!input.evidence.trim()) throw new Error('evidence must contain an observed result. Continue gathering evidence without Decision.')
  let criteria: Record<string, string>
  switch (input.intent) {
    case 'rank_candidates': {
      if (!input.candidates || input.candidates.length < 2 || input.candidates.length > 4)
        throw new Error('candidates must contain two to four {id, description} objects for rank_candidates.')
      criteria = {}
      for (const [index, candidate] of input.candidates.entries()) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u.test(candidate.id) || candidate.id === 'insufficient_evidence' || Object.hasOwn(criteria, candidate.id))
          throw new Error(`candidates[${index}].id must be a unique identifier, excluding insufficient_evidence.`)
        if (!candidate.description.trim()) throw new Error(`candidates[${index}].description must describe the alternative.`)
        criteria[candidate.id] = candidate.description
      }
      break
    }
    case 'review_evidence':
      criteria = {
        check_behavior: 'The goal requires changed software behavior, but observed verification only establishes compilation or file creation. Run a focused behavior check.',
        inspect_visual_result: 'The goal explicitly requires a visual interface or document layout, but the evidence has no rendered inspection. Inspect the actual rendered output.',
        inspect_deliverable: 'The goal requires a saved or published result, but the evidence does not show opening or reading that result. Inspect the deliverable.',
      }
      break
    case 'suggest_recovery':
      criteria = {
        inspect_error: 'The failure is unexplained or ambiguous. Inspect the concrete error and current state before changing the implementation.',
        repair_input: 'The evidence explicitly identifies an invalid argument, path or configuration. Correct that input before retrying.',
        reconnect: 'The evidence explicitly identifies missing or rejected credentials. Ask the user to reconnect through Settings without requesting secrets in chat.',
        change_approach: 'The same attempted operation has repeatedly failed despite unchanged inputs. Gather different evidence or use another available approach.',
      }
      break
    default: return assertNever(input.intent)
  }
  if (input.intent !== 'rank_candidates' && input.candidates !== undefined)
    throw new Error('candidates is only used with rank_candidates; omit it for evidence and recovery reviews.')
  criteria.insufficient_evidence = 'None of these suggestions is supported, evidence is insufficient, or the necessary check has already been performed. Abstain.'
  return {
    checkpoint: input.intent,
    state: JSON.stringify({ goal: input.goal, evidence: input.evidence }),
    questions: { review: { type: 'choice', instructions: 'Select the one suggestion supported by the supplied goal and observed evidence. Omitted evidence is unknown. Do not infer success or missing work from omission alone; abstain when uncertain. A suggestion never authorizes an action or establishes completion.', criteria } },
  }
}
