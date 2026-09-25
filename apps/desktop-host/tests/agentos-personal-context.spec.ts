/** Real agent requests consume logged personal context and persist memory through the desktop tool. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import * as bridge from '../src/agentos-bridge.ts'
import * as personal from '../src/agentos-personal-context.ts'
import * as tools from '../src/agentos-tools.ts'

class Primary extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly remember: boolean) { super() }
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.remember && this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('remember'), name: 'update_soul', arguments: JSON.stringify({ revision: 'first', text: 'Use concise English.' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Task completed.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it.each([false, true])('includes current memory once per turn and logs successful writes; unavailable desktop = %s', async (unavailable) => {
  let memory = { text: '# Memory', revision: 'first' }
  const request = vi.spyOn(bridge, 'desktopRequest').mockImplementation(async (input) => {
    const value = input as { method: string; revision?: string; text?: string }
    if (unavailable) throw new Error('Disconnected fixture')
    if (value.method === 'personal-context') return { memory: { ...memory, truncated: false }, savedLogins: 1, recordings: 2, savedSkills: 1 }
    if (value.method === 'memory-write') { expect(value.revision).toBe(memory.revision); memory = { text: value.text!, revision: 'second' }; return memory }
    throw new Error('Unexpected desktop operation')
  })
  const ctx = new Context(), events: SessionEvent[] = []
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.provide('attachments', {})
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'synthetic' }) })
    await ctx.plugin(personal, personal.Config({ memoryChars: 4000, deadlineMs: 1500 }))
    await ctx.plugin(tools)
    const primary = new Primary(!unavailable)
    ctx.effect(() => ctx.llm.registerAdapter(['fixture'], primary))
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('personal-fixture'), { provider: 'fixture', model: 'synthetic' })
    ctx.on('session/event', (_session, event) => { events.push(event) })
    const run = async (text: string) => {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await agent.whenIdle()
    }
    await run('Remember that I prefer concise English.')
    await run('Draft a message using my preferences.')
    expect(request.mock.calls.filter(([input]) => (input as { method: string }).method === 'personal-context')).toHaveLength(2)
    const contexts = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === personal.name)
    expect(contexts).toHaveLength(2)
    expect(JSON.stringify(primary.requests.at(-1))).toContain(unavailable ? 'temporarily unavailable' : 'Use concise English.')
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(unavailable ? 0 : 1)
    if (!unavailable) await expect(JSON.stringify(contexts.map(event => event.type === 'user/message' ? event.data.content : []), null, 2) + '\n').toMatchFileSnapshot('./expected/personal-context.json')
  } finally { await ctx.fiber.dispose(); request.mockRestore() }
})
