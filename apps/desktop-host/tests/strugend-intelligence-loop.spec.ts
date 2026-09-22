/** Production AgentLoop composition; scripted model answers qualify lifecycle behavior, not Laya quality. */
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import * as connection from '@deepseek-ai/dsh-client-connection'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CredentialProvider, credentialRef, type CredentialRef, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import * as intelligence from '../src/strugend-intelligence.ts'
import * as decision from '../src/strugend-decision.ts'
import * as qualification from '../src/strugend-review-qualification.ts'

class FixtureSettings extends SettingsProvider {
  private readonly doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected async load(): Promise<Record<string, unknown>> { return this.doc }
  protected async persist(ns: SettingsNamespace, value: Record<string, unknown>): Promise<void> { this.doc[ns] = value }
}
class FixtureCredentials extends CredentialProvider {
  private readonly values = new Map<CredentialRef, string>()
  async resolve(ref: CredentialRef) { const value = this.values.get(ref); return value === undefined ? undefined : { value, source: 'fixture' } }
  async describe(ref: CredentialRef) { return { configured: this.values.has(ref), writable: true } }
  async set(ref: CredentialRef, value: string) { this.values.set(ref, value) }
  async unset(ref: CredentialRef) { this.values.delete(ref) }
  async readRecord() { return undefined }
  describeRecord(): never { throw new Error('No credential records in this fixture.') }
  listRecords(): never { throw new Error('No credential records in this fixture.') }
  async modifyRecord(
    _key: unknown, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ) { return mutate(undefined) }
  deleteRecord(): never { throw new Error('No credential records in this fixture.') }
}
class ScriptedCore extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly responses: StreamChunk[][]) { super() }
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.responses.shift()
    if (!response) throw new Error('Scripted Core exhausted.')
    yield* response
  }
}
function call(id: string, name = 'write_fixture'): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}
const done: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'Core finished its task.' } }, { type: 'finish', reason: { kind: 'stop' } }]
const answer = { model: 'convaiinnovations/laya-multilingual', answers: {
  review: { type: 'choice', choice: 'check_behavior', confidence: .99,
    probabilities: { check_behavior: .99, inspect_visual_result: .004, inspect_deliverable: .003, insufficient_evidence: .003 } },
}, usage: { input_tokens: 10, output_tokens: 0 } }
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose(); vi.restoreAllMocks() })

async function fixture(responses: StreamChunk[][], connected = true, config: Partial<intelligence.Config> = {}) {
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(FixtureSettings); await ctx.plugin(FixtureCredentials); await ctx.plugin(connection)
  if (connected) await ctx.credentials.set(credentialRef('IMPOSSIBL_API_KEY'), 'synthetic-key')
  await ctx.plugin(intelligence, intelligence.Config({ decisionMode: 'remote', ...config } as intelligence.Config))
  const core = new ScriptedCore(responses)
  ctx.effect(() => ctx.llm.registerAdapter(['scripted-core'], core))
  ctx.effect(() => ctx.tools.register(defineContentToolFixture({ name: 'write_fixture', description: 'Write the synthetic fixture.', parameters: {},
    execute: async () => [{ type: 'text', text: 'File created. No behavior check has run.' }],
    presentCall: () => ({ card: 'generic', title: 'Write fixture', kind: 'edit' }) })))
  ctx.effect(() => ctx.tools.register(defineContentToolFixture({ name: 'fail_fixture', description: 'Return a controlled failure.', parameters: {},
    execute: async () => { throw new Error('Missing required path argument.') },
    presentCall: () => ({ card: 'generic', title: 'Read fixture', kind: 'read' }) })))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('intelligence-loop-fixture'), { provider: 'scripted-core', model: 'synthetic-primary' })
  const run = async (): Promise<void> => {
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Create working code for the requested calculation and verify it.' }] }))
    await idle
  }
  return { ctx, core, agent, run }
}

