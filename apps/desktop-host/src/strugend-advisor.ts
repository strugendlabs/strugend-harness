/** Best-effort auxiliary work never waits on, steers, or chooses the primary model. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DecisionCheckRequest } from './strugend-decision.ts'

/** Bounds for background checks and optional context injection. */
export interface AdvisorOptions {
  intervalMs: number
  deadlineMs: number
  maxConcurrent: number
  maxAgeMs: number
  minConfidence: number
}

interface Slot {
  epoch: number
  lastStarted: number
  identity?: string
  active?: AbortController
  pending?: () => void
  timer?: ReturnType<typeof setTimeout>
  ready?: { at: number; checkpoint: string; input: DecisionCheckRequest; result: Record<string, JsonValue> }
}

/**
 * Admit optional advice only when all supplied judgments are decisive.
 * @param result - Validated model response.
 * @param threshold - Minimum probability/confidence for every answer.
 * @returns Whether the result can be offered as advisory context.
 */
export function confidentAdvice(result: Record<string, JsonValue>, threshold: number): boolean {
  const answers = result.answers
  if (result.available !== true || !answers || typeof answers !== 'object' || Array.isArray(answers)) return false
  const values = Object.values(answers)
  return values.length > 0 && values.every((answer) => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false
    if (answer.type === 'choice' && answer.choice === 'insufficient_evidence') return false
    return answer.type === 'noul' && typeof answer.noul === 'number'
      ? Math.max(answer.noul, 1 - answer.noul) >= threshold
      : typeof answer.confidence === 'number' && answer.confidence >= threshold
  })
}

/** One bounded, nonblocking scheduler shared by all desktop tasks. */
export class BackgroundAdvisor<Owner extends object> {
  private readonly slots = new WeakMap<Owner, Slot>()
  private active = 0
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly stopping = new AbortController()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  constructor(
    private readonly evaluate: (input: DecisionCheckRequest, owner: Owner, signal: AbortSignal) => Promise<Record<string, JsonValue>>,
  ) {}

  /** Begin a new user request without retaining advice from an earlier request. */
  reset(owner: Owner): void {
    this.cancel(owner)
    this.slots.set(owner, { epoch: 0, lastStarted: -Infinity })
  }

  /** Discard advice derived from evidence that a later tool has superseded. */
  invalidate(owner: Owner): void {
    const slot = this.slots.get(owner)
    if (slot) { slot.epoch++; delete slot.ready; delete slot.identity; delete slot.pending
      if (slot.timer) { clearTimeout(slot.timer); this.timers.delete(slot.timer); delete slot.timer }
    }
  }

  /**
   * Try one check without returning a promise to the primary agent.
   * @param owner - Task whose evidence is being checked.
   * @param input - Small redacted evidence snapshot.
   * @param signal - Owning task lifetime.
   * @param options - Live scheduling and admission limits.
   */
  submit(owner: Owner, input: DecisionCheckRequest, signal: AbortSignal, options: AdvisorOptions): void {
    let slot = this.slots.get(owner)
    if (!slot) { slot = { epoch: 0, lastStarted: -Infinity }; this.slots.set(owner, slot) }
    const current = slot
    if (signal.aborted || this.stopping.signal.aborted) return
    const identity = JSON.stringify(input)
    if (current.identity === identity) return
    if (current.active || current.timer) {
      // Only a new evidence snapshot supersedes in-flight advice; repeated admission attempts do not.
      current.epoch++; delete current.ready
      current.pending = () => { this.submit(owner, input, signal, options) }
      return
    }
    if (this.active >= options.maxConcurrent) return
    const remaining = options.intervalMs - (Date.now() - current.lastStarted)
    if (remaining > 0) {
      current.pending = () => { this.submit(owner, input, signal, options) }
      const timer = setTimeout(() => {
        this.timers.delete(timer); delete current.timer
        const pending = current.pending; delete current.pending
        if (this.slots.get(owner) === current) pending?.()
      }, remaining)
      current.timer = timer
      this.timers.add(timer)
      return
    }
    const epoch = ++current.epoch
    current.identity = identity
    delete current.ready
    const abort = new AbortController()
    current.active = abort
    current.lastStarted = Date.now()
    this.active++
    const timer = setTimeout(() => { abort.abort(new Error('Background Decision deadline exceeded.')) }, options.deadlineMs)
    const combined = AbortSignal.any([signal, abort.signal, this.stopping.signal])
    const task = Promise.resolve().then(() => this.evaluate(input, owner, combined)).then((result) => {
      if (!combined.aborted && current.epoch === epoch && this.slots.get(owner) === current
        && confidentAdvice(result, options.minConfidence)) current.ready = { at: Date.now(), checkpoint: input.checkpoint, input, result }
    }, () => { /* The Decision service logs failures; auxiliary failure cannot fail the primary turn. */ }).finally(() => {
      clearTimeout(timer); this.active--; delete current.active; this.tasks.delete(task)
      const pending = current.pending; delete current.pending
      if (this.slots.get(owner) === current && !this.stopping.signal.aborted) pending?.()
    })
    this.tasks.add(task)
  }

  /** Consume fresh completed advice once; this method never waits for inference. */
  take(owner: Owner, maxAgeMs: number): Slot['ready'] {
    const slot = this.slots.get(owner), ready = slot?.ready
    if (slot) delete slot.ready
    return ready && Date.now() - ready.at <= maxAgeMs ? ready : undefined
  }

  /** Cancel obsolete task work without interrupting the primary agent. */
  cancel(owner: Owner): void {
    const slot = this.slots.get(owner)
    slot?.active?.abort(new Error('Decision task ended.'))
    if (slot?.timer) { clearTimeout(slot.timer); this.timers.delete(slot.timer) }
    this.slots.delete(owner)
  }

  /** Cancel and await all auxiliary work during Host shutdown. */
  async dispose(): Promise<void> {
    this.stopping.abort(new Error('Decision scheduler closed.'))
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled(this.tasks)
  }
}
