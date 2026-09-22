/** Logged Laya decisions shared by model tools, automatic checkpoints, and desktop settings. */
import type {} from '@deepseek-ai/dsh-agentos-protocol/decision-events'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { BackgroundAdvisor } from './strugend-advisor.ts'
import { decisionResources, localDecisionAdmission } from './strugend-resources.ts'
import { LocalDecisionRuntime } from './strugend-laya-local.ts'
import { layaManifest } from './strugend-laya-assets.ts'
import { installDelivery } from './strugend-delivery-plugin.ts'
import { serviceUrl } from './strugend-services.ts'
import { decisionEvidence, evaluateDecision, prepareDecision, type DecisionCheckRequest } from './strugend-decision.ts'

/** Live deployment settings. Legacy graph fields are retained but never used. */
export interface Config {
  decisionMode: 'local' | 'auto' | 'remote'
  adviceMode: 'observe' | 'assist'
  advisorIntervalMs: number
  advisorDeadlineMs: number
  advisorMaxConcurrent: number
  advisorMaxAgeMs: number
  advisorMinConfidence: number
  advisorMaxChars: number
  localIdleMs: number
  minTotalMemoryMiB: number
  minFreeMemoryMiB: number
  criticalFreeMemoryMiB: number
  memoryPollMs: number
  localModelDir: string
  localThreads: number
  localTimeoutMs: number
  localMaxQueued: number
  remoteCooldownMs: number
  decisionUrl: string
  decisionModels: string[]
  graphUrl: string
  timeoutMs: number
  maxBytes: number
  maxQuestions: number
  maxGraphRows: number
  automatic: boolean
  maxChecksPerTurn: number
}

/** Validated provider limits and automatic-check budget. */
export const Config: z<Config> = z.object({
  decisionMode: z.union(['local', 'auto', 'remote'] as const).default('auto'),
  adviceMode: z.union(['observe', 'assist'] as const).default('observe'),
  advisorIntervalMs: z.number().step(1).min(1000).max(60_000).default(5000),
  advisorDeadlineMs: z.number().step(1).min(100).max(60_000).default(15_000),
  advisorMaxConcurrent: z.number().step(1).min(1).max(2).default(1),
  advisorMaxAgeMs: z.number().step(1).min(100).max(60_000).default(5000),
  advisorMinConfidence: z.number().min(0.5).max(1).default(0.85),
  advisorMaxChars: z.number().step(1).min(256).max(4000).default(1000),
  localIdleMs: z.number().step(1).min(1000).max(300_000).default(45_000),
  minTotalMemoryMiB: z.number().step(1).min(8192).max(131072).default(8192),
  minFreeMemoryMiB: z.number().step(1).min(1536).max(32768).default(3072),
  criticalFreeMemoryMiB: z.number().step(1).min(512).max(8192).default(768),
  memoryPollMs: z.number().step(1).min(1000).max(30_000).default(2000),
  localModelDir: z.string().default(''),
  localThreads: z.number().step(1).min(1).max(2).default(1),
  localTimeoutMs: z.number().step(1).min(1000).max(180_000).default(60_000),
  localMaxQueued: z.number().step(1).min(1).max(4).default(2),
  remoteCooldownMs: z.number().step(1).min(1000).max(600_000).default(60_000),
  decisionUrl: z.string().default('https://api.impossibl.com/v1/systemone'),
  decisionModels: z.array(z.string()).min(1).default(['convaiinnovations/laya', 'convaiinnovations/laya-multilingual']),
  graphUrl: z.string().default(''),
  timeoutMs: z.number().step(1).min(1).max(120_000).default(2000),
  maxBytes: z.number().step(1).min(1024).max(4_194_304).default(262_144),
  maxQuestions: z.number().step(1).min(1).max(8).default(8),
  maxGraphRows: z.number().step(1).min(1).max(1000).default(50),
  automatic: z.boolean().default(true),
  maxChecksPerTurn: z.number().step(1).min(1).max(100).default(12),
})

/** Plugin identity. */
export const name = 'strugend-intelligence'
/** Model tools, settings, credentials and authenticated desktop HTTP. */
export const inject = ['tools', 'credentials', 'settings', 'systemPrompt', 'connection']

/**
 * Install automatic decisions without changing the Core loop or restoring graph access.
 * @param ctx - Desktop Host context.
 * @param config - Initial settings, overridden through the settings service.
 */
