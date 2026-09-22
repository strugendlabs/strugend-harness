/** Laya evaluation with bounded input, cancellation, and validated typed answers. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DecisionPayload } from '@deepseek-ai/dsh-agentos-protocol'
export type { DecisionPayload } from '@deepseek-ai/dsh-agentos-protocol'
import { decisionQuestions, decisionResponse, requestJson, serviceUrl } from './strugend-services.ts'

/** One independent judgment batch; language uses BCP-47, or auto for mixed/unknown text. */
export interface DecisionCheckRequest {
  checkpoint: string
  state: string
  questions: Record<string, JsonValue>
  language?: string
}

/** Provider settings shared by tools, automatic checks, and connection testing. */
export interface DecisionSettings {
  decisionUrl: string
  decisionModels: string[]
  timeoutMs: number
  maxBytes: number
  maxQuestions: number
}

/** Scrub common credential assignments and bearer tokens before auxiliary context is logged. */
export function decisionEvidence(text: string, maxChars = 1200): string {
  const redacted = text
    .replace(/\b(?:imp-rt-|sk-|ghp_|github_pat_)[\w-]+/gu, '[credential removed]')
    .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [removed]')
    .replace(/((?:api[_ -]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/giu, '$1[removed]')
  return redacted.length <= maxChars ? redacted : redacted.slice(0, maxChars) + '\n[Excerpt; remaining evidence omitted. Do not infer omitted facts.]'
}

/**
 * Resolve the pinned model and validate questions before any provider call.
 * @param input - Short task evidence and independent questions.
 * @param settings - Active provider limits.
 * @returns The exact JSON body to log and send.
 */
export function prepareDecision(input: DecisionCheckRequest, settings: DecisionSettings): DecisionPayload {
  const model = input.language?.toLowerCase().split('-')[0] === 'en'
    ? 'convaiinnovations/laya' : 'convaiinnovations/laya-multilingual'
  const allowed = settings.decisionModels.some(id => id.startsWith('convaiinnovations/'))
    ? settings.decisionModels : ['convaiinnovations/laya', 'convaiinnovations/laya-multilingual']
  if (!allowed.includes(model)) throw new Error('The selected Decision language model is not configured.')
  const questions = decisionQuestions(input.questions, settings.maxQuestions)
  for (const question of Object.values(questions)) {
    if (question.type === 'choice' && Object.keys(question.criteria).length > 5)
      throw new Error('Compare at most five options per Decision question.')
    question.instructions = decisionEvidence(question.instructions, 600)
    if (question.type === 'choice') question.criteria = Object.fromEntries(Object.entries(question.criteria).map(([key, value]) => [key, decisionEvidence(value, 300)]))
    if (question.type === 'score') question.criteria = question.criteria.map(value => decisionEvidence(value, 300))
    if (JSON.stringify(question).length > 1200) throw new Error('Shorten the Decision question and its rubric.')
  }
  if (Buffer.byteLength(JSON.stringify({ state: input.state, questions })) > 16_384)
    throw new Error('Summarize the evidence before checking this decision (maximum 16 KiB).')
  return { model, state: decisionEvidence(input.state, 1600), questions }
}

/**
 * Evaluate a logged payload. Legacy default URLs are migrated without sending the new key to the former provider.
 * @param payload - Exact request already recorded by its caller.
 * @param key - Impossibl credential, never included in diagnostics.
 * @param settings - Active request limits and endpoint.
 * @param signal - Owner cancellation.
 * @returns Validated typed answers plus the served model and token usage.
 */
export async function evaluateDecision(
  payload: DecisionPayload, key: string, settings: DecisionSettings, signal: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const endpoint = settings.decisionUrl === 'https://api.typesafe.ai/v1/systemone'
    ? 'https://api.impossibl.com/v1/systemone' : settings.decisionUrl
  const value = await requestJson(serviceUrl(endpoint), key, { ...payload }, settings, signal)
  return decisionResponse(value, payload.questions)
}
