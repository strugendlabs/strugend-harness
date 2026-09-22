/** Owns one offline inference process; native allocations never enter the Desktop Host. */
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { decisionEvidence, type DecisionPayload } from './strugend-decision.ts'
import { decisionResponse } from './strugend-services.ts'
import manifest from './laya-manifest.json' with { type: 'json' }
import { decisionResources, localDecisionAdmission, type DecisionResourceLimits } from './strugend-resources.ts'

/** Resource limits for one installed CPU inference process. */
export interface LocalDecisionOptions {
  directory: string
  runtimeDirectory?: string | undefined
  threads: number
  timeoutMs: number
  warmTimeoutMs: number
  maxQueued: number
  idleMs: number
  pressurePollMs: number
  restartCooldownMs: number
  memory: DecisionResourceLimits
}

interface Helper {
  process: ChildProcess
  exited: Promise<void>
  identity: string
  warm: boolean
  rss: number
  peakRss: number
  stop?: Promise<void>
}

interface Request {
  payload: DecisionPayload
  options: LocalDecisionOptions
  signal: AbortSignal
  resolve: (value: Record<string, JsonValue>) => void
  reject: (error: Error) => void
  clear: () => void
}

/** One isolated model shared across tasks, with bounded waiting and process-exit cleanup. */
export class LocalDecisionRuntime {
  private helper: Helper | undefined
  private active: Promise<void> | undefined
  private readonly pending: Request[] = []
  private sequence = 0
  private closed = false
  private retryAt = 0
  private idle: ReturnType<typeof setTimeout> | undefined
  private pressure: ReturnType<typeof setInterval> | undefined
  private retiring: Promise<void> = Promise.resolve()
  private unloading: Promise<void> | undefined

  constructor(private readonly helperUrl = new URL('./strugend-laya-worker.js', import.meta.url)) {}

  /** Whether an owned inference process currently holds or loads native model memory. */
  get isResident(): boolean { return this.helper !== undefined }

  /** Last helper memory observation, excluding Desktop Host memory; zero while unloaded. */
  get memoryUsage(): { rss: number; peakRss: number } {
    return { rss: this.helper?.rss ?? 0, peakRss: this.helper?.peakRss ?? 0 }
  }

  /** Reject outstanding work and new requests until all owned inference has stopped; later requests may restart it. */
  unload(): Promise<void> {
    if (this.unloading) return this.unloading
    clearTimeout(this.idle)
    clearInterval(this.pressure)
    for (const request of this.pending.splice(0)) {
      request.clear()
      request.reject(new Error(this.closed ? 'Local Decision is closed.' : 'Local Decision is unloading.'))
    }
    const helper = this.helper
    const active = this.active
    this.unloading = (async () => {
      if (helper) await this.stop(helper)
      await active
      await this.retiring
    })().finally(() => { this.unloading = undefined })
    return this.unloading
  }

  /**
   * Evaluate a bounded request using an installed component without provider credentials.
   * @param payload - Validated, logged decision input.
   * @param options - Component directories and resolved resource budgets.
   * @param signal - Task and plugin lifetime.
   * @returns Typed answers; failure never substitutes a heuristic judgment.
   */
  evaluate(payload: DecisionPayload, options: LocalDecisionOptions, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    if (this.closed) return Promise.reject(new Error('Local Decision is closed.'))
    if (this.unloading) return Promise.reject(new Error('Local Decision is unloading.'))
    if (signal.aborted) return Promise.reject(this.cancelReason(signal))
    if (Date.now() < this.retryAt) return Promise.reject(new Error('Local Decision is recovering from an inference failure. Core remains available.'))
    if (!options.directory) return Promise.reject(new Error('Decision support is not installed. Install it in Settings to enable local reviews.'))
    if (this.pending.length + Number(this.active !== undefined) >= options.maxQueued)
      return Promise.reject(new Error('Local Decision queue is full. Continue with Core and direct verification.'))
    clearTimeout(this.idle)
    return new Promise((resolve, reject) => {
      const deadline = new AbortController()
      // Admission waiting is bounded by the cold budget; execution applies a warm budget after dequeue.
      const timer = setTimeout(() => { deadline.abort(new Error('Local Decision timed out; its helper was stopped.')) }, options.timeoutMs)
      const lifetime = AbortSignal.any([signal, deadline.signal])
      const request: Request = { payload, options, signal: lifetime, resolve, reject,
        clear: () => { clearTimeout(timer); lifetime.removeEventListener('abort', aborted) } }
      const aborted = (): void => {
        const index = this.pending.indexOf(request)
        if (index < 0) return
        this.pending.splice(index, 1)
        request.clear()
        reject(this.cancelReason(lifetime))
      }
      lifetime.addEventListener('abort', aborted, { once: true })
      this.pending.push(request)
      this.pump()
    })
  }

  private pump(): void {
    if (this.active || this.closed || this.unloading) return
    const request = this.pending.shift()
    if (!request) return
    const running = this.run(request).then(request.resolve, request.reject).finally(() => {
      request.clear()
      this.active = undefined
      if (this.pending.length) this.pump()
      else if (!this.closed && !this.unloading && this.helper) {
        this.idle = setTimeout(() => { void this.unload() }, request.options.idleMs)
        this.idle.unref()
      }
    })
    this.active = running
  }