export function apply(ctx: Context, config: Config): void {
  let current = (): Config => config
  let remoteRetryAfter = 0
  const validate = (value: Config): void => { serviceUrl(value.decisionUrl) }
  validate(config)
  ctx.settings.installSection(ctx, name, Config, config, {
    setSource: (source) => { current = source }, onChange: () => { validate(current()); remoteRetryAfter = 0 }, validate,
  })
  const local = new LocalDecisionRuntime()
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === credentialRef('IMPOSSIBL_API_KEY')) remoteRetryAfter = 0
  })
  const stopping = new AbortController()
  const pending = new Set<Promise<unknown>>()
  ctx.effect(() => async () => { stopping.abort(new Error('Decision service is closing.')); await advisor.dispose(); await local.dispose(); await Promise.allSettled(pending) })
  const checks = new WeakMap<Session, { turn: number; count: number; cache: Map<string, Record<string, JsonValue>> }>()
  const evidence = new WeakMap<Session, { goal: string; signal: AbortSignal }>()
  const check = (input: DecisionCheckRequest, owner: Session | undefined, signal: AbortSignal): Promise<Record<string, JsonValue>> => {
    const task = (async () => {
      const combined = AbortSignal.any([signal, stopping.signal])
      combined.throwIfAborted()
      const settings = current()
      const prepared = prepareDecision(input, settings)
      const payload = settings.decisionMode === 'remote' ? prepared : { ...prepared, model: layaManifest.model }
      const identity = JSON.stringify({ payload, mode: settings.decisionMode, endpoint: settings.decisionUrl })
      const budget = owner === undefined ? undefined : checks.get(owner)
      const cached = budget?.cache.get(identity)
      if (cached) return cached
      if (budget && budget.count >= settings.maxChecksPerTurn)
        return { available: false, status: 'budget', reason: 'Automatic Decision budget reached for this turn. Continue with Core and direct verification.' }
      if (budget) budget.count++
      const attempt = async (runtime: 'local' | 'remote'): Promise<Record<string, JsonValue>> => {
        const request = owner?.append('strugend/decision-request', { checkpoint: input.checkpoint, runtime, payload })
        const started = Date.now()
        let requestedRemote = false
        let result: Record<string, JsonValue>
        try {
          let value: Record<string, JsonValue>
          if (runtime === 'local') {
            const admission = localDecisionAdmission(decisionResources(), settings, local.isResident)
            if (settings.localModelDir && !admission.allowed) { await local.unload(); throw new Error(admission.reason) }
            value = await local.evaluate(payload, {
              directory: settings.localModelDir, threads: settings.localThreads,
              timeoutMs: settings.localTimeoutMs, maxQueued: settings.localMaxQueued, idleMs: settings.localIdleMs, memory: settings,
            }, combined)
          }
          else {
            const key = await ctx.credentials.resolve(credentialRef('IMPOSSIBL_API_KEY'))
            if (!key) throw new Error('Remote Decision is not connected. Add the Impossibl key in Intelligence settings or select Local.')
            requestedRemote = true
            value = await evaluateDecision(payload, key.value, settings, combined)
            remoteRetryAfter = 0
          }
          result = { available: true, status: 'checked', ...value, runtime, latencyMs: Date.now() - started }
        } catch (error) {
          result = { available: false, status: combined.aborted ? 'cancelled' : 'unavailable', runtime,
            reason: decisionEvidence(error instanceof Error ? error.message : 'Decision connection failed.') }
          if (requestedRemote && !combined.aborted) remoteRetryAfter = Date.now() + settings.remoteCooldownMs
        }
        if (owner && request) owner.append('strugend/decision-result', { checkpoint: input.checkpoint, requestSeq: request.seq, result })
        combined.throwIfAborted()
        return result
      }
      let result: Record<string, JsonValue>
      if (settings.decisionMode === 'local') result = await attempt('local')
      else if (settings.decisionMode === 'remote') result = await attempt('remote')
      else if (Date.now() < remoteRetryAfter || !(await ctx.credentials.describe(credentialRef('IMPOSSIBL_API_KEY'))).configured) result = await attempt('local')
      else {
        result = await attempt('remote')
        if (result.available !== true) result = { ...await attempt('local'), fallbackReason: result.reason ?? 'Remote Decision unavailable.' }
      }
      if (result.available === true) budget?.cache.set(identity, result)
      return result
    })()
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  const advisor = new BackgroundAdvisor<Session>(check)
  const advisorOptions = () => {
    const settings = current()
    return { intervalMs: settings.advisorIntervalMs, deadlineMs: settings.advisorDeadlineMs,
      maxConcurrent: settings.advisorMaxConcurrent, maxAgeMs: settings.advisorMaxAgeMs, minConfidence: settings.advisorMinConfidence }
  }
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (local.isResident && !localDecisionAdmission(decisionResources(), current(), true).allowed) void local.unload()
    }, config.memoryPollMs)
    timer.unref()
    return () =>{  clearInterval(timer) }
  })
  installDelivery(ctx, (input, owner, signal) => {
    if (owner && current().automatic) advisor.submit(owner, input, signal, advisorOptions())
    return Promise.resolve({ available: false, status: 'background', reason: 'Delivery uses actual build and verification results; Decision never delays delivery.' })
  })
  const context = (checkpoint: string, value: Record<string, JsonValue>) => createUserMessage({
    source: { kind: 'plugin', plugin: name },
    content: [{ type: 'text', text: `Decision check (${checkpoint}): ${decisionEvidence(JSON.stringify(value), current().advisorMaxChars)}\nAdvisory judgment only. Resolve uncertainty with observed evidence; tests and delivery receipts determine completion.` }],
  })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'decision_check',
    description: 'Use Laya for narrow independent judgments: compare up to five plans/actions/skills, score context relevance, or check supplied evidence against requirements. Core writes and executes. Send short non-secret evidence and independent questions. A judgment does not replace tests or grant permission. The service selects its model; do not supply a model ID.',
    parameters: {
      state: { type: 'string', required: true, description: 'Short relevant evidence. No credentials or unrelated personal data.' },
      questions: { type: 'object', required: true, additionalProperties: true, description: 'Named questions: {type: "choice"|"score"|"noul", instructions: string, criteria?: object|string[]}. Choice has 2–5 named options; score has ordered levels; noul asks yes/no.' },
      language: { type: 'string', description: 'BCP-47 evidence language. Remote mode pins English for en and multilingual otherwise. Local and automatic fallback use the bundled multilingual checkpoint.' },
      checkpoint: { type: 'string', description: 'Planning, action selection, recovery, verification, or delivery.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, execution) => check({ state: args.state, questions: args.questions, checkpoint: args.checkpoint ?? 'explicit', ...(args.language ? { language: args.language } : {}) }, execution.agent?.session, execution.signal),
    presentCall: () => ({ card: 'generic', title: 'Check a decision with Laya', kind: 'read' }),
  })))
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/strugend/decision/test', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => Response.json(await check({ checkpoint: 'connection', language: 'en', state: 'The build finished with exit code 0.',
      questions: { evidence: { type: 'noul', instructions: 'Does the state say the build exited with code zero?' } } }, undefined, request.signal)),
  }))
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/strugend/decision/runtime', methods: ['GET'], requestBody: 'buffered',
    fetch: () => {
      const resources = decisionResources(), settings = current()
      const admission = localDecisionAdmission(resources, settings, local.isResident)
      return Promise.resolve(Response.json({ ...resources, localAllowed: admission.allowed, reason: admission.reason ?? '',
        resident: local.isResident, mode: settings.decisionMode, adviceMode: settings.adviceMode }))
    },
  }))
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
    const decision = await next()
    if (!current().automatic || decision.kind !== 'enter') return decision
    const text = decision.messages.filter(message => message.source.kind !== 'plugin')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
    if (checks.get(agent.session)?.turn !== turn) {
      checks.set(agent.session, { turn, count: 0, cache: new Map() })
      advisor.reset(agent.session)
    }
    if (text.trim().length >= 24) {
      const goal = decisionEvidence(text)
      evidence.set(agent.session, { goal, signal }); advisor.reset(agent.session)
      advisor.submit(agent.session, { checkpoint: 'planning', state: goal, questions: {
        workflow: { type: 'choice', instructions: 'Which workflow best matches this request?', criteria: {
          website: 'Build or modify a website', app: 'Build an application', coding: 'Other software work', everyday: 'Research, writing or other work',
        } },
        missing: { type: 'noul', instructions: 'Is an essential user choice missing that prevents starting useful work?' },
      } }, signal, advisorOptions())
    }
    const ready = advisor.take(agent.session, current().advisorMaxAgeMs)
    if (current().adviceMode !== 'assist' || !ready) return decision
    return { ...decision, messages: [...decision.messages, context(ready.checkpoint, ready.result)] }
  })
  ctx.on('tools/post-execute', async (execution, result, next) => {
    const downstream = await next()
    const agent = execution.agent
    if (!agent || !current().automatic || execution.name === 'decision_check') return downstream
    const state = evidence.get(agent.session)
    if (!state) return downstream
    if (!result.isError && !/edit|write|patch|bash|pwsh|build|deliver|video|desktop_browser/iu.test(execution.name)) {
      advisor.invalidate(agent.session)
      return downstream
    }
    const observed = decisionEvidence(JSON.stringify({
      tool: execution.name, arguments: execution.arguments, result: result.content,
    }), 1600)
    advisor.submit(agent.session, { checkpoint: result.isError ? 'recovery' : 'verification',
      state: state.goal + '\nObserved result: ' + observed, questions: {
        next: { type: 'choice', instructions: 'What should Core examine next, given only this evidence?', criteria: {
          inspect: 'Inspect current state or missing evidence', test: 'Run focused checks', recover: 'Investigate and repair a failure', continue: 'Continue the planned work',
        } },
        complete: { type: 'noul', instructions: 'Does the observed evidence establish all requested work is complete?' },
      } }, state.signal, advisorOptions())
    return downstream
  })
  ctx.on('agent/turn-stopping', ({ agent }) => { advisor.cancel(agent.session) })
  ctx.on('agent/disposed', ({ agent }) => { advisor.cancel(agent.session) })
  ctx.systemPrompt.section({ name: 'strugend:intelligence', order: ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'), interpolate: false,
    text: 'Core plans, writes, codes and executes using the user-selected provider. Background Decision checks never block Core, replace its model, bypass tests, or force additional turns. Observe mode records judgments without adding them to Core context; optional Assist mode admits only completed, recent, high-confidence advice. Low-memory devices do not load local weights: Automatic can use a saved remote key, or Core continues alone. Explicit decision_check is available for small independent judgments when useful; do not call it for every action. Resolve uncertainty with observations and tests. Graph memory is Coming soon and disabled; use read_soul and workspace evidence.' })
}
