/** Desktop delivery tools, task-owned jobs, and secure provider connection checks. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DeliveryCoordinator, deliverySpec, deliveryCommand } from './strugend-delivery.ts'
import { deliveryHttp } from './strugend-delivery-http.ts'
import { serviceUrl } from './strugend-services.ts'
import { decisionEvidence, type DecisionCheckRequest } from './strugend-decision.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { delivery: 'delivery' }
}

/** Deployment-varying execution limits, editable through the settings service. */
export const DeliveryConfig = z.object({
  githubUrl: z.string().default('https://api.github.com'),
  vercelUrl: z.string().default('https://api.vercel.com'),
  timeoutMs: z.number().step(1).min(100).max(120_000).default(30_000),
  maxBytes: z.number().step(1).min(1024).max(16_777_216).default(2_097_152),
  maxFiles: z.number().step(1).min(1).max(50_000).default(5000),
  maxFileBytes: z.number().step(1).min(1024).max(104_857_600).default(20_971_520),
  maxTotalBytes: z.number().step(1).min(1024).max(524_288_000).default(104_857_600),
  deploymentTimeoutMs: z.number().step(1).min(1000).max(3_600_000).default(900_000),
  pollMs: z.number().step(1).min(100).max(60_000).default(3000),
  buildTimeoutMs: z.number().step(1).min(1000).max(3_600_000).default(900_000),
})

/**
 * Attach delivery to the logged Decision service and existing job/shell lifecycle.
 * @param ctx - Desktop plugin owner with tools, jobs, credentials, settings and connection services.
 * @param check - Logged auxiliary decision function; unavailable decisions do not conceal build failures.
 */
