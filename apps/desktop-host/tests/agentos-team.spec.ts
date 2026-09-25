/** Independent QA uses actual child tools and reports a failed artifact before its repair. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'
import * as team from '../src/agentos-team.ts'

class Reviewer extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length > 6) throw new Error('Reviewer fixture exceeded its expected calls')
    expect(JSON.stringify(options.messages)).toContain(team.QA_PERSONA)
    for (const name of ['edit', 'write', 'qa_agent']) expect(options.tools?.map(tool => tool.name)).not.toContain(name)
    const evidence = options.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result')
    if (evidence.length === 0) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`inspect-${this.requests.length}`), name: 'inspect_artifact', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const checked = JSON.stringify(evidence).includes('body present')
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: checked ? 'PASS: inspected draft body present. Sending remains unverified.' : 'FAIL: inspected draft body is empty. Do not send.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it('runs a separate reviewer, reads current evidence, and verifies the repair on a fresh review', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    const harness = await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(Subagents, { maxActiveSubagents: 2, maxDepth: 1 })
    await ctx.plugin(spawn, { providerName: 'spawn' })
    let repaired = false, inspections = 0
    for (const name of ['write', 'edit', 'inspect_artifact']) ctx.effect(() => ctx.tools.register(defineContentToolFixture({
      name, description: 'Inspect the controlled draft fixture.', parameters: {},
      execute: async () => { expect(name).toBe('inspect_artifact'); inspections++; return [{ type: 'text', text: repaired ? 'body present' : 'body empty' }] },
      presentCall: () => ({ card: 'generic', title: 'Inspect draft', kind: 'read' }),
    })))
    const adapter = new Reviewer()
    ctx.effect(() => ctx.llm.registerAdapter(['review-fixture'], adapter))
    await ctx.plugin(team)
    const parent = await harness.create(SessionId('team-parent'), { provider: 'review-fixture', model: 'primary' })
    const review = () => ctx.tools.execute({ agent: parent, name: 'qa_agent', callId: ToolCallId(`qa-${inspections}`), signal: new AbortController().signal,
      arguments: { description: 'Check draft before send', prompt: 'Verify that the prepared draft has a nonempty body. Inspect the artifact; do not send anything.', run_in_background: false } })
    const failed = await review()
    expect(failed.isError, JSON.stringify(failed)).toBe(false)
    expect(JSON.stringify(failed)).toContain('FAIL: inspected draft body is empty')
    repaired = true
    const passed = await review()
    expect(passed.isError).toBe(false)
    expect(JSON.stringify(passed)).toContain('PASS: inspected draft body present')
    expect(inspections).toBe(2)
    expect(new Set(adapter.requests.map(request => request.sessionId)).size).toBe(2)
    expect(adapter.requests.every(request => request.sessionId !== parent.id)).toBe(true)
  } finally { await ctx.fiber.dispose() }
})
