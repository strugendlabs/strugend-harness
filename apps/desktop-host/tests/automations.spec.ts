import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutomationSpec } from '@deepseek-ai/dsh-agentos-protocol'
import { automationRule, automationSpec, nextOccurrence, coalesceOccurrences } from '../src/automation-rules.ts'
import { AutomationStore } from '../src/automation-store.ts'
import { AutomationEngine } from '../src/automation-engine.ts'
import { draftToolAllowed } from '../src/automation-runner.ts'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers() })
const now = Date.parse('2026-09-25T07:00:00Z')
function spec(): AutomationSpec { return { name: 'Find jobs', instructions: 'Find roles matching my supplied profile.', workspace: tmpdir(),
  mode: 'job', rule: { kind: 'interval', minutes: 5, timeZone: 'Europe/Berlin' }, submission: 'review', maxRunMinutes: 30, catchUpHours: 24,
  model: { provider: 'fixture', model: 'synthetic' } } }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'strugend-automations-')); cleanups.push(() =>{  rmSync(root, { recursive: true, force: true }) })
  const store = new AutomationStore(join(root, 'test.sqlite')); cleanups.push(() =>{  store.close() }); return { store, root }
}
it('validates timezone, bounds and offset-bearing one-time dates', () => {
  expect(() => automationRule({ kind: 'once', at: '2026-10-01T09:00:00', timeZone: 'Europe/Berlin' })).toThrow(/offset/)
  expect(() => automationRule({ kind: 'interval', minutes: 1, timeZone: 'Europe/Berlin' })).toThrow(/minutes/)
  expect(() => automationRule({ kind: 'calendar', cron: '* * * * *', timeZone: 'Europe/Berlin' })).toThrow(/five minutes/)
  expect(() => automationRule({ kind: 'calendar', cron: '0 9 * * *', timeZone: 'invalid' })).toThrow()
  expect(() => automationSpec({ ...spec(), workspace: 'relative' })).toThrow(/absolute/)
  expect(() => automationSpec({ ...spec(), catchUpHours: 0 })).toThrow(/catch-up hours/)
  expect(automationSpec(spec())).toEqual(spec())
})
it('retains local calendar time across daylight saving and runs a repeated local time once', () => {
  const rule = automationRule({ kind: 'calendar', cron: '30 2 * * *', timeZone: 'Europe/Berlin' })
  const first = nextOccurrence(rule, Date.parse('2026-10-25T00:00:00Z'))!
  expect(new Date(first).toISOString()).toBe('2026-10-25T00:30:00.000Z')
  expect(new Date(nextOccurrence(rule, first)!).toISOString()).toBe('2026-10-26T01:30:00.000Z')
  expect(new Date(nextOccurrence(rule, Date.parse('2026-03-29T00:00:00Z'))!).toISOString()).toBe('2026-03-30T00:30:00.000Z')
})
it('coalesces missed intervals without shifting their original cadence', () => {
  expect(coalesceOccurrences(spec().rule, now, now + 17 * 60_000)).toEqual({ due: now + 15 * 60_000, next: now + 20 * 60_000 })
})
it('claims each occurrence once and keeps only the latest queued occurrence', () => {
  const { store } = fixture(); const schedule = store.create(spec(), now)
  store.claimDue(now + 10 * 60_000); store.claimDue(now + 10 * 60_000)
  expect(store.byStatus('queued')).toHaveLength(1)
  store.claimDue(now + 30 * 60_000)
  expect(store.byStatus('queued')).toHaveLength(1)
  expect(store.byStatus('queued')[0]!.scheduledAt).toBe(now + 30 * 60_000)
  expect(store.get(schedule.id).nextAt).toBe(now + 35 * 60_000)
  expect(store.byStatus('skipped')).toHaveLength(1)
})
it('records late one-time work for review and refuses already elapsed new schedules', () => {
  const { store } = fixture()
  const input = { ...spec(), rule: { kind: 'once' as const, at: new Date(now + 60_000).toISOString(), timeZone: 'Europe/Berlin' } }
  store.create(input, now); store.claimDue(now + 25 * 3600_000)
  expect(store.byStatus('needs_attention')).toHaveLength(1)
  expect(() => store.create(input, now + 3600_000)).toThrow(/future/)
})
it('rejects stale edits and a second claim of the same run', () => {
  const { store } = fixture(); const row = store.create(spec(), now)
  store.update(row.id, row.revision, { ...spec(), name: 'Changed' }, now)
  expect(() => store.update(row.id, row.revision, spec(), now)).toThrow(/Refresh/)
  const run = store.runNow(row.id, now)
  store.start(run, now)
  expect(() => store.start(run, now)).toThrow(/already claimed/)
  expect(() => store.runNow(row.id, now)).toThrow(/active run/)
})
it('preserves submission records and marks interrupted execution for review after reopening', () => {
  const root = mkdtempSync(join(tmpdir(), 'strugend-recovery-')); cleanups.push(() =>{  rmSync(root, { recursive: true, force: true }) })
  const path = join(root, 'test.sqlite'), first = new AutomationStore(path)
  const row = first.create(spec(), now), run = first.start(first.runNow(row.id, now), now)
  first.submission('employer/account/job42', { runId: run.id, state: 'intent', evidence: '' }); first.close()
  const reopened = new AutomationStore(path); cleanups.push(() =>{  reopened.close() })
  expect(reopened.run(run.id)?.status).toBe('needs_attention')
  expect(reopened.submission('employer/account/job42')).toMatchObject({ state: 'intent', runId: run.id })
  expect(reopened.list()).toHaveLength(1)
})
it('keeps foreground priority and updater admission independent of due times', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  const { store } = fixture(); const row = store.create(spec(), now)
  let busy = true
  const execute = vi.fn(async () => ({ status: 'completed' as const, summary: 'Fixture result verified.' }))
  const engine = new AutomationEngine(store, { busy: () => busy, execute, changed: () => {},
    error: (error) => { throw error }, idlePollMs: 1000, clockCheckMs: 60_000 })
  cleanups.push(() => engine.dispose())
  store.runNow(row.id, now); engine.wake(); expect(execute).not.toHaveBeenCalled()
  engine.lock(true); busy = false; engine.wake(); expect(execute).not.toHaveBeenCalled()
  engine.lock(false); await vi.advanceTimersByTimeAsync(1)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(store.byStatus('completed')).toHaveLength(1)
})
it('serializes multiple schedules and waits for cancellation to settle', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  const { store } = fixture(); const a = store.create(spec(), now), b = store.create({ ...spec(), name: 'Exams' }, now)
  let release!: () => void, aborted = false
  const held = new Promise<void>((resolve) => { release = resolve })
  const execute = vi.fn(async (_run, signal: AbortSignal) => { signal.addEventListener('abort', () => { aborted = true }); await held; return { status: 'completed' as const, summary: 'Fixture done.' } })
  const engine = new AutomationEngine(store, { busy: () => false, execute, changed: () => {},
    error: () => {}, idlePollMs: 1000, clockCheckMs: 60_000 })
  cleanups.push(() => engine.dispose())
  store.runNow(a.id, now); store.runNow(b.id, now); engine.wake(); await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(1)
  let disposed = false; const closing = engine.dispose().then(() => { disposed = true })
  await Promise.resolve(); expect(aborted).toBe(true); expect(disposed).toBe(false)
  release(); await closing
  expect(store.byStatus('needs_attention')).toHaveLength(1)
  expect(store.byStatus('queued')).toHaveLength(1)
  expect(execute).toHaveBeenCalledTimes(1)
})
it('allows research and local drafts but blocks shell, delegation and browser submissions', () => {
  expect(draftToolAllowed('write', { path: '/workspace/resume.md' })).toBe(true)
  expect(draftToolAllowed('desktop_browser', { action: 'observe' })).toBe(true)
  for (const name of ['bash', 'pwsh', 'run_code', 'subagent', 'deliver_project']) expect(draftToolAllowed(name, {})).toBe(false)
  for (const action of ['click', 'key', 'click_point', 'upload', 'fill']) expect(draftToolAllowed('desktop_browser', { action })).toBe(false)
})

