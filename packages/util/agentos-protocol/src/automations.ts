/** Desktop automation records shared by management clients and the local runner. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of a saved automation. */
export type AutomationId = Branded<'AutomationId'>
/** Identity of one claimed occurrence. */
export type AutomationRunId = Branded<'AutomationRunId'>
/** Calendar rules retain an IANA time zone independently of the computer's current zone. */
export type AutomationRule =
  | { kind: 'once'; at: string; timeZone: string }
  | { kind: 'interval'; minutes: number; timeZone: string }
  | { kind: 'calendar'; cron: string; timeZone: string }
/** User-owned task and execution limits; credentials are resolved through the selected provider. */
export interface AutomationSpec {
  name: string
  instructions: string
  workspace: string
  mode: 'coding' | 'job' | 'normal' | 'repair'
  rule: AutomationRule
  submission: 'review' | 'automatic'
  maxRunMinutes: number
  catchUpHours: number
  model: { provider: string; model: string; reasoningEffort?: string }
  originSessionId?: string
}
/** Authoritative schedule revision; a running occurrence retains its own spec snapshot. */
export interface Automation extends AutomationSpec {
  id: AutomationId
  revision: number
  enabled: boolean
  createdAt: number
  nextAt: number | null
}
/** Durable execution states; needs_attention never implies an external action succeeded. */
export type AutomationRunStatus = 'queued' | 'running' | 'completed' | 'needs_attention' | 'failed' | 'cancelled' | 'skipped'
/** One occurrence and its independently owned conversation. */
export interface AutomationRun {
  id: AutomationRunId
  automationId: AutomationId
  scheduledAt: number
  status: AutomationRunStatus
  spec: AutomationSpec
  sessionId: string | null
  startedAt: number | null
  finishedAt: number | null
  summary: string
}
/** Paginated history accompanies the complete small schedule catalog. */
export interface AutomationSnapshot {
  automations: Automation[]
  runs: AutomationRun[]
  nextRunCursor: number | null
  pausedForUpdate: boolean
}
