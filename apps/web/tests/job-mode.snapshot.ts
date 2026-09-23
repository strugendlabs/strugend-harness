/** Recorded Job mode draft: real file execution, logged workflow, and no submission. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  assertFinalWorkspaceSnapshot, assertFixtureInventory, fixtureUserPrompts, launchWebScaffold,
} from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/job-mode', import.meta.url))
const fixture = join(directory, 'session.v3.jsonl')

it('Job mode writes a fact-based application draft and records its workflow', async () => {
  const scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: true })
  try {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('job-mode-draft'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'job' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'job').then(() => undefined),
    })
    try {
      const prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
      expect(prompts).toHaveLength(1)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompts[0]! }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const events = handle.agent.session.snapshotEvents()
      expect(events.some(event => event.type === 'tool/call' && event.data.name === 'write')).toBe(true)
      expect(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
      await assertFinalWorkspaceSnapshot(directory, scaffold.workspaceCwd, {
        ignoredRootEntries: ['.dsh-storages', '.dsh-home', '.agents-home', '.bundled-skills'],
      })
    } finally { await handle.dispose() }
  } finally { await scaffold.close() }
  await assertFixtureInventory(directory, [
    'session.v3.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'workspace.expected',
  ])
})
