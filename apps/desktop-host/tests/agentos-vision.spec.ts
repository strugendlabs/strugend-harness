/** Auxiliary vision failures return usable evidence without retrying or hiding cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import * as bridge from '../src/agentos-bridge.ts'
import * as vision from '../src/agentos-vision.ts'
import * as browser from '../src/agentos-tools.ts'

class VisualProvider extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(readonly behavior: 'answer' | 'empty' | 'error' | 'cancel', readonly images = true) { super() }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, inputModalities: this.images ? ['text', 'image'] as const : ['text'] as const,
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('high'), name: 'High' }] } }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.behavior === 'error') throw new Error('Synthetic provider failure')
    if (this.behavior === 'cancel') {
      await new Promise<void>((_resolve, reject) => { options.signal!.addEventListener('abort', () => { reject(options.signal!.reason) }, { once: true }) })
      return
    }
    if (this.behavior === 'answer') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Compose is the labeled button e1.' } }
    }
    yield { type: 'finish', reason: { kind: this.behavior === 'empty' ? 'max-tokens' : 'stop' } }
  }
}

async function fixture(behavior: VisualProvider['behavior'], images = true) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const image = { attachmentId: AttachmentId('fixture-image'), width: 10, height: 10, bytes: 3, mediaType: 'image/png' as const }
  ctx.provide('attachments', { saveImage: async () => image })
  const adapter = new VisualProvider(behavior, images)
  ctx.effect(() => ctx.llm.registerAdapter(['visual-fixture'], adapter))
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('vision-fixture'), { provider: 'visual-fixture', model: 'primary' })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'visual-fixture', model: 'primary' }) })
  const request = vi.spyOn(bridge, 'desktopRequest').mockImplementation(async () => ({ state: { tabId: 'tab', revision: 5 }, text: 'Inbox', elements: [{ ref: 'e1', name: 'Compose', role: 'button' }], viewport: { width: 800, height: 600 }, screenshot: 'data:image/png;base64,YWJj' }))
  await ctx.plugin(vision, vision.Config({ maxTokens: 4096, timeoutMs: 1000 }))
  await ctx.plugin(browser)
  let calls = 0
  const call = (name = 'analyze_browser_vision', args: unknown = { question: 'Where is Compose?' }, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(`visual-${++calls}`) })
  return { ctx, agent, adapter, request, call, close: async () => { await ctx.fiber.dispose(); vi.restoreAllMocks() } }
}

it('logs the exact bounded low-reasoning request and returns actual visible analysis', async () => {
  const f = await fixture('answer')
  try {
    const result = await f.call()
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('Compose is the labeled button e1.')
    expect(f.adapter.requests[0]).toMatchObject({ maxTokens: 4096, reasoningEffort: 'off' })
    expect(f.agent.session.snapshotEvents().find(event => event.type === 'agent-os/vision-request')?.data).toMatchObject({ maxTokens: 4096, reasoningEffort: 'off' })
  } finally { await f.close() }
})

it.each(['empty', 'error'] as const)('returns fresh DOM and an image after %s and avoids repeat auxiliary requests', async (behavior) => {
  const f = await fixture(behavior)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await f.call()
      expect(result.isError).toBe(false)
      expect(result.content.some(block => block.type === 'image')).toBe(true)
      expect(JSON.stringify(result)).toContain('page-context')
      expect(JSON.stringify(result)).toContain('Compose')
    }
    expect(f.adapter.requests).toHaveLength(1)
    expect(f.request).toHaveBeenCalledTimes(2)
  } finally { await f.close() }
})

it('returns text controls without sending unsupported images to a text-only model', async () => {
  const f = await fixture('answer', false)
  try {
    const result = await f.call()
    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'image')).toBe(false)
    expect(f.adapter.requests).toHaveLength(0)
  } finally { await f.close() }
})

it('times out auxiliary inference and preserves user cancellation', async () => {
  const f = await fixture('cancel')
  try {
    const result = await f.call()
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('timed out')
    const abort = new AbortController(); abort.abort(new Error('User stopped'))
    const stopped = await f.call('analyze_browser_vision', { question: 'Inspect' }, abort.signal)
    expect(stopped.isError).toBe(true)
  } finally { await f.close() }
})

it('automatically attaches a fresh image after a click and honors an explicit text-only observation', async () => {
  const f = await fixture('answer')
  try {
    const result = await f.call('desktop_browser', { action: 'click', tabId: 'tab', ref: 'e1', revision: 4 })
    expect(result.isError).toBe(false)
    expect(f.request.mock.calls.map(([value]) => (value as { command: unknown }).command)).toEqual([
      { action: 'click', tabId: 'tab', ref: 'e1', revision: 4 }, { action: 'observe', tabId: 'tab', screenshot: true },
    ])
    expect(result.content.some(block => block.type === 'image')).toBe(true)
    await f.call('desktop_browser', { action: 'observe', screenshot: false })
    expect(f.request.mock.lastCall?.[0]).toMatchObject({ command: { action: 'observe', screenshot: false } })
  } finally { await f.close() }
})

it('preserves the completed action when its follow-up screenshot fails', async () => {
  const f = await fixture('answer')
  try {
    f.request.mockResolvedValueOnce({ state: { tabId: 'tab', revision: 5 }, text: 'Sent confirmation', elements: [] })
      .mockRejectedValueOnce(new Error('Capture unavailable'))
    const result = await f.call('desktop_browser', { action: 'click', tabId: 'tab', ref: 'send', revision: 4 })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('Sent confirmation')
    expect(JSON.stringify(result)).toContain('do not repeat a submission')
    expect(f.request).toHaveBeenCalledTimes(2)
  } finally { await f.close() }
})


it('returns fresh controls when screenshot capture is unavailable', async () => {
  const f = await fixture('answer')
  try {
    f.request.mockRejectedValueOnce(new Error('Capture unavailable'))
      .mockResolvedValueOnce({ state: { tabId: 'tab', revision: 6 }, text: 'Inbox', elements: [{ ref: 'e1', name: 'Compose' }] })
    const result = await f.call()
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('page-context')
    expect(JSON.stringify(result)).toContain('Compose')
    expect(result.content.some(block => block.type === 'image')).toBe(false)
    expect(f.adapter.requests).toHaveLength(0)
  } finally { await f.close() }
})


it('keeps ordinary browser observation usable when automatic image capture fails', async () => {
  const f = await fixture('answer')
  try {
    f.request.mockRejectedValueOnce(new Error('Capture deadline'))
      .mockResolvedValueOnce({ state: { tabId: 'tab', revision: 6 }, text: 'Inbox', elements: [{ ref: 'e1', name: 'Compose' }] })
    const result = await f.call('desktop_browser', { action: 'observe', tabId: 'tab' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('Compose')
    expect(JSON.stringify(result)).toContain('Screenshot unavailable')
    expect(f.request.mock.lastCall?.[0]).toMatchObject({ command: { action: 'observe', tabId: 'tab', screenshot: false } })
  } finally { await f.close() }
})
