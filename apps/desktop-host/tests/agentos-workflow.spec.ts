/** The desktop workflow must reach the model through the logged prompt registry. */
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { expect, it } from 'vitest'
import * as workflow from '../src/agentos-workflow.ts'

it('assembles the visible-browser workflow and removes it when the plugin unloads', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    const before = renderPrompt(await ctx.systemPrompt.assemble())
    const plugin = ctx.plugin(workflow)
    await plugin.await()
    await expect(renderPrompt(await ctx.systemPrompt.assemble()) + '\n')
      .toMatchFileSnapshot('./expected/agentos-workflow.txt')
    await plugin.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(before)
  } finally {
    await ctx.fiber.dispose()
  }
})
