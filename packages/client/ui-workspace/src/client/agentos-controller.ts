/** Application-owned desktop state injected into the workspace view. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AgentOsDesktopApi,
  AgentOsCommand,
  OrganizationState,
  Recording,
  VaultItem,
} from '@deepseek-ai/dsh-agentos-protocol'

/** Workspace-visible organization, memory and credential metadata; secret values are excluded. */
export interface AgentOsState {
  available: boolean
  ready: boolean
  organization: OrganizationState
  memory: { text: string; revision: string; path: string }
  vault: VaultItem[]
  recordings: Recording[]
  error: string
}
/** Observable workspace state and actions provided to the desktop workspace view. */
export interface AgentOsInjected {
  hooks: { agentOs: HostObservable<AgentOsState> }
  openVideoStudio(): void
  agentOsRequest(command: AgentOsCommand): Promise<unknown>
}

/**
 * Maintain desktop workspace state until the owning view is disposed.
 * @param api - Desktop-only authenticated bridge; absent in a standalone web client.
 * @param openVideoStudio - Show the media editor in the sidebar.
 * @returns State, action callbacks and subscription cleanup.
 */
export function createAgentOsController(
  api: AgentOsDesktopApi | undefined,
  openVideoStudio: () => void,
): AgentOsInjected & { dispose(): void } {
  let snapshot: AgentOsState = {
    available: api !== undefined,
    ready: false,
    organization: { revision: 0, groups: [], assignments: {}, pinned: [] },
    memory: { text: '', revision: '', path: '' },
    vault: [],
    recordings: [],
    error: '',
  }
  const listeners = new Set<() => void>()
  let disposed = false
  const update = (patch: Partial<AgentOsState>): void => {
    if (disposed) return
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const refresh = async (): Promise<void> => {
    if (api === undefined) return
    const [organization, memory, vault, recordings] = await Promise.all([
      api.request({ type: 'organization.read' }),
      api.request({ type: 'memory.read' }),
      api.request({ type: 'vault.list' }),
      api.request({ type: 'recording.list' }),
    ])
    update({
      ready: true,
      organization: organization as OrganizationState,
      memory: memory as AgentOsState['memory'],
      vault: vault as VaultItem[],
      recordings: recordings as Recording[],
      error: '',
    })
  }
  const recordingState = new Map<string, boolean>()
  const unsubscribe = api?.subscribe((event) => {
    if (event.type === 'organization') update({ organization: event.state })
    if (event.type === 'browser') {
      const stopped = recordingState.get(event.state.tabId) === true && !event.state.recording
      recordingState.set(event.state.tabId, event.state.recording)
      if (stopped)
        void api
          .request({ type: 'recording.list' })
          .then((recordings) => {
            update({ recordings: recordings as Recording[] })
          })
          .catch((reason: unknown) => {
            update({ error: String(reason) })
          })
    }
  })
  void refresh().catch((reason: unknown) => {
    update({ error: String(reason) })
  })
  return {
    openVideoStudio,
    hooks: {
      agentOs: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
    },
    async agentOsRequest(command) {
      if (api === undefined) throw new Error('Agent OS desktop is unavailable.')
      try {
        const result = await api.request(command)
        if (command.type === 'organization.mutate') update({ organization: result as OrganizationState, error: '' })
        else if (command.type === 'memory.write') update({ memory: result as AgentOsState['memory'], error: '' })
        else if (command.type.startsWith('vault.') || command.type.startsWith('recording.')) await refresh()
        return result
      } catch (reason) {
        update({ error: String(reason) })
        throw reason
      }
    },
    dispose: () => {
      disposed = true
      unsubscribe?.()
      listeners.clear()
    },
  }
}
