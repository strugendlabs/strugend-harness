/** Desktop defaults and explicit access changes use the same durable Harness permission state. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { createScope } from '@deepseek-ai/dsh-scope'
import { expect, it } from 'vitest'
import { agentOsProfilePatch } from '../src/agentos-profile.ts'
import * as power from '../src/agentos-power.ts'

it('pins the desktop access, models, and foreground execution budgets in its profile overlay', async () => {
  await expect(JSON.stringify(agentOsProfilePatch('/desktop/credentials.js', '/workspace'), null, 2) + '\n')
    .toMatchFileSnapshot('./expected/agentos-profile.json')
  expect(agentOsProfilePatch('/desktop/credentials.js', '/workspace', 'read-only'))
    .toContainEqual({ id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: '/workspace' } })
  expect(() => agentOsProfilePatch('/desktop/credentials.js', '/workspace', 'unknown')).toThrow('DSH_PERMISSION_MODE')
})

it('switches only the requested chat, rejects invalid commands, and unregisters on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    await ctx.plugin(PermissionPresets, {})
    const plugin = ctx.plugin(power)
    await plugin.await()
    const session = ctx.sessions.create(SessionId('existing-chat'))
    const other = ctx.sessions.create(SessionId('other-chat'))
    // Commands only read the agent identity and its real durable Session.
    const agent = { id: session.id, session } as Agent
    await ctx.plugin((inner) => { createScope(inner, agent) })
    const execute = (line: string) => ctx.commands.execute(agent, line, [], new AbortController().signal)
    const results = []
    results.push((await execute('/power'))?.result)
    expect(ctx.permissionPresets.current(session)).toBe('danger-full-access')
    expect(session.snapshotEvents().filter(event => event.type === 'approval/policy').at(-1)?.data).toEqual({ policy: 'never' })
    const permissions = () => session.snapshotEvents().filter(event => event.type === 'permission/preset')
    const count = permissions().length
    results.push((await execute('/power on'))?.result)
    expect(permissions()).toHaveLength(count)
    results.push((await execute('/power invalid'))?.result)
    expect(ctx.permissionPresets.current(session)).toBe('danger-full-access')
    results.push((await execute('/power status'))?.result)
    results.push((await execute('/power off'))?.result)
    expect(ctx.permissionPresets.current(session)).toBe('workspace-write')
    expect(session.snapshotEvents().filter(event => event.type === 'approval/policy').at(-1)?.data).toEqual({ policy: 'ask' })
    expect(ctx.permissionPresets.current(other)).toBe('workspace-write')
    await expect(JSON.stringify(results, null, 2) + '\n').toMatchFileSnapshot('./expected/agentos-power.json')
    await plugin.dispose()
    expect(await execute('/power')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})
