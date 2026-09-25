/** Persistent desktop automations exposed through authenticated management and ordinary agent tools. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-jobs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AutomationRunId, AutomationSnapshot } from '@deepseek-ai/dsh-agentos-protocol'
import { AutomationStore } from './automation-store.ts'
import { AutomationEngine } from './automation-engine.ts'
import { automationSpec, nextOccurrence } from './automation-rules.ts'
import { executeAutomation } from './automation-runner.ts'
import { desktopRequest } from './agentos-bridge.ts'

declare module '@deepseek-ai/cordis' { interface Context { /** Desktop background task admission shared with the updater. */ strugendAutomations: AutomationEngine } }
/** Desktop-only plugin identity. */
export const name = 'strugend-automations'
/** Explicit services needed for cold task creation and logged management. */
export const inject = ['agents', 'sessions', 'agentPresets', 'agentDefaultModel', 'workspaceRegistry', 'sessionTitle', 'permissionPresets', 'tools', 'systemPrompt', 'connection', 'settings', 'jobs']
/** Deployment scheduling cadence and user-data root. */
export const Config: z<Config> = z.object({
  root: z.string().required(), idlePollMs: z.number().min(1000).default(5000), clockCheckMs: z.number().min(1000).default(60000),
})
/** Validated plugin configuration. */
export interface Config { root: string; idlePollMs: number; clockCheckMs: number }

