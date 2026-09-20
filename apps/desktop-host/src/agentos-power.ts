/** User-owned Full access switching through Harness's durable permission service. */
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'

/** Plugin identity. */
export const name = 'agent-os-power'
/** Command and permission registries own registration and persisted session changes. */
export const inject = ['commands', 'permissionPresets']

/**
 * Register an explicit current-chat access command, including a reversible off switch.
 * @param ctx - Desktop Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('agent-os-power'),
    name: 'power',
    description: 'Enable Full access for this chat, disable it, or inspect current access',
    input: { hint: '[on|off|status]' },
    handler: ({ agent, rawInput, signal }) => {
      const action = rawInput.trim() || 'on'
      if (!['on', 'off', 'status'].includes(action))
        return { kind: 'error', text: 'Use /power, /power off, or /power status.' }
      signal.throwIfAborted()
      if (action === 'status')
        return { kind: 'success', text: `Current access: ${ctx.permissionPresets.current(agent.session)}.` }
      ctx.permissionPresets.set(agent.session, action === 'on' ? 'danger-full-access' : 'workspace-write')
      return {
        kind: 'success',
        text: action === 'on'
          ? 'Full access enabled for this chat. File and shell operations can use all paths available to the app without sandbox approval prompts. Use /power off to return to workspace access.'
          : 'Workspace access restored for this chat. Wider file and shell access requires approval.',
      }
    },
  })
}
