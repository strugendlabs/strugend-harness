/** Logged Laya decisions shared by model tools, automatic checkpoints, and desktop settings. */
import type {} from '@deepseek-ai/dsh-agentos-protocol/decision-events'
import type {} from './optional-components-plugin.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { qualifiedReviewIntents } from './strugend-review-qualification.ts'
import { compileReview, reviewParameters } from './strugend-review.ts'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { BackgroundAdvisor, confidentAdvice } from './strugend-advisor.ts'
import { decisionResources, localDecisionAdmission } from './strugend-resources.ts'
import { LocalDecisionRuntime } from './strugend-laya-local.ts'
import { layaManifest } from './strugend-laya-assets.ts'
import { installDelivery } from './strugend-delivery-plugin.ts'
import { serviceUrl } from './strugend-services.ts'
import { decisionEvidence, evaluateDecision, prepareDecision, type DecisionCheckRequest } from './strugend-decision.ts'

/** Live deployment settings. Legacy graph fields are retained but never used. */
export interface Config {
  enabled: boolean
  localWarmTimeoutMs: number
  localRestartCooldownMs: number
  advisorMaxInjections: number
  advisorContextBudget: number
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
  enabled: z.boolean().default(true),
  localWarmTimeoutMs: z.number().step(1).min(100).max(60_000).default(2000),
  localRestartCooldownMs: z.number().step(1).min(1000).max(300_000).default(60_000),
  advisorMaxInjections: z.number().step(1).min(1).max(8).default(3),
  advisorContextBudget: z.number().step(1).min(256).max(6000).default(1500),
  decisionMode: z.union(['local', 'auto', 'remote'] as const).default('auto'),
  adviceMode: z.union(['observe', 'assist'] as const).default('assist'),
  advisorIntervalMs: z.number().step(1).min(1000).max(60_000).default(5000),
  advisorDeadlineMs: z.number().step(1).min(100).max(60_000).default(15_000),
  advisorMaxConcurrent: z.number().step(1).min(1).max(2).default(1),
  advisorMaxAgeMs: z.number().step(1).min(100).max(60_000).default(5000),
  advisorMinConfidence: z.number().min(0.5).max(1).default(0.9),
  advisorMaxChars: z.number().step(1).min(256).max(4000).default(1000),
  localIdleMs: z.number().step(1).min(1000).max(300_000).default(45_000),
  minTotalMemoryMiB: z.number().step(1).min(8192).max(131072).default(8192),
  minFreeMemoryMiB: z.number().step(1).min(3072).max(32768).default(3072),
  criticalFreeMemoryMiB: z.number().step(1).min(512).max(8192).default(768),
  memoryPollMs: z.number().step(1).min(1000).max(30_000).default(2000),
  localModelDir: z.string().default(''),
  localThreads: z.number().step(1).min(1).max(2).default(1),
  localTimeoutMs: z.number().step(1).min(1000).max(180_000).default(15_000),
  localMaxQueued: z.number().step(1).min(1).max(2).default(2),
  remoteCooldownMs: z.number().step(1).min(1000).max(600_000).default(60_000),
  decisionUrl: z.string().default('https://api.impossibl.com/v1/systemone'),
  decisionModels: z.array(z.string()).min(1).default(['convaiinnovations/laya', 'convaiinnovations/laya-multilingual']),
  graphUrl: z.string().default(''),
  timeoutMs: z.number().step(1).min(1).max(120_000).default(2000),
  maxBytes: z.number().step(1).min(1024).max(4_194_304).default(262_144),
  maxQuestions: z.number().step(1).min(1).max(8).default(8),
  maxGraphRows: z.number().step(1).min(1).max(1000).default(50),
  automatic: z.boolean().default(true),
  maxChecksPerTurn: z.number().step(1).min(1).max(100).default(8),
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
export async function apply(ctx: Context, config: Config): Promise<void> {
  let current = (): Config => config
  let remoteRetryAfter = 0
  let remoteConfigured = false
  let refreshCapabilities = (): void => {}
  const localDirectory = (): string => {
    const installed = ctx.get('strugendComponents')?.installedPath('decision')
    return installed ? join(installed, 'model') : current().localModelDir
  }
  const available = (): boolean => {
    const settings = current()
    return settings.enabled && ((settings.decisionMode !== 'local' && remoteConfigured && Date.now() >= remoteRetryAfter)
      || (settings.decisionMode !== 'remote' && !!localDirectory() && existsSync(localDirectory())
        && localDecisionAdmission(decisionResources(), settings, local.isResident).allowed))
  }
  const validate = (value: Config): void => { serviceUrl(value.decisionUrl) }
  validate(config)
  ctx.settings.installSection(ctx, name, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => { validate(current()); remoteRetryAfter = 0; refreshCapabilities() }, validate,
  })
  const local = new LocalDecisionRuntime()
  const stopping = new AbortController()
  const pending = new Set<Promise<unknown>>()
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref !== credentialRef('IMPOSSIBL_API_KEY')) return
    const task = ctx.credentials.describe(ref).then((info) => {
      remoteConfigured = info.configured
      remoteRetryAfter = 0; refreshCapabilities()
    }, () => { remoteConfigured = false; refreshCapabilities() }).finally(() => { pending.delete(task) })
    pending.add(task)
  })
  ctx.effect(() => async () => {
    stopping.abort(new Error('Decision service is closing.'))
    await advisor.dispose(); await local.dispose(); await Promise.allSettled(pending)
  })
  const checks = new WeakMap<Session, {
    turn: number
    count: number
    injected: number
    contextChars: number
    cache: Map<string, Record<string, JsonValue>>
  }>()
  const evidence = new WeakMap<Session, { goal: string; signal: AbortSignal; failures: number; observations: string[] }>()
  const check = (input: DecisionCheckRequest, owner: Session | undefined, signal: AbortSignal): Promise<Record<string, JsonValue>> => {
    const task = (async () => {
      const combined = AbortSignal.any([signal, stopping.signal])
      combined.throwIfAborted()
      const settings = current()
      if (!available()) return { available: false, status: 'unavailable', reason: 'Decision support is disabled or unavailable. Continue with the main agent and direct verification.' }
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
            if (!admission.allowed) { await local.unload(); throw new Error(admission.reason) }
            value = await local.evaluate(payload, {
              directory: localDirectory(), threads: settings.localThreads,
              runtimeDirectory: ctx.get('strugendComponents')?.installedPath('decision'),
              warmTimeoutMs: settings.localWarmTimeoutMs, pressurePollMs: settings.memoryPollMs,
              restartCooldownMs: settings.localRestartCooldownMs,
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
          if (!confidentAdvice(result, settings.advisorMinConfidence)) result.status = 'inconclusive'
          const revision = runtime === 'local' ? layaManifest.revision : ''
          result.observedOnly = !qualifiedReviewIntents(typeof value.model === 'string' ? value.model : '', revision).some(intent => intent === input.checkpoint)
        } catch (error) {
          result = { available: false, status: combined.aborted ? 'cancelled' : 'unavailable', runtime,
            reason: decisionEvidence(error instanceof Error ? error.message : 'Decision connection failed.') }
          if (requestedRemote && !combined.aborted) remoteRetryAfter = Date.now() + settings.remoteCooldownMs
          refreshCapabilities()
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
        if (result.available !== true && localDirectory() && localDecisionAdmission(decisionResources(), settings, local.isResident).allowed) result = { ...await attempt('local'), fallbackReason: result.reason ?? 'Remote Decision unavailable.' }
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
      maxConcurrent: settings.advisorMaxConcurrent, maxAgeMs: settings.advisorMaxAgeMs,
      minConfidence: settings.advisorMinConfidence }
  }
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (local.isResident && (!current().enabled || !localDecisionAdmission(decisionResources(), current(), true).allowed)) {
        void local.unload()
      }
      refreshCapabilities()
    }, config.memoryPollMs)
    timer.unref()
    return () => { clearInterval(timer) }
  })
  installDelivery(ctx, (input, owner, signal) => {
    if (owner && current().automatic && available()) advisor.submit(owner, compileReview({ intent: 'review_evidence', goal: 'Deliver the requested working artifact.', evidence: input.state }), signal, advisorOptions())
    return Promise.resolve({ available: false, status: 'background', reason: 'Delivery uses actual build and verification results; Decision never delays delivery.' })
  })
  const tool = defineTool({
    name: 'decision_check',
    description: 'Optional independent review of supplied evidence: rank two to four candidates, suggest a missing verification, or investigate a failure. The harness handles the review format. Do not retry formatting guesses; continue with direct observations if a review is unavailable or inconclusive. Suggestions never establish success or authorize actions.',
    parameters: reviewParameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, execution) => check(compileReview(args), execution.agent?.session, execution.signal),
    presentCall: () => ({ card: 'generic', title: 'Review decision evidence', kind: 'read' }),
  })
  let disposeCapability: (() => void) | undefined
  refreshCapabilities = (): void => {
    if (stopping.signal.aborted) return
    if (!available()) { disposeCapability?.(); disposeCapability = undefined; return }
    if (disposeCapability) return
    const removeTool = ctx.tools.register(tool)
    const removePrompt = ctx.systemPrompt.section({ name: 'strugend:intelligence', order: ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'), interpolate: false,
      text: 'Optional Decision reviews can compare supplied alternatives or suggest focused verification and recovery. Background reviews arrive without delaying your work. Treat them as suggestions grounded only in the quoted evidence. Verify suggestions with tools; never treat a model judgment as proof of completion or permission. Use decision_check only for a concrete uncertainty with short evidence; never construct provider question objects or keep retrying an inconclusive review.' })
    disposeCapability = () => { removeTool(); removePrompt() }
  }
  ctx.effect(() => () => { disposeCapability?.(); disposeCapability = undefined })
  ctx.inject(['strugendComponents'], (componentCtx) => {
    componentCtx.effect(() => componentCtx.strugendComponents.onBeforeRemove(async (id) => {
      if (id === 'decision') await local.unload()
    }))
    componentCtx.effect(() => componentCtx.strugendComponents.onChange((id) => {
      if (id !== 'decision') return
      refreshCapabilities()
      if (!componentCtx.strugendComponents.installedPath('decision')) void local.unload()
    }))
    refreshCapabilities()
  })
  remoteConfigured = (await ctx.credentials.describe(credentialRef('IMPOSSIBL_API_KEY'))).configured
  refreshCapabilities()
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
        installed: !!localDirectory() && existsSync(localDirectory()), enabled: settings.enabled, available: available(),
        resident: local.isResident, mode: settings.decisionMode, adviceMode: settings.adviceMode,
        qualifiedIntents: qualifiedReviewIntents(layaManifest.model, layaManifest.revision) }))
    },
  }))
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if (!current().automatic || !available()) { advisor.cancel(agent.session); return decision }
    const text = decision.messages.filter(message => message.source.kind !== 'plugin')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
    let budget = checks.get(agent.session)
    if (budget === undefined || budget.turn !== turn) {
      budget = { turn, count: 0, injected: 0, contextChars: 0, cache: new Map() }
      checks.set(agent.session, budget)
      evidence.delete(agent.session); advisor.reset(agent.session)
    }
    if (text.trim()) {
      const previous = evidence.get(agent.session)
      const goal = decisionEvidence([previous?.goal, text].filter(Boolean).join('\n'), 1200)
      evidence.set(agent.session, { goal, signal, failures: 0, observations: previous?.observations ?? [] })
      advisor.reset(agent.session)
    }
    const ready = advisor.take(agent.session, current().advisorMaxAgeMs)
    if (current().adviceMode !== 'assist' || !ready || budget.injected >= current().advisorMaxInjections) return decision
    const revision = ready.result.runtime === 'local' ? layaManifest.revision : ''
    const model = typeof ready.result.model === 'string' ? ready.result.model : ''
    if (!qualifiedReviewIntents(model, revision).some(intent => intent === ready.checkpoint)) return decision
    const answers = ready.result.answers
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return decision
    const review = answers.review
    if (!review || typeof review !== 'object' || Array.isArray(review) || typeof review.choice !== 'string') return decision
    const question = ready.input.questions.review
    if (!question || typeof question !== 'object' || Array.isArray(question)) return decision
    const criteria = question.criteria
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return decision
    const recommendation = criteria[review.choice]
    if (typeof recommendation !== 'string') return decision
    const remaining = current().advisorContextBudget - budget.contextChars
    const body = `Decision review suggests: ${recommendation}\nThis is advisory. Inspect the evidence and choose whether the suggestion helps; actual checks determine success.`
    if (body.length > remaining || body.length > current().advisorMaxChars) return decision
    budget.injected++; budget.contextChars += body.length
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'plugin', plugin: name, form: 'notice', summary: boundContextSummary('Decision review: ' + recommendation) },
      content: [{ type: 'text', text: body }],
    })] }
  })
  ctx.on('tools/post-execute', async (execution, result, next) => {
    const downstream = await next()
    const agent = execution.agent
    if (!agent || !current().automatic || !available() || execution.name === 'decision_check') return downstream
    const state = evidence.get(agent.session)
    if (!state) return downstream
    const definition = agent.ctx.tools.get(execution.name)
    let mutating = false
    try {
      const view = definition?.presentCall?.(execution.arguments)
      mutating = view?.card === 'diff' || view?.card === 'terminal'
        || (view?.card === 'generic' && (view.kind === 'edit' || view.kind === 'execute'))
    } catch (_error) { /* Presentation is optional; failures cannot interrupt tool execution. */ }
    state.observations.push(decisionEvidence(JSON.stringify({
      tool: execution.name, result: result.content, failed: result.isError,
    }), 500))
    state.observations = state.observations.slice(-3)
    state.failures = result.isError ? state.failures + 1 : 0
    // Even a read may settle a previous suggestion; only meaningful new checkpoints start inference.
    advisor.invalidate(agent.session)
    if (!(result.isError ? state.failures >= 2 : mutating)) return downstream
    advisor.submit(agent.session, compileReview({
      intent: result.isError ? 'suggest_recovery' : 'review_evidence',
      goal: state.goal, evidence: state.observations.join('\n'),
    }), state.signal, advisorOptions())
    return downstream
  })
  ctx.on('agent/turn-stopping', ({ agent }) => { advisor.cancel(agent.session); evidence.delete(agent.session) })
  ctx.on('agent/disposed', ({ agent }) => { advisor.cancel(agent.session); evidence.delete(agent.session) })
}
