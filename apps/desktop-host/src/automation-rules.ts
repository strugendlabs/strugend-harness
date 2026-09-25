/** Validation and calendar arithmetic for persisted desktop automations. */
import { isAbsolute } from 'node:path'
import { Cron } from 'croner'
import type { AutomationRule, AutomationSpec } from '@deepseek-ai/dsh-agentos-protocol'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an automation object.')
  return value as Record<string, unknown>
}
function string(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${field}.`)
  return value.trim()
}
function number(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${field}: use ${min}–${max}.`)
  return Number(value)
}

/** @param input - Tool, HTTP, or durable JSON. @returns A validated rule with an explicit time zone. */
export function automationRule(input: unknown): AutomationRule {
  const r = record(input)
  const timeZone = string(r.timeZone, 'time zone')
  new Intl.DateTimeFormat('en', { timeZone }).format()
  if (r.kind === 'once') {
    const at = string(r.at, 'date')
    if (!/(Z|[+-]\d\d:\d\d)$/u.test(at) || !Number.isFinite(Date.parse(at))) throw new Error('Use an ISO date with UTC offset.')
    return { kind: 'once', at: new Date(at).toISOString(), timeZone }
  }
  if (r.kind === 'interval') return { kind: 'interval', minutes: number(r.minutes, 'interval minutes', 5, 525600), timeZone }
  if (r.kind !== 'calendar') throw new Error('Use a once, interval, or calendar rule.')
  const cron = string(r.cron, 'calendar expression')
  if (cron.split(/\s+/u).length !== 5) throw new Error('Use a five-field calendar expression (minute hour day month weekday).')
  const job = new Cron(cron, { timezone: timeZone, paused: true })
  try {
    const dates = job.nextRuns(100)
    if (dates.length === 0 || dates.some((d, i) => {
      const previous = dates[i - 1]
      return previous !== undefined && d.getTime() - previous.getTime() < 300_000
    }))
      throw new Error('Calendar schedules must have future occurrences at least five minutes apart.')
  } finally { job.stop() }
  return { kind: 'calendar', cron, timeZone }
}

/** @param input - Untrusted schedule JSON. @returns A detached validated task specification. */
export function automationSpec(input: unknown): AutomationSpec {
  const r = record(input), model = record(r.model)
  const workspace = string(r.workspace, 'workspace', 4096)
  if (!isAbsolute(workspace)) throw new Error('Choose an absolute workspace path.')
  if (!['coding', 'job', 'normal', 'repair'].includes(String(r.mode))) throw new Error('Choose Coding, Job, Normal, or Repair mode.')
  if (r.submission !== 'review' && r.submission !== 'automatic') throw new Error('Choose review or automatic submission.')
  return {
    name: string(r.name, 'name'), instructions: string(r.instructions, 'instructions', 32_000), workspace,
    mode: r.mode as AutomationSpec['mode'], rule: automationRule(r.rule), submission: r.submission,
    maxRunMinutes: number(r.maxRunMinutes, 'run minutes', 1, 240), catchUpHours: number(r.catchUpHours, 'catch-up hours', 1, 168),
    model: { provider: string(model.provider, 'provider'), model: string(model.model, 'model'),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: string(model.reasoningEffort, 'reasoning effort') }) },
    ...(r.originSessionId === undefined ? {} : { originSessionId: string(r.originSessionId, 'origin task') }),
  }
}

/** @param rule - Validated recurrence. @param after - Exclusive UTC millisecond lower bound. @returns Next occurrence or null. */
export function nextOccurrence(rule: AutomationRule, after: number): number | null {
  if (rule.kind === 'once') return Date.parse(rule.at) > after ? Date.parse(rule.at) : null
  if (rule.kind === 'interval') return after + rule.minutes * 60_000
  const job = new Cron(rule.cron, { timezone: rule.timeZone, paused: true })
  try {
    let date = job.nextRun(new Date(after))
    // Croner 10 advances nonexistent local times; discard dates that do not match the saved wall-clock rule.
    while (date !== null && !job.match(date)) date = job.nextRun(date)
    return date?.getTime() ?? null
  } finally { job.stop() }
}

/**
 * @param rule - Validated recurrence.
 * @param due - First unclaimed occurrence.
 * @param now - Current UTC milliseconds.
 * @returns Latest due and following occurrence.
 */
export function coalesceOccurrences(rule: AutomationRule, due: number, now: number): { due: number; next: number | null } {
  if (rule.kind === 'once') return { due, next: null }
  if (rule.kind === 'interval') {
    const period = rule.minutes * 60_000
    const latest = due + Math.floor((now - due) / period) * period
    return { due: latest, next: latest + period }
  }
  // Only the catch-up window can run; older occurrences are summarized as one skipped run.
  let latest = due
  let next = nextOccurrence(rule, Math.max(due, now - 7 * 86400_000))
  while (next !== null && next <= now) { latest = next; next = nextOccurrence(rule, next) }
  return { due: latest, next }
}
