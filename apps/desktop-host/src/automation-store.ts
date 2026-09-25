/** Transactional local schedule catalog, occurrence claims, and submission receipts. */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync, lstatSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Automation, AutomationId, AutomationRun, AutomationRunId, AutomationSpec } from '@deepseek-ai/dsh-agentos-protocol'
import { automationSpec, coalesceOccurrences, nextOccurrence } from './automation-rules.ts'

/** Owns the scheduler database; callers use a single desktop Host instance. */
export class AutomationStore {
  private readonly db: DatabaseSync
  /** @param path - Private application database filename. */
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try { closeSync(openSync(path, 'wx', 0o600)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Automation database must be a regular file.')
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.['user_version'])
      if (version !== 0 && version !== 1) throw new Error('This automation database requires a newer Strugend version.')
      this.db.exec(`CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, due INTEGER NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS runs_status ON runs(status, due);
        CREATE TABLE IF NOT EXISTS submissions(key TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS submissions_run ON submissions(run_id, state);
        PRAGMA user_version=1;`)
      for (const run of this.byStatus('running')) this.finish(run.id, 'needs_attention', 'Interrupted by restart. Check the existing task and any submission before retrying.', Date.now())
    } catch (error) { this.db.close(); throw error }
  }
  /** @returns Every saved schedule, ordered by creation. */
  list(): Automation[] {
    return this.db.prepare('SELECT value FROM automations ORDER BY rowid').all().map((row) => {
      const value = JSON.parse(String(row.value)) as Automation
      const spec = automationSpec(value)
      if (typeof value.id !== 'string' || !Number.isSafeInteger(value.revision) || typeof value.enabled !== 'boolean'
        || !Number.isFinite(value.createdAt) || (value.nextAt !== null && !Number.isFinite(value.nextAt))) throw new Error('Invalid saved automation.')
      return { ...value, ...spec }
    })
  }
  /** @param before - Optional history cursor. @param limit - Maximum returned rows. @returns Recent occurrences. */
  runs(before = Number.MAX_SAFE_INTEGER, limit = 10_000): AutomationRun[] {
    return this.db.prepare('SELECT value FROM runs WHERE rowid < ? ORDER BY rowid DESC LIMIT ?').all(before, limit).map(row => readRun(row.value))
  }

  /** @param status - Execution state. @returns Only matching occurrences, without loading completed history. */
  byStatus(status: AutomationRun['status']): AutomationRun[] {
    return this.db.prepare('SELECT value FROM runs WHERE status=? ORDER BY due').all(status).map(row => readRun(row.value))
  }
  /** @param id - Occurrence identity. @returns Exact run without scanning history. */
  run(id: AutomationRunId): AutomationRun | undefined { const row = this.db.prepare('SELECT value FROM runs WHERE id=?').get(id); return row ? readRun(row.value) : undefined }
  /** @param before - Exclusive row cursor. @returns Recent history and a cursor that excludes returned rows. */
  history(before = Number.MAX_SAFE_INTEGER): { runs: AutomationRun[]; nextRunCursor: number | null } {
    const rows = this.db.prepare('SELECT rowid FROM runs WHERE rowid < ? ORDER BY rowid DESC LIMIT 50').all(before)
    return { runs: this.runs(before, 50), nextRunCursor: rows.length < 50 ? null : Number(rows.at(-1)?.rowid) }
  }
  /** @param id - Saved identifier. @returns Schedule or throws when deleted. */
  get(id: string): Automation { const value = this.list().find(row => row.id === id); if (!value) throw new Error('Automation not found.'); return value }
  /** @param input - Validated task. @param now - Creation time. @returns Persisted active schedule. */
  create(input: AutomationSpec, now: number): Automation {
    const spec = automationSpec(input), nextAt = nextOccurrence(spec.rule, now)
    if (nextAt === null) throw new Error('Choose a future scheduled time.')
    const row: Automation = { ...spec, id: randomUUID() as AutomationId, revision: 1, enabled: true, createdAt: now, nextAt }
    this.save(row); return row
  }
  /**
   * @param id - Schedule identity.
   * @param revision - Last observed revision.
   * @param spec - Replacement task.
   * @param now - Edit time.
   * @returns Updated schedule.
   */
  update(id: string, revision: number, spec: AutomationSpec, now: number): Automation {
    const row = this.get(id)
    if (row.revision !== revision) throw new Error('This automation changed. Refresh before editing.')
    const nextAt = nextOccurrence(spec.rule, now)
    if (nextAt === null) throw new Error('Choose a future scheduled time.')
    const result = { ...row, ...automationSpec(spec), revision: revision + 1, nextAt }
    this.save(result); return result
  }
  /** @param id - Schedule identity. @param enabled - Whether future occurrences may run. @returns Updated schedule. */
  enable(id: string, enabled: boolean): Automation {
    const row = this.get(id), result = { ...row, enabled, revision: row.revision + 1 }
    this.save(result); return result
  }
  /** @param id - Schedule identity. Removes future scheduling, retaining history. */
  remove(id: string): void { this.db.prepare('DELETE FROM automations WHERE id=?').run(id) }
  /** @param now - Current time. Atomically enqueue each latest due occurrence and advance its schedule. */
  claimDue(now: number): void {
    this.transaction(() => {
      for (const row of this.list()) {
        if (!row.enabled || row.nextAt === null || row.nextAt > now) continue
        const occurrence = coalesceOccurrences(row.rule, row.nextAt, now)
        const late = now - occurrence.due > row.catchUpHours * 3600_000
        const id = `${row.id}-${row.nextAt}` as AutomationRunId
        const pending = this.byStatus('queued').find(run => run.automationId === row.id)
        if (pending) this.finish(pending.id, 'skipped', 'Coalesced into a newer occurrence.', now)
        this.insert({ id, automationId: row.id, scheduledAt: occurrence.due, spec: automationSpec(row),
          status: late ? (row.rule.kind === 'once' ? 'needs_attention' : 'skipped') : 'queued', sessionId: null, startedAt: null,
          finishedAt: late ? now : null, summary: late ? 'Missed the catch-up window.' : '' })
        this.save({ ...row, nextAt: occurrence.next, revision: row.revision + 1 })
      }
    })
  }
  /** @param id - Schedule to run outside its calendar. @param now - Request time. @returns New queued occurrence. */
  runNow(id: string, now: number): AutomationRun {
    if ([...this.byStatus('running'), ...this.byStatus('queued')].some(row => row.automationId === id)) throw new Error('This automation already has an active run.')
    const run: AutomationRun = { id: randomUUID() as AutomationRunId, automationId: id as AutomationId, scheduledAt: now,
      spec: automationSpec(this.get(id)), status: 'queued', sessionId: null, startedAt: null, finishedAt: null, summary: '' }
    this.insert(run); return run
  }
  /** @param run - Previously queued occurrence. @param now - Start time. @returns Claimed run with its preallocated task ID. */
  start(run: AutomationRun, now: number): AutomationRun {
    const value: AutomationRun = { ...run, status: 'running', sessionId: `automation-${randomUUID()}`, startedAt: now }
    const changed = this.db.prepare("UPDATE runs SET status='running', value=? WHERE id=? AND status='queued'").run(JSON.stringify(value), run.id)
    if (Number(changed.changes) !== 1) throw new Error('This occurrence is already claimed.')
    return value
  }
  /**
   * @param id - Occurrence identity.
   * @param status - Terminal result.
   * @param summary - User-readable outcome.
   * @param now - Completion time.
   */
  finish(id: AutomationRunId, status: AutomationRun['status'], summary: string, now: number): void {
    const row = this.db.prepare('SELECT value FROM runs WHERE id=?').get(id)
    if (!row) throw new Error('Automation run not found.')
    const run = readRun(row.value)
    this.db.prepare('UPDATE runs SET status=?, value=? WHERE id=?').run(status, JSON.stringify({ ...run, status, summary: summary.slice(0, 8000), finishedAt: now }), id)
  }
  /**
   * @param identity - Stable destination, account label and vacancy identity.
   * @param receipt - Intent or confirmed receipt.
   * @returns Existing receipt; a reserved or confirmed application cannot be reserved twice.
   */
  submission(identity: string, receipt?: SubmissionReceipt): SubmissionReceipt | null {
    const key = createHash('sha256').update(identity.trim().normalize('NFC').replace(/\s+/g, ' ')).digest('hex')
    const existing = this.db.prepare('SELECT value FROM submissions WHERE key=?').get(key)
    const previous = existing ? readReceipt(existing.value) : null
    if (receipt) {
      if (receipt.state === 'intent' && previous) throw new Error('This application is already reserved or confirmed. Inspect the existing receipt; do not submit it again.')
      if (receipt.state === 'confirmed' && (!previous || previous.runId !== receipt.runId || previous.state !== 'intent')) throw new Error('Confirm only an intent owned by this run.')
      this.db.prepare('INSERT INTO submissions VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state, value=excluded.value').run(key, receipt.runId, receipt.state, JSON.stringify(receipt))
    }
    return previous
  }
  /** @param runId - Owned occurrence. @returns Whether a submitted application still needs reconciliation. */
  hasUnconfirmedSubmission(runId: AutomationRunId): boolean {
    return this.db.prepare("SELECT 1 FROM submissions WHERE run_id=? AND state='intent' LIMIT 1").get(runId) !== undefined
  }
  /** Release the durable store after all runs and callbacks have stopped. */
  close(): void { this.db.close() }
  private save(row: Automation): void { this.db.prepare('INSERT INTO automations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(row.id, JSON.stringify(row)) }
  private insert(run: AutomationRun): void { this.db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?,?,?,?)').run(run.id, run.automationId, run.scheduledAt, run.status, JSON.stringify(run)) }
  private transaction(operation: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try { operation(); this.db.exec('COMMIT') } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

interface SubmissionReceipt { runId: AutomationRunId; state: 'intent' | 'confirmed'; evidence: string }
function readReceipt(raw: unknown): SubmissionReceipt {
  const value = JSON.parse(String(raw)) as SubmissionReceipt | null
  if (!value || typeof value.runId !== 'string' || !['intent', 'confirmed'].includes(value.state) || typeof value.evidence !== 'string') throw new Error('Invalid saved submission receipt.')
  return value
}
function readRun(raw: unknown): AutomationRun {
  const value = JSON.parse(String(raw)) as AutomationRun | null
  if (!value || !['queued', 'running', 'completed', 'needs_attention', 'failed', 'cancelled', 'skipped'].includes(value.status)
    || typeof value.id !== 'string' || typeof value.automationId !== 'string' || !Number.isFinite(value.scheduledAt)
    || typeof value.summary !== 'string' || (value.sessionId !== null && typeof value.sessionId !== 'string')
    || (value.startedAt !== null && !Number.isFinite(value.startedAt)) || (value.finishedAt !== null && !Number.isFinite(value.finishedAt))) throw new Error('Invalid saved automation run.')
  return { ...value, spec: automationSpec(value.spec) }
}