/** @param ctx - Owning desktop Host. @param config - Validated paths and scheduling cadence. */
export function apply(ctx: Context, config: Config): void {
  const store = new AutomationStore(join(config.root, 'automations.sqlite'))
  const engine = new AutomationEngine(store, {
    idlePollMs: config.idlePollMs, clockCheckMs: config.clockCheckMs,
    busy: () => ctx.agents.list().some(agent => agent.status === 'running' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
      || [undefined, ...ctx.agents.list()].some(agent => ctx.jobs.list(agent).some(job => ['running', 'stopping'].includes(job.status))),
    execute: (run, signal) => executeAutomation(ctx, run, store, signal),
    changed: (run) => {
      void desktopRequest({ method: 'automation-state', enabled: engine.running || store.byStatus('queued').length > 0 || store.list().some(row => row.enabled && row.nextAt !== null),
        ...(run && ['completed', 'needs_attention', 'failed'].includes(run.status) ? { notification: { title: run.spec.name, body: run.summary, sessionId: run.sessionId } } : {}),
      }).catch((error: unknown) => { ctx.logger.warn(String(error)) })
    }, error: (error) => { ctx.logger.error(String(error)) },
  })
  ctx.effect(() => ctx.reflect.provide('strugendAutomations', engine))
  ctx.effect(() => async () => { await engine.dispose(); store.close() })
  const snapshot = (before?: number): AutomationSnapshot => ({
    automations: store.list(), ...store.history(before), pausedForUpdate: engine.pausedForUpdate,
  })
  const defaults = (input: unknown, agent?: Agent) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide a task specification.')
    const model = agent?.session.requestHeader()?.config ?? ctx.agentDefaultModel.currentSelection()
    return automationSpec({ mode: 'normal', submission: 'review', maxRunMinutes: 30, catchUpHours: 24,
      workspace: agent?.session.header.cwd, model: { provider: model.provider, model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }) },
      ...agent ? { originSessionId: agent.id } : {}, ...input })
  }
  const mutate = async (input: unknown, agent?: Agent): Promise<unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid automation operation.')
    if (engine.pausedForUpdate) throw new Error('An update is preparing. Try again after restart.')
    const body = input as Record<string, unknown>, id = typeof body.id === 'string' ? body.id : ''
    let result: unknown
    if (body.action === 'create' || body.action === 'preview') {
      const spec = defaults(body.spec, agent)
      if (body.action === 'preview') {
        const dates: string[] = []; let after = Date.now()
        for (let i = 0; i < 3; i++) {
          const next = nextOccurrence(spec.rule, after)
          if (next === null) break
          dates.push(new Date(next).toISOString()); after = next
        }
        return { spec, dates }
      }
      result = store.create(spec, Date.now())
    } else if (body.action === 'update') {
      result = store.update(id, Number(body.revision), defaults(body.spec, agent), Date.now())
      for (const run of store.byStatus('queued').filter(row => row.automationId === id)) await engine.cancel(run.id)
    }
    else if (body.action === 'pause' || body.action === 'resume') {
      if (body.action === 'pause') for (const run of store.byStatus('queued').filter(row => row.automationId === id)) await engine.cancel(run.id)
      result = store.enable(id, body.action === 'resume')
    }
    else if (body.action === 'duplicate') result = store.create({ ...store.get(id), name: `${store.get(id).name} (copy)` }, Date.now())
    else if (body.action === 'delete') {
      for (const run of store.byStatus('queued').filter(row => row.automationId === id)) await engine.cancel(run.id)
      store.remove(id); result = { deleted: true }
    } else if (body.action === 'run') result = store.runNow(id, Date.now())
    else if (body.action === 'cancel') { await engine.cancel(id as AutomationRunId); result = { cancelled: true } }
    else throw new Error('Unknown automation operation.')
    engine.wake()
    await desktopRequest({ method: 'automation-state', enabled: engine.running || store.byStatus('queued').length > 0 || store.list().some(row => row.enabled && row.nextAt !== null) }).catch((error: unknown) => { ctx.logger.warn(String(error)) })
    return result
  }
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/strugend/automations', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const cursor = new URL(request.url).searchParams.get('before')
          if (cursor !== null && (!Number.isSafeInteger(Number(cursor)) || Number(cursor) < 1)) throw new Error('Invalid history cursor.')
          return Response.json(snapshot(cursor === null ? undefined : Number(cursor)))
        }
        const result = await mutate(await request.json())
        return Response.json({ result, ...snapshot() })
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Automation operation failed.' }, { status: 400 }) }
    },
  }))
  const output = { schema: { type: 'object' as const, additionalProperties: true as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  for (const action of ['create', 'update'] as const) ctx.effect(() => ctx.tools.register(defineTool({
    name: `automation_${action}`,
    description: `${action === 'create' ? 'Save' : 'Replace'} a persistent scheduled task on this computer. Runs while Strugend is in the background and the computer is awake/logged in; catches up after resume. spec: {name,instructions,rule:{kind:"once",at:"ISO date with offset",timeZone:"Europe/Berlin"} OR {kind:"interval",minutes:60,timeZone:"Europe/Berlin"} OR {kind:"calendar",cron:"0 9 * * 1-5",timeZone:"Europe/Berlin"},workspace?:absolute path,mode?:"coding"|"job"|"normal"|"repair",submission?:"review"|"automatic",maxRunMinutes?:30,catchUpHours?:24}. Workspace and model default to this chat. Ask only for missing task criteria/time zone. Use automatic only when the user explicitly requested submitting/applying; otherwise review. Do not create duplicate schedules. Report exact time, zone, submission permission and saved ID. Multiple schedules are supported. Updates require the current revision from automation_list.`,
    parameters: { spec: { type: 'object', required: true, additionalProperties: true }, ...(action === 'update' ? { id: { type: 'string' as const, required: true }, revision: { type: 'integer' as const, required: true } } : {}) }, output,
    execute: async (args, execution) =>
      JSON.parse(JSON.stringify({ automation: await mutate({ ...args, action }, execution.agent) })) as Record<string, JsonValue>,
    presentCall: () => ({ card: 'generic', title: action === 'create' ? 'Create scheduled task' : 'Update scheduled task', kind: 'edit' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'automation_list', description: 'List saved scheduled tasks, exact IDs/revisions, next occurrences, recent runs, and items needing attention.', parameters: {}, output,
    execute: () => Promise.resolve(JSON.parse(JSON.stringify(snapshot())) as Record<string, JsonValue>), presentCall: () => ({ card: 'generic', title: 'Scheduled tasks', kind: 'read' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'automation_control', description: 'Pause/resume/duplicate/delete a saved schedule, run it now, or cancel a run. Use a schedule ID except cancel, which requires a run ID. Deleting stops future/queued occurrences and retains history; cancel an active run explicitly.',
    parameters: { id: { type: 'string', required: true }, action: { type: 'string', enum: ['pause', 'resume', 'duplicate', 'delete', 'run', 'cancel'], required: true } }, output,
    execute: async (args, execution) => JSON.parse(JSON.stringify({ result: await mutate(args, execution.agent) })) as Record<string, JsonValue>, presentCall: args => ({ card: 'generic', title: `Schedule: ${args.action}`, kind: 'edit' }),
  })))
  ctx.systemPrompt.section({ name: 'strugend:automations', order: ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'), interpolate: false,
    text: 'For requests to do work later, at a particular time, repeatedly, or to watch/check for jobs or exams, use automation_create naturally. Save a complete actionable task with selection criteria, original sources to verify, workspace, time zone and requested submission permission. Resolve explicit timing from the current date; clarify ambiguous timing. Use automation_list before modifying an existing schedule. A saved task runs independently of this conversation while this computer is awake and Strugend is running in the background. It cannot wake a powered-off computer. Report success only after the tool returns a saved ID, with the exact schedule and permission. Point to Automations for history, pause, edit, run now, or items needing attention. Never request passwords/API keys in chat; use Connections or browser takeover. The main model works without Decision support.' })
  const resume = (input: unknown): void => { if (input && typeof input === 'object' && 'type' in input && input.type === 'automation-wake') engine.wake() }
  process.on('message', resume)
  ctx.effect(() => () => { process.off('message', resume) })
  engine.wake()
  void desktopRequest({ method: 'automation-state', enabled: engine.running || store.byStatus('queued').length > 0 || store.list().some(row => row.enabled && row.nextAt !== null) }).catch((error: unknown) => { ctx.logger.warn(String(error)) })
}
