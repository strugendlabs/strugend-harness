/** Real plugin registration, unavailable-service behavior, and graph query encoding. */
import * as connection from '@deepseek-ai/dsh-client-connection'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import * as intelligence from '../src/strugend-intelligence.ts'
import * as resources from '../src/strugend-resources.ts'
import { LocalDecisionRuntime } from '../src/strugend-laya-local.ts'

class FixtureSettings extends SettingsProvider {
  private readonly doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected async load(): Promise<Record<string, unknown>> { return this.doc }
  protected async persist(ns: SettingsNamespace, value: Record<string, unknown>): Promise<void> { this.doc[ns] = value }
}

class FixtureCredentials extends CredentialProvider {
  private readonly values = new Map<CredentialRef, string>()
  async resolve(ref: CredentialRef) {
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'fixture' }
  }
  async describe(ref: CredentialRef) { return { configured: this.values.has(ref), writable: true } }
  async set(ref: CredentialRef, value: string) { this.values.set(ref, value) }
  async unset(ref: CredentialRef) { this.values.delete(ref) }
  async readRecord() { return undefined }
  describeRecord(): never { throw new Error('Record API is outside this fixture.') }
  listRecords(): never { throw new Error('Record API is outside this fixture.') }
  async modifyRecord(
    _key: unknown, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ) { return mutate(undefined) }
  deleteRecord(): never { throw new Error('Record API is outside this fixture.') }
}

it('omits absent optional tools and prompts and restores the original prompt on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    await ctx.plugin(connection)
    const before = renderPrompt(await ctx.systemPrompt.assemble())
    const fiber = ctx.plugin(intelligence, intelligence.Config({} as intelligence.Config))
    await fiber.await()
    const run = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
      name, arguments: args, callId: ToolCallId('fixture'), signal: new AbortController().signal,
    })
    const decision = await run('decision_check', { state: 'A task', questions: { relevant: { type: 'noul', instructions: 'Does the evidence support the task?' } } })
    const memory = await run('memory_graph', { action: 'stats' })
    await expect(JSON.stringify({ decision: decision.content, memory: memory.content }, null, 2) + '\n')
      .toMatchFileSnapshot('./expected/strugend-unavailable.json')
    await expect(renderPrompt(await ctx.systemPrompt.assemble()) + '\n')
      .toMatchFileSnapshot('./expected/strugend-intelligence-prompt.txt')
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(before)
    expect((await run('memory_graph', { action: 'stats' })).isError).toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('keeps legacy graph configuration inactive and makes no graph requests', async () => {
  const ctx = new Context()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    await ctx.plugin(connection)
    await ctx.credentials.set(credentialRef('CHRONOGRAPH_TOKEN'), 'synthetic-token')
    await ctx.plugin(intelligence, intelligence.Config({ graphUrl: 'https://memory.example.com' } as intelligence.Config))
    const result = await ctx.tools.execute({ name: 'memory_graph', arguments: { action: 'stats' }, callId: ToolCallId('fixture'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})

it('refuses local model allocation on a 4 GB device even when Local mode is explicitly selected', async () => {
  const ctx = new Context()
  const evaluate = vi.spyOn(LocalDecisionRuntime.prototype, 'evaluate')
  vi.spyOn(resources, 'decisionResources').mockReturnValue({ totalMiB: 4096, freeMiB: 3500 })
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    await ctx.plugin(connection)
    await ctx.plugin(intelligence, intelligence.Config({ decisionMode: 'local', localModelDir: '/fixture/model' } as intelligence.Config))
    const result = await ctx.tools.execute({ name: 'decision_check', arguments: {
      intent: 'review_evidence', goal: 'Build a working form.', evidence: 'The build exited zero.',
    }, callId: ToolCallId('low-memory'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(ctx.tools.get('decision_check')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Optional Decision')
    expect(evaluate).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose(); vi.restoreAllMocks() }
})

it('cools down a failed remote provider and immediately retries after its credential changes', async () => {
  const ctx = new Context()
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ model: 'convaiinnovations/laya-multilingual', answers: { review: { type: 'choice', choice: 'check_behavior', confidence: 0.99, probabilities: { check_behavior: 0.99, inspect_visual_result: 0.004, inspect_deliverable: 0.003, insufficient_evidence: 0.003 } } }, usage: { input_tokens: 8, output_tokens: 0 } }))
  vi.stubGlobal('fetch', fetcher)
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    await ctx.plugin(connection)
    const ref = credentialRef('IMPOSSIBL_API_KEY')
    await ctx.credentials.set(ref, 'synthetic-first')
    await ctx.plugin(intelligence, intelligence.Config({} as intelligence.Config))
    const run = () => ctx.tools.execute({ name: 'decision_check', arguments: {
      intent: 'review_evidence', goal: 'Build a working form.', evidence: 'The build exited zero.',
    }, callId: ToolCallId('cooldown'), signal: new AbortController().signal })
    await run(); await run()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await ctx.credentials.set(ref, 'synthetic-replacement')
    await ctx.parallel('credentials/reference-updated', ref)
    const result = await run()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result.content)).toContain('checked')
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})
