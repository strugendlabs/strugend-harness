/** Desktop model mutations refresh personal panels without reopening the application. */
import { expect, it, vi } from 'vitest'
import type { AgentOsEvent } from '@deepseek-ai/dsh-agentos-protocol'
import { createAgentOsController } from '../src/client/agentos-controller.ts'
it('refreshes memory and skill inventory after agent mutations and presents a secure login request', async () => {
  let receive: (event: AgentOsEvent) => void = () => {}
  let memory = { text: 'initial', revision: '1', path: '/soul.md' }
  const dispose = vi.fn()
  const controller = createAgentOsController({
    subscribe: (callback) => { receive = callback; return dispose },
    request: async command => command.type === 'memory.read' ? memory : command.type === 'organization.read' ? { revision: 0, groups: [], assignments: {}, pinned: [] } : [],
  }, () => {})
  try {
    await vi.waitFor(() => { expect(controller.hooks.agentOs.getSnapshot().ready).toBe(true) })
    memory = { ...memory, text: 'Saved by agent', revision: '2' }
    receive({ type: 'personal.changed' })
    await vi.waitFor(() => { expect(controller.hooks.agentOs.getSnapshot().memory).toEqual(memory) })
    receive({ type: 'vault.open', origin: 'https://example.test', sessionId: 'chat' })
    expect(controller.hooks.agentOs.getSnapshot().vaultRequest).toEqual({ origin: 'https://example.test', sessionId: 'chat', sequence: 1 })
    controller.acknowledgeVaultRequest(0)
    expect(controller.hooks.agentOs.getSnapshot().vaultRequest).toBeDefined()
    controller.acknowledgeVaultRequest(1)
    expect(controller.hooks.agentOs.getSnapshot().vaultRequest).toBeUndefined()
  } finally { controller.dispose() }
  expect(dispose).toHaveBeenCalledOnce()
})