  private async run({ payload, options, signal }: Request): Promise<Record<string, JsonValue>> {
    await this.retiring
    signal.throwIfAborted()
    this.assertAccepting()
    if (Date.now() < this.retryAt) throw new Error('Local Decision is recovering from an inference failure. Core remains available.')
    const identity = JSON.stringify([options.directory, options.runtimeDirectory, options.threads])
    if (this.helper && identity !== this.helper.identity) {
      await this.stop(this.helper)
      signal.throwIfAborted()
      this.assertAccepting()
    }
    const admission = localDecisionAdmission(decisionResources(), options.memory, this.isResident)
    if (!admission.allowed) {
      if (this.helper) await this.stop(this.helper)
      throw new Error(admission.reason)
    }
    if (!this.helper) this.helper = this.start(identity)
    const helper = this.helper
    clearInterval(this.pressure)
    this.pressure = setInterval(() => {
      if (!localDecisionAdmission(decisionResources(), options.memory, true).allowed) void this.stop(helper)
    }, options.pressurePollMs)
    this.pressure.unref()
    return this.request(helper, payload, options, signal)
  }

  private start(identity: string): Helper {
    // Electron Node mode and Windows native-library lookup are the only inherited settings.
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP']) {
      const value = process.env[key]
      if (value !== undefined) env[key] = value
    }
    const child = spawn(process.execPath, [fileURLToPath(this.helperUrl)], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true })
    const helper: Helper = { process: child, identity, warm: false, rss: 0, peakRss: 0,
      exited: new Promise((resolve) => { child.once('close', () => {
        if (this.helper === helper) { this.helper = undefined; clearInterval(this.pressure) }
        resolve()
      }) }) }
    // The request listener reports errors; this prevents an event between request detach and close from escaping.
    child.on('error', () => {})
    child.unref()
    return helper
  }

  private stop(helper: Helper): Promise<void> {
    if (helper.stop) return helper.stop
    if (this.helper === helper) { this.helper = undefined; clearInterval(this.pressure) }
    helper.stop = (async () => {
      // Inference can block the helper's event loop, so cooperative IPC shutdown cannot bound native work.
      if (helper.process.exitCode === null && helper.process.signalCode === null) helper.process.kill('SIGKILL')
      await helper.exited
    })()
    this.retiring = helper.stop
    return helper.stop
  }

  private request(
    helper: Helper, payload: DecisionPayload, options: LocalDecisionOptions, signal: AbortSignal,
  ): Promise<Record<string, JsonValue>> {
    return new Promise((resolve, reject) => {
      const child = helper.process, id = ++this.sequence
      let settled = false
      const timer = helper.warm ? setTimeout(() => { stop(new Error('Local Decision timed out; its helper was stopped.'), true) }, options.warmTimeoutMs) : undefined
      const clean = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        child.off('message', message); child.off('error', failed); child.off('close', exited)
      }
      const stop = (error: Error, failure = false): void => {
        if (settled) return
        settled = true; clean()
        if (failure) this.retryAt = Date.now() + options.restartCooldownMs
        void this.stop(helper).then(() => { reject(error) }, () => { reject(error) })
      }
      const aborted = (): void => { stop(this.cancelReason(signal), this.cancelReason(signal).message.startsWith('Local Decision timed out')) }
      const failed = (error: Error): void => { stop(new Error('Local Decision helper failed: ' + decisionEvidence(error.message, 600)), true) }
      const exited = (): void => { stop(new Error('Local Decision helper exited; a later request can restart it.'), helper.stop === undefined) }
      const message = (value: unknown): void => {
        if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) { stop(new Error('Invalid local Decision reply.'), true); return }
        if ('error' in value) { stop(new Error(typeof value.error === 'string' ? decisionEvidence(value.error, 1000) : 'Local Decision failed.'), true); return }
        try {
          if (!('result' in value)) throw new Error('Local Decision omitted its result.')
          if (!value.result || typeof value.result !== 'object' || !('revision' in value.result) || value.result.revision !== manifest.revision
            || !('model' in value.result) || value.result.model !== manifest.model) throw new Error('Local Decision model identity does not match the installed build.')
          const result = decisionResponse(value.result as JsonValue, payload.questions)
          if ('memory' in value && value.memory && typeof value.memory === 'object') {
            if ('rss' in value.memory && typeof value.memory.rss === 'number' && Number.isFinite(value.memory.rss) && value.memory.rss >= 0) helper.rss = value.memory.rss
            if ('peakRss' in value.memory && typeof value.memory.peakRss === 'number' && Number.isFinite(value.memory.peakRss) && value.memory.peakRss >= 0) helper.peakRss = value.memory.peakRss
          }
          helper.warm = true
          settled = true; clean(); resolve({ ...result, runtime: 'local', revision: manifest.revision })
        } catch { stop(new Error('Local Decision returned an invalid answer.'), true) }
      }
      signal.addEventListener('abort', aborted, { once: true })
      child.on('message', message); child.once('error', failed); child.once('close', exited)
      if (signal.aborted) { aborted(); return }
      child.send({ id, state: payload.state, questions: payload.questions, options: {
        directory: options.directory, runtimeDirectory: options.runtimeDirectory ?? dirname(options.directory), threads: options.threads,
      } }, (error) => { if (error) failed(error) })
    })
  }

  private cancelReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('Local Decision cancelled.')
  }

  private assertAccepting(): void {
    if (this.closed) throw new Error('Local Decision is closed.')
    if (this.unloading) throw new Error('Local Decision is unloading.')
  }

  /** Stop active inference, reject pending requests, and await every owned process exit. */
  async dispose(): Promise<void> {
    this.closed = true
    await this.unload()
  }
}
