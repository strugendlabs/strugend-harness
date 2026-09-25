/** Single-worker scheduling with durable admission and quiescent cancellation. */
import type { AutomationRun, AutomationRunId } from '@deepseek-ai/dsh-agentos-protocol'
import { AutomationStore } from './automation-store.ts'

/** Execution outcome describes the owned task interval, including any user steering. */
export interface AutomationOutcome { status: 'completed' | 'needs_attention' | 'failed'; summary: string }
/** Scheduler resources and callbacks supplied by the desktop Host. */
export interface AutomationEngineOptions {
  idlePollMs: number
  clockCheckMs: number
  busy(): boolean
  execute(run: AutomationRun, signal: AbortSignal): Promise<AutomationOutcome>
  changed(run?: AutomationRun): void
  error(error: unknown): void
}
/** Owns one wake timer and at most one running model task. */
export class AutomationEngine {
  private timer?: ReturnType<typeof setTimeout>
  private active: { id: AutomationRunId; abort: AbortController; done: Promise<void>; cancelled: boolean } | undefined
  private stopped = false
  private locked = false
  /** @param store - Durable catalog. @param options - Host lifecycle and execution callbacks. */
  constructor(readonly store: AutomationStore, private readonly options: AutomationEngineOptions) {}
  /** @returns Whether admission is held for an application update. */
  get pausedForUpdate(): boolean { return this.locked }
  /** @returns Whether a scheduled task has entered execution. */
  get running(): boolean { return this.active !== undefined }
  /** @param locked - Hold or release admission before checking updater idleness. */
  lock(locked: boolean): void { this.locked = locked; this.wake() }
  /** Recalculate deadlines after a mutation, resume, or clock change. */
  wake(): void {
    if (this.stopped) return
    clearTimeout(this.timer)
    try {
      const now = Date.now()
      if (!this.locked) this.store.claimDue(now)
      if (!this.locked && !this.active && !this.options.busy()) {
        const run = this.store.byStatus('queued').sort((a, b) => a.scheduledAt - b.scheduledAt)[0]
        if (run) {
          if (now - run.scheduledAt > run.spec.catchUpHours * 3600_000) this.store.finish(run.id, 'needs_attention', 'The queued task exceeded its catch-up allowance.', now)
          else this.launch(this.store.start(run, now))
        }
      }
      const queued = this.store.byStatus('queued').length > 0
      const next = Math.min(...this.store.list().filter(row => row.enabled && row.nextAt !== null).map(row => row.nextAt ?? Infinity))
      const delay = this.locked || this.active ? this.options.clockCheckMs
        : queued ? this.options.idlePollMs : Math.max(250, Math.min(this.options.clockCheckMs, next - now))
      this.timer = setTimeout(() => { this.wake() }, delay)
      this.timer.unref()
    } catch (error) {
      this.options.error(error)
      this.timer = setTimeout(() => { this.wake() }, this.options.clockCheckMs)
      this.timer.unref()
    }
  }
  /** @param id - Run to cancel. @returns Once its execution has actually stopped. */
  async cancel(id: AutomationRunId): Promise<void> {
    if (this.active?.id === id) { this.active.cancelled = true; this.active.abort.abort(new Error('Automation cancelled.')); await this.active.done }
    else {
      if (this.store.run(id)?.status !== 'queued') throw new Error('Only queued or running tasks can be cancelled.')
      this.store.finish(id, 'cancelled', 'Cancelled by user.', Date.now()); this.options.changed()
    }
  }
  /** Prevent new dispatch and wait for owned work to reach quiescence. */
  async dispose(): Promise<void> {
    this.stopped = true; clearTimeout(this.timer)
    this.active?.abort.abort(new Error('Application is stopping.'))
    await this.active?.done
  }
  private launch(run: AutomationRun): void {
    const abort = new AbortController()
    const timeout = setTimeout(() => { abort.abort(new Error('Automation reached its run limit.')) }, run.spec.maxRunMinutes * 60_000)
    const done = Promise.resolve().then(() => this.options.execute(run, abort.signal)).then((outcome) => {
      this.store.finish(run.id, this.active?.cancelled ? 'cancelled' : abort.signal.aborted ? 'needs_attention' : outcome.status, abort.signal.aborted ? String(abort.signal.reason) : outcome.summary, Date.now())
    }, (error: unknown) => {
      this.store.finish(run.id, this.active?.cancelled ? 'cancelled' : abort.signal.aborted ? 'needs_attention' : 'failed', error instanceof Error ? error.message : 'Run failed.', Date.now())
    }).catch((error: unknown) => { this.options.error(error) }).finally(() => {
      clearTimeout(timeout); this.active = undefined
      if (!this.stopped) { this.options.changed(this.store.run(run.id)); this.wake() }
    })
    this.active = { id: run.id, abort, done, cancelled: false }; this.options.changed(run)
  }
}