it('requires an owned intent before confirmation and never reserves the same application twice', () => {
  const { store: db } = fixture(); const row = db.create(spec(), Date.now()), run = db.start(db.runNow(row.id, now), now)
  expect(() => db.submission('portal/account/vacancy', { runId: run.id, state: 'confirmed', evidence: 'Receipt 123' })).toThrow(/intent/)
  db.submission('portal/account/vacancy', { runId: run.id, state: 'intent', evidence: '' })
  expect(db.hasUnconfirmedSubmission(run.id)).toBe(true)
  expect(() => db.submission(' portal/account/vacancy ', { runId: run.id, state: 'intent', evidence: '' })).toThrow(/already/)
  db.submission('portal/account/vacancy', { runId: run.id, state: 'confirmed', evidence: 'Receipt 123' })
  expect(db.hasUnconfirmedSubmission(run.id)).toBe(false)
  expect(db.submission('portal/account/vacancy')).toMatchObject({ state: 'confirmed', evidence: 'Receipt 123' })
})

it('records explicit cancellation and refuses to rewrite terminal history', async () => {
  const { store: db } = fixture(); const row = db.create(spec(), Date.now()), run = db.runNow(row.id, Date.now())
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const engine = new AutomationEngine(db, { idlePollMs: 1000, clockCheckMs: 1000, busy: () => false,
    execute: async (_run, signal) => { entered(); await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) }); return { status: 'completed', summary: 'Finished' } },
    changed: () => {}, error: (error) => { throw error } })
  cleanups.push(() => engine.dispose()); engine.wake(); await started
  await engine.cancel(run.id)
  expect(db.run(run.id)?.status).toBe('cancelled')
  await expect(engine.cancel(run.id)).rejects.toThrow(/Only queued/)
})

it('pages durable history without repeating occurrences', () => {
  const { store } = fixture(); const row = store.create(spec(), now)
  for (let index = 0; index < 51; index++) {
    const run = store.runNow(row.id, now + index)
    store.finish(run.id, 'completed', 'Fixture result', now + index)
  }
  const first = store.history(), second = store.history(first.nextRunCursor!)
  expect(first.runs).toHaveLength(50); expect(second.runs).toHaveLength(1)
  expect(second.nextRunCursor).toBeNull()
  expect(new Set([...first.runs, ...second.runs].map(run => run.id)).size).toBe(51)
})
