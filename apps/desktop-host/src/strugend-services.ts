/** Bounded HTTP clients for structured decisions and temporal memory reads. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Deployment limits shared by one service request. */
export interface RequestLimits {
  /** Total request and response deadline in milliseconds. */
  timeoutMs: number
  /** Maximum encoded request or response bytes. */
  maxBytes: number
}

/**
 * Validate a service origin before attaching its credential. Redirects are never followed.
 * @param value - Configured endpoint, without credentials, query, or fragment.
 * @returns The normalized URL.
 */
export function serviceUrl(value: string): URL {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash)
    throw new Error('Service endpoints require HTTPS, or HTTP on loopback, without URL credentials, query, or fragment.')
  return url
}

/**
 * Send one authenticated request without retries or unbounded response buffering.
 * @param url - Validated service URL.
 * @param key - Credential resolved for this request only.
 * @param body - Logged model/tool input, or a bounded graph read.
 * @param limits - Deployment byte and deadline limits.
 * @param signal - Operation and plugin-disposal cancellation.
 * @returns The parsed JSON value. HTTP failures never include server bodies or credentials.
 */
export async function requestJson(url: URL, key: string, body: JsonValue, limits: RequestLimits, signal: AbortSignal): Promise<JsonValue> {
  const serialized = JSON.stringify(body)
  if (Buffer.byteLength(serialized) > limits.maxBytes) throw new Error('Service request exceeds the configured byte limit.')
  signal.throwIfAborted()
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort(new Error('Service deadline exceeded.')) }, limits.timeoutMs)
  const combined = AbortSignal.any([signal, timeout.signal])
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: combined,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: serialized })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Service request failed (HTTP ${response.status}).${response.status === 401 ? ' Check the saved API key.' : ''}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Service returned an empty response.')
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > limits.maxBytes) {
          await reader.cancel()
          throw new Error('Service response exceeds the configured byte limit.')
        }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    combined.throwIfAborted()
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonValue }
    catch { throw new Error('Service returned invalid JSON.') }
  } catch (error) {
    if (combined.aborted) throw combined.reason
    if (error instanceof TypeError) throw new Error('Service connection failed. Check its endpoint and connection.')
    throw error
  } finally { clearTimeout(timer) }
}

/** One independently evaluated question. */
export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

function object(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate all questions at the tool JSON entry before any network request.
 * @param value - Model-supplied named questions.
 * @param maxQuestions - Deployment batch cap.
 * @returns A detached map accepted by the decision provider.
 */
export function decisionQuestions(value: Record<string, JsonValue>, maxQuestions: number): Record<string, DecisionQuestion> {
  const entries = Object.entries(value)
  if (!entries.length || entries.length > maxQuestions) throw new Error(`Supply 1–${maxQuestions} independent decision questions.`)
  return Object.fromEntries(entries.map(([id, question]) => {
    if (!id.trim() || !object(question) || typeof question.instructions !== 'string' || !question.instructions.trim())
      throw new Error('Each question needs a name and nonempty instructions.')
    const { type, instructions, criteria } = question
    if (Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key)))
      throw new Error('Unknown decision question field.')
    if (type === 'noul' && criteria === undefined) return [id, { type, instructions }]
    if (type === 'choice' && object(criteria) && Object.keys(criteria).length >= 2
      && Object.entries(criteria).every(([key, text]) => key.trim() && typeof text === 'string' && text.trim()))
      return [id, { type, instructions, criteria: { ...criteria } }]
    if (type === 'score' && Array.isArray(criteria) && criteria.length >= 2 && criteria.every(text => typeof text === 'string' && text.trim()))
      return [id, { type, instructions, criteria: [...criteria] }]
    throw new Error('Use noul, choice with at least two named criteria, or score with at least two ordered descriptions.')
  })) as Record<string, DecisionQuestion>
}

const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

/**
 * Reject missing, mismatched, or malformed decision answers before they can guide work.
 * @param value - Parsed external response.
 * @param questions - Exact question batch sent to the provider.
 * @returns Validated response with model, answers, and usage only.
 */
export function decisionResponse(value: JsonValue, questions: Record<string, DecisionQuestion>): Record<string, JsonValue> {
  const invalid = (): never => { throw new Error('Decision service returned an invalid answer. Continue with Core and verify the result directly.') }
  if (!object(value) || typeof value.model !== 'string' || !value.model || !object(value.answers) || !object(value.usage)) return invalid()
  if (!Number.isSafeInteger(value.usage.input_tokens) || Number(value.usage.input_tokens) < 0
    || !Number.isSafeInteger(value.usage.output_tokens) || Number(value.usage.output_tokens) < 0) return invalid()
  if (Object.keys(value.answers).length !== Object.keys(questions).length) return invalid()
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id]
    if (!object(answer) || answer.type !== question.type) return invalid()
    if (question.type === 'noul') { if (!probability(answer.noul)) return invalid(); continue }
    if (!probability(answer.confidence) || !object(answer.probabilities)) return invalid()
    const probabilities = answer.probabilities
    const legend = answer.legend
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_text, index) => String(index))
    if (Object.keys(answer.probabilities).length !== keys.length || keys.some(key => !probability(probabilities[key]))) return invalid()
    const total = Object.values(probabilities).reduce<number>((sum, item) => sum + Number(item), 0)
    if (Math.abs(total - 1) > 0.02) return invalid()
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !keys.includes(answer.choice)) return invalid()
    } else if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1
      || !object(legend) || keys.some(key => legend[key] !== question.criteria[Number(key)])) return invalid()
  }
  return { model: value.model, answers: value.answers, usage: value.usage }
}