export function installDelivery(
  ctx: Context,
  check: (input: DecisionCheckRequest, owner: Session | undefined, signal: AbortSignal) => Promise<Record<string, JsonValue>>,
): void {
  const defaults = DeliveryConfig({})
  let current = () => defaults
  const validate = (value: typeof defaults): void => {
    for (const address of [value.githubUrl, value.vercelUrl]) if (serviceUrl(address).pathname !== '/') throw new Error('Delivery API addresses must be origins.')
  }
  ctx.settings.installSection(ctx, 'strugend-delivery', DeliveryConfig, defaults, {
    setSource: (source) => { current = source }, onChange: () =>{  validate(current()) }, validate,
  })
  const stopping = new AbortController()
  const coordinators = new Map<Agent, { coordinator: DeliveryCoordinator; job?: JobId }>()
  const credential = async (provider: 'github' | 'vercel'): Promise<string | undefined> =>
    (await ctx.credentials.resolve(credentialRef(provider === 'github' ? 'STRUGEND_GITHUB_TOKEN' : 'STRUGEND_VERCEL_TOKEN')))?.value
  ctx.effect(() => async () => {
    stopping.abort(new Error('Delivery service is closing.'))
    await Promise.allSettled([...coordinators.values()].map(item => item.coordinator.dispose()))
    coordinators.clear()
  })
  const owner = (agent: Agent) => {
    let item = coordinators.get(agent)
    if (item) return item
    const workspace = agent.session.header.cwd
    if (!workspace) throw new Error('Choose a workspace before delivery.')
    const settings = current()
    const shell = agent.ctx.get('shell')
    if (!shell) throw new Error('This task does not have a build executor.')
    const coordinator = new DeliveryCoordinator({
      root: join(resolveDshHome(), 'strugend-delivery', agent.session.id), workspace,
      ...settings, http: settings,
      run: async (command, cwd, signal) => {
        const result = await shell.run(shell.resolve({ command, workdir: cwd, signal, timeoutMs: settings.buildTimeoutMs,
          sandboxPolicy: agent.ctx.get('sandboxPolicy')?.resolve({ session: agent.session }),
        }))
        const output = decisionEvidence(result.stdout.text + '\n' + result.stderr.text, 4000)
        if (result.exitCode !== 0 || result.signal || result.timedOut || result.aborted)
          throw new Error(`Build/check failed (${result.timedOut ? 'timeout' : result.aborted ? 'cancelled' : result.signal ?? result.exitCode}). ${output}`)
        return `Command: ${command}\nExit code: 0\n${output}`
      },
      key: credential,
      push: async (url, commit, key, cwd, signal) => {
        const hooks = join(resolveDshHome(), 'strugend-delivery', agent.session.id, 'no-hooks')
        await mkdir(hooks, { recursive: true })
        await deliveryCommand('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'credential.helper=', '-c', 'http.followRedirects=false', 'push', url, `${commit}:refs/heads/main`], cwd, signal, {
          GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from(`x-access-token:${key}`).toString('base64'), GIT_TERMINAL_PROMPT: '0',
        })
      },
      decision: async (state, signal) => {
        await check({ checkpoint: 'delivery', state: decisionEvidence(state, 2200), questions: {
          ready: { type: 'noul', instructions: 'Does this evidence report successful build and verification commands?' },
        } }, agent.session, signal)
      },
      changed: () => { /* The task-owned job publishes the final durable receipt through its completion notice. */ },
    })
    item = { coordinator }; coordinators.set(agent, item)
    agent.ctx.effect(() => async () => { await coordinator.dispose(); coordinators.delete(agent) })
    return item
  }
  for (const provider of ['github', 'vercel'] as const) ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/strugend/connections/' + provider, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const key = await credential(provider)
      if (!key) return Response.json({ available: false, reason: `Connect ${provider === 'github' ? 'GitHub' : 'Vercel'} in Intelligence settings.` })
      try {
        const settings = current()
        const result = await deliveryHttp(provider === 'github' ? settings.githubUrl : settings.vercelUrl,
          provider === 'github' ? '/user' : '/v2/user', key, 'GET', undefined, settings, AbortSignal.any([request.signal, stopping.signal]))
        const account = provider === 'github' ? result.login : result.user
        if (!account) throw new Error('The provider did not return an account.')
        return Response.json({ available: true })
      } catch (error) { return Response.json({ available: false, reason: decisionEvidence(error instanceof Error ? error.message : 'Connection failed.') }) }
    },
  }))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'deliver_project',
    description: 'Build and verify an app or publish a new website end to end. Websites require a clean committed Git repository, create a private GitHub repository, push the verified commit and deploy those exact files to Vercel production. Apps run a platform-appropriate build and verify the specified distributable files. Start returns a background job; use status or job_output and continue until the receipt completes. Resume reuses persisted provider IDs after missing credentials, failures or restart. No credentials in arguments: ask the user to connect GitHub/Vercel in Settings → Intelligence. Scope external publication to the user’s request. Existing repositories are not adopted by guessing.',
    parameters: {
      action: { type: 'string', enum: ['start', 'status', 'resume', 'cancel'], required: true, description: 'Start with a recipe, inspect progress, resume the saved recipe, or cancel active work.' },
      recipe: { type: 'object', additionalProperties: true, description: 'For start: kind app|website, directory, buildCommand, checks (one or more actual verification commands), repositoryName, artifacts (app distributable paths; [] for website), production boolean. Optional githubOwner, vercelTeam, framework, outputDirectory. Detect project/build tools and requested target from workspace; desktop defaults to current OS. Use production:true for requested new websites unless user chose preview. Commands use the current OS shell.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => {
      const agent = execution.agent
      if (!agent) throw new Error('Delivery requires an active task.')
      const item = owner(agent)
      if (args.action === 'status') return { run: JSON.parse(JSON.stringify(await item.coordinator.read() ?? null)) as JsonValue, jobId: item.job ?? null }
      if (args.action === 'cancel') { item.coordinator.cancel(); return { status: 'cancelling', run: JSON.parse(JSON.stringify(await item.coordinator.read() ?? null)) as JsonValue } }
      if (agent.ctx.get('sandboxPolicy')?.resolve({ session: agent.session }).mode === 'read-only') throw new Error('Delivery requires workspace write access. Change this task’s access setting before building.')
      const jobs = agent.ctx.get('jobs')
      if (!jobs) throw new Error('This task does not have a job registry.')
      if (item.job && jobs.list(agent).some(job => job.id === item.job && ['running', 'stopping'].includes(job.status))) return { jobId: item.job, status: 'running' }
      const spec = args.action === 'start' ? deliverySpec(args.recipe) : args.recipe ? deliverySpec(args.recipe) : undefined
      item.job = jobs.start({ kind: 'delivery', label: 'Build and deliver project', owner: agent, outputLimitBytes: 16_384,
        run: () => ({ cancel: () =>{  item.coordinator.cancel() }, done: item.coordinator.execute(spec, stopping.signal).then(run => ({
          status: run.phase === 'complete' ? 'completed' as const : run.phase === 'cancelled' ? 'killed' as const : 'failed' as const,
          detail: run.phase, output: JSON.stringify(run),
        }), (error: unknown) => ({ status: 'failed' as const, output: decisionEvidence(error instanceof Error ? error.message : 'Delivery failed.') })) }),
      })
      return { jobId: item.job, status: 'running', instruction: 'Keep working, then inspect the delivery receipt. A job ID alone does not mean the project shipped.' }
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'status' ? 'Project delivery status' : 'Build and deliver project', kind: args.action === 'status' ? 'read' : 'execute' }),
  })))
  ctx.systemPrompt.section({ name: 'strugend:delivery', order: ctx.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'), interpolate: false,
    text: 'When asked to create a website, implement and test it in the visible sidebar, commit task-owned source files, then use deliver_project to create a private GitHub repository and a live Vercel production deployment unless the user asks to keep it local or specifies a different destination. Detect the actual framework and build/check commands. For an application, use deliver_project with kind app to build the requested target (desktop defaults to the current OS) and verify its real distributables. A plan, dev server or source code alone is not a shipped app. Do not initialize or publish a containing repository by accident; use a dedicated project root. If credentials are unavailable, finish local verification and direct the user to Settings → Intelligence to connect GitHub/Vercel, then resume the saved delivery. Never request tokens in chat or pass them into model-written commands. Observe final job output; failures need repair. Open the deployed URL in desktop_browser and inspect it before claiming completion. Report app paths with hashes, or repository and verified live URLs. Existing projects and external side effects follow the user’s stated scope; do not publish when they requested a local change only.' })
}
