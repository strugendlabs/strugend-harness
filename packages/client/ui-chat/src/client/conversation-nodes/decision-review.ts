/** Correlated auxiliary reviews, reconstructed from their durable request and result. */
import type { Context } from '@deepseek-ai/cordis'
import type { DecisionPayload } from '@deepseek-ai/dsh-agentos-protocol'
import type {} from '@deepseek-ai/dsh-agentos-protocol/decision-events'
import type { ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chatNode } from './common.ts'

/** User-visible advice; a completed review does not establish that the agent used it. */
export interface DecisionReviewData {
  readonly seq: number
  readonly observedOnly: boolean
  readonly checkpoint: string
  readonly status: 'pending' | 'suggestion' | 'inconclusive' | 'unavailable'
  readonly suggestion?: string
  readonly elapsedMs?: number
  readonly details?: unknown
}

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Optional decision advice with no claimed verification or adoption. */
    'decision-review': DecisionReviewData
  }
}

interface ReviewState {
  readonly request: Extract<ConversationMatch['event'], { type: 'strugend/decision-request' }>
  readonly result?: Extract<ConversationMatch['event'], { type: 'strugend/decision-result' }>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function suggestion(payload: DecisionPayload, result: unknown): string | undefined {
  const review = record(record(record(result)?.answers)?.review)
  const question = payload.questions.review
  if (review?.type !== 'choice' || typeof review.choice !== 'string' || question?.type !== 'choice') return undefined
  return question.criteria[review.choice]
}

/** Durable Decision lifecycle; in-flight work remains a single row after completion. */
export const decisionReviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'decision-review',
  target: 'chat',
  match: (event) => {
    if (event.type === 'strugend/decision-request') return { id: String(event.seq), role: 'start' }
    if (event.type === 'strugend/decision-result') return { id: String(event.data.requestSeq), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'strugend/decision-request') throw new Error('Decision review requires its request')
    return { request: match.event }
  },
  update: (context, match) => match.event.type === 'strugend/decision-result'
    ? { ...context.state, result: match.event }
    : context.state,
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const result = state.result?.data.result
    const selected = suggestion(state.request.data.payload, result)
    const status = result === undefined ? 'pending'
      : result.available !== true ? 'unavailable'
        : result.status === 'inconclusive' || selected === undefined ? 'inconclusive' : 'suggestion'
    const elapsed = result?.latencyMs
    const elapsedMs = typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0
      ? elapsed : state.result === undefined ? undefined : Math.max(0, state.result.time - state.request.time)
    return chatNode(context, 'decision-review', state.request.seq, {
      seq: state.request.seq,
      checkpoint: state.request.data.checkpoint,
      observedOnly: result?.observedOnly === true,
      status,
      ...selected === undefined ? {} : { suggestion: selected },
      ...elapsedMs === undefined ? {} : { elapsedMs },
      ...result === undefined ? {} : { details: result },
    })
  },
}

/**
 * Register the optional Decision review projection.
 * @param ctx - Owning Conversation context.
 */
export function registerDecisionReviewNode(ctx: Context): void {
  ctx.uiConversation.events.register(decisionReviewDefinition)
}
