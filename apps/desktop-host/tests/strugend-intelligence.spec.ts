/** Real plugin registration, unavailable-service behavior, and graph query encoding. */
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import * as intelligence from '../src/strugend-intelligence.ts'

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
  readRecord(): never { throw new Error('Record API is outside this fixture.') }
  describeRecord(): never { throw new Error('Record API is outside this fixture.') }
  listRecords(): never { throw new Error('Record API is outside this fixture.') }
  modifyRecord(): never { throw new Error('Record API is outside this fixture.') }
  deleteRecord(): never { throw new Error('Record API is outside this fixture.') }
}

it('logs unavailable optional services and removes its tools and prompt on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    const before = renderPrompt(await ctx.systemPrompt.assemble())
    const fiber = ctx.plugin(intelligence, intelligence.Config({} as intelligence.Config))
    await fiber.await()
    const run = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
      name, arguments: args, callId: ToolCallId('fixture'), signal: new AbortController().signal,
    })
    const decision = await run('decision_check', { model: 'jev-latest', state: 'A task', questions: { relevant: { type: 'noul', instructions: 'Does the evidence support the task?' } } })
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

it('preserves exact graph IDs, timestamps and cursors and rejects invalid reads before fetching', async () => {
  const ctx = new Context()
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ edges: [], next_cursor: 'next' })))
  vi.stubGlobal('fetch', fetcher)
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FixtureSettings)
    await ctx.plugin(FixtureCredentials)
    await ctx.credentials.set(credentialRef('CHRONOGRAPH_TOKEN'), 'synthetic-token')
    await ctx.plugin(intelligence, intelligence.Config({ graphUrl: 'https://memory.example.com' } as intelligence.Config))
    const run = (args: Record<string, unknown>) => ctx.tools.execute({
      name: 'memory_graph', arguments: args, callId: ToolCallId('fixture'), signal: new AbortController().signal,
    })
    const result = await run({ action: 'neighbors', node: '18446744073709551615', timestamp: '-9223372036854775808', limit: 3, cursor: 'opaque' })
    expect(result.isError).not.toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]!
    expect(url).toEqual(new URL('https://memory.example.com/v1/neighbors'))
    if (typeof options?.body !== 'string') throw new Error('Expected a JSON request body')
    expect(JSON.parse(options.body)).toEqual({ node: '18446744073709551615', t: '-9223372036854775808', limit: 3, cursor: 'opaque' })
    for (const args of [
      { action: 'neighbors', node: '18446744073709551616', timestamp: '0' },
      { action: 'as_of', timestamp: '9223372036854775808' },
      { action: 'as_of', timestamp: '1.5' },
      { action: 'as_of' },
      { action: 'history', limit: 51 },
      { action: 'history', limit: 0 },
      { action: 'insert', node: '1' },
    ]) expect((await run(args)).isError).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals() }
})
