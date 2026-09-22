/** Shared warm inference worker with bounded queues, cancellation and crash recovery. */
import { Worker } from 'node:worker_threads'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { decisionEvidence, type DecisionPayload } from './strugend-decision.ts'
import { decisionResponse } from './strugend-services.ts'
import manifest from './laya-manifest.json' with { type: 'json' }
import { decisionResources, localDecisionAdmission, type DecisionResourceLimits } from './strugend-resources.ts'

/** Resource limits for one installed CPU inference runtime. */
export interface LocalDecisionOptions {
  directory: string
  threads: number
  timeoutMs: number
  maxQueued: number
  idleMs: number
  memory: DecisionResourceLimits
}

/** One warm model shared across tasks; requests execute serially to cap peak model memory. */
export class LocalDecisionRuntime {
  private worker: Worker | undefined
  private identity = ''
  private tail: Promise<unknown> = Promise.resolve()
  private queued = 0
  private sequence = 0
  private closed = false
  private idle: ReturnType<typeof setTimeout> | undefined
  private retiring: Promise<unknown> = Promise.resolve()

  constructor(private readonly workerUrl = new URL('./strugend-laya-worker.js', import.meta.url)) {}

  /** Whether a model worker currently owns resident memory. */
  get isResident(): boolean { return this.worker !== undefined }

  /** Release model memory while keeping later requests usable. */
  async unload(): Promise<void> {
    clearTimeout(this.idle)
    const worker = this.worker
    this.worker = undefined
    if (worker) this.retiring = worker.terminate()
    await this.retiring
  }

  /**
   * Evaluate one bounded request using the installed model without network access.
   * @param payload - Validated, logged decision input.
   * @param options - Model directory and configured resource limits.
   * @param signal - Task and plugin lifetime.
   * @returns Typed answers; failure never substitutes a heuristic answer.
   */
  evaluate(payload: DecisionPayload, options: LocalDecisionOptions, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    if (this.closed) return Promise.reject(new Error('Local Decision is closed.'))
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Local Decision cancelled.'))
    if (!options.directory) return Promise.reject(new Error('Local Laya model is not installed. Reinstall the full Strugend build or select the remote runtime.'))
    if (this.queued >= options.maxQueued) return Promise.reject(new Error('Local Decision queue is full. Continue with Core and direct verification.'))
    clearTimeout(this.idle)
    this.queued++
    const deadline = new AbortController()
    const timer = setTimeout(() =>{  deadline.abort(new Error('Local Decision timed out; its worker was stopped.')) }, options.timeoutMs)
    const lifetime = AbortSignal.any([signal, deadline.signal])
    let started = false, released = false
    const release = (): void => {
      if (released) return
      released = true; this.queued--
      if (!this.closed && this.queued === 0) {
        this.idle = setTimeout(() => { void this.unload() }, options.idleMs)
        this.idle.unref()
      }
    }
    const task = this.tail.then(async () => {
      await this.retiring
      lifetime.throwIfAborted()
      started = true
      if (this.closed) throw new Error('Local Decision is closed.')
      const admission = localDecisionAdmission(decisionResources(), options.memory, this.isResident)
      if (!admission.allowed) { await this.unload(); throw new Error(admission.reason) }
      const identity = JSON.stringify([options.directory, options.threads])
      if (this.worker && identity !== this.identity) { await this.worker.terminate(); this.worker = undefined }
      if (!this.worker) {
        this.worker = new Worker(this.workerUrl, { env: {}, workerData: { directory: options.directory, threads: options.threads } })
        const owned = this.worker
        owned.on('error', () => { if (this.worker === owned) this.worker = undefined })
        owned.on('exit', () => { if (this.worker === owned) this.worker = undefined })
        this.identity = identity
        this.worker.unref()
      }
      return this.request(this.worker, payload, lifetime)
    })
    this.tail = task.catch(() => undefined).finally(release)
    return new Promise((resolve, reject) => {
      const aborted = (): void => { if (!started) { release(); reject(lifetime.reason instanceof Error ? lifetime.reason : new Error('Local Decision cancelled.')) } }
      lifetime.addEventListener('abort', aborted, { once: true })
      if (lifetime.aborted) aborted()
      void task.then(resolve, reject).finally(() => { clearTimeout(timer); lifetime.removeEventListener('abort', aborted) })
    })
  }

  private request(worker: Worker, payload: DecisionPayload, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      let settled = false
      const clean = (): void => { signal.removeEventListener('abort', aborted); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited) }
      const stop = (error: Error): void => {
        if (settled) return
        settled = true; clean(); if (this.worker === worker) this.worker = undefined
        void worker.terminate().then(() =>{  reject(error) }, () =>{  reject(error) })
      }
      const aborted = (): void =>{  stop(signal.reason instanceof Error ? signal.reason : new Error('Local Decision cancelled.')) }
      const failed = (error: Error): void => { stop(new Error('Local Decision worker failed: ' + decisionEvidence(error.message, 600))) }
      const exited = (): void =>{  stop(new Error('Local Decision worker exited; a later request can restart it.')) }
      const message = (value: unknown): void => {
        if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) { stop(new Error('Invalid local Decision reply.')); return }
        if ('error' in value) { stop(new Error(typeof value.error === 'string' ? value.error : 'Local Decision failed.')); return }
        try {
          if (!('result' in value)) throw new Error('Local Decision omitted its result.')
          if (!value.result || typeof value.result !== 'object' || !('revision' in value.result) || value.result.revision !== manifest.revision
            || !('model' in value.result) || value.result.model !== manifest.model) throw new Error('Local Decision model identity does not match the installed build.')
          const result = decisionResponse(value.result as JsonValue, payload.questions)
          settled = true; clean(); resolve({ ...result, runtime: 'local', revision: manifest.revision })
        } catch { stop(new Error('Local Decision returned an invalid answer.')) }
      }
      signal.addEventListener('abort', aborted, { once: true })
      worker.on('message', message); worker.once('error', failed); worker.once('exit', exited)
      if (signal.aborted) { aborted(); return }
      worker.postMessage({ id, state: payload.state, questions: payload.questions })
    })
  }

  /** Stop active inference, reject pending requests and await worker termination. */
  async dispose(): Promise<void> {
    this.closed = true
    await this.unload()
    await this.tail
  }
}