it('completes Core while the qualified synthetic review is still held, then cancels and logs optional work', async () => {
  vi.spyOn(qualification, 'qualifiedReviewIntents').mockReturnValue(['review_evidence'])
  let cancelled = false
  const evaluate = vi.spyOn(decision, 'evaluateDecision').mockImplementation(async (_input, _key, _settings, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled = true; reject(new Error('Synthetic held review cancelled.')) }, { once: true })
    }))
  const { agent, core, run } = await fixture([call('write'), done])
  await run()
  expect(core.requests).toHaveLength(2)
  expect(evaluate).toHaveBeenCalledTimes(1)
  expect(cancelled).toBe(true)
  expect(JSON.stringify(core.requests)).not.toContain('Decision review suggests:')
  expect(agent.session.snapshotEvents().some(event => event.type === 'strugend/decision-request')).toBe(true)
  await expect.poll(() => agent.session.snapshotEvents().some(event => event.type === 'strugend/decision-result')).toBe(true)
})

it.each([true, false])('only injects ready advice when the served model is synthetically qualified: %s', async (qualified) => {
  vi.spyOn(qualification, 'qualifiedReviewIntents').mockReturnValue(qualified ? ['review_evidence'] : [])
  const evaluate = vi.spyOn(decision, 'evaluateDecision').mockResolvedValue(answer)
  const { ctx, agent, core, run } = await fixture([call('write'), done])
  // An independent pre-step consumer provides a deterministic completed-review boundary; production never waits here.
  ctx.on('agent/pre-step', async ({ step }, next) => {
    if (step > 1) await setImmediate()
    return next()
  })
  await run()
  expect(evaluate).toHaveBeenCalledTimes(1)
  if (qualified) {
    expect(JSON.stringify(core.requests[1])).toContain('Decision review suggests:')
    expect(JSON.stringify(agent.session.snapshotEvents())).toContain('Decision review suggests:')
    const request = agent.session.snapshotEvents().find(event => event.type === 'strugend/decision-request')
    expect(JSON.stringify(request)).toContain('File created. No behavior check has run.')
  } else {
    expect(JSON.stringify(core.requests)).not.toContain('Decision review suggests:')
    const result = agent.session.snapshotEvents().find(event => event.type === 'strugend/decision-result')
    expect(result?.type === 'strugend/decision-result' && result.data.result.observedOnly).toBe(true)
  }
})

it.each([{ connected: false, config: {} }, { connected: true, config: { enabled: false } }])('omits disabled or absent tools, prompts and requests', async ({ connected, config }) => {
  const evaluate = vi.spyOn(decision, 'evaluateDecision')
  const { ctx, core, run } = await fixture([call('write'), done], connected, config)
  await run()
  expect(core.requests).toHaveLength(2)
  expect(evaluate).not.toHaveBeenCalled()
  expect(ctx.tools.get('decision_check')).toBeUndefined()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Optional Decision reviews')
})

it('reviews repeated tool failure without failing the main agent and records recovery evidence', async () => {
  vi.spyOn(qualification, 'qualifiedReviewIntents').mockReturnValue(['suggest_recovery'])
  const evaluate = vi.spyOn(decision, 'evaluateDecision').mockRejectedValue(new Error('Synthetic provider unavailable.'))
  const { agent, core, run } = await fixture([call('failure-1', 'fail_fixture'), call('failure-2', 'fail_fixture'), done])
  await run()
  expect(core.requests).toHaveLength(3)
  expect(evaluate).toHaveBeenCalledTimes(1)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(2)
  const request = agent.session.snapshotEvents().find(event => event.type === 'strugend/decision-request')
  expect(JSON.stringify(request)).toContain('suggest_recovery')
  expect(JSON.stringify(request)).toContain('Missing required path argument.')
  await expect.poll(() => agent.session.snapshotEvents().some(event => event.type === 'strugend/decision-result')).toBe(true)
})
