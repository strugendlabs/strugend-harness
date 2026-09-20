/** Desktop browser state source and commands. Components receive this through slot injection. */
import type { AgentOsDesktopApi, DesktopBrowserState, AgentOsCommand } from '@deepseek-ai/dsh-agentos-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Native browser commands and framework-observable state for a conversation seat. */
export interface DesktopBrowserInjected {
  desktopSessionId: string
  hooks: { desktopBrowser: HostObservable<Record<string, DesktopBrowserState>> }
  desktopRequest(command: AgentOsCommand): Promise<unknown>
  ownDesktopTab(tabId: string, signal: AbortSignal): void
}

/**
 * Sidebar record IDs repeat between chats; native targets must not.
 * @param sessionId - Conversation owning the record.
 * @param tabId - Sidebar-local record ID.
 * @param nativeTabId - Target already created by the agent.
 * @returns Stable native target ID scoped to its conversation.
 */
export function desktopTabId(sessionId: string, tabId: string, nativeTabId?: string): string {
  return nativeTabId ?? `native-${sessionId}-${tabId}`
}

/** @param api - Authenticated preload API. @returns Controller with a stable observable source and cleanup. */
export function createDesktopBrowser(
  api: AgentOsDesktopApi,
): Omit<DesktopBrowserInjected, 'desktopSessionId'> & { dispose(): void } {
  let state: Record<string, DesktopBrowserState> = {}
  const listeners = new Set<() => void>()
  const owned = new Map<string, Map<AbortSignal, () => void>>()
  const unsubscribe = api.subscribe((event) => {
    if (event.type !== 'browser') return
    state = { ...state, [event.state.tabId]: event.state }
    for (const listener of listeners) listener()
  })
  return {
    hooks: {
      desktopBrowser: {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
    },
    desktopRequest: command => api.request(command),
    ownDesktopTab(tabId, signal) {
      if (signal.aborted) return
      let holders = owned.get(tabId)
      if (holders === undefined) { holders = new Map(); owned.set(tabId, holders) }
      if (holders.has(signal)) return
      const release = (): void => {
        holders.delete(signal)
        if (holders.size > 0) return
        owned.delete(tabId)
        const { [tabId]: _closed, ...remaining } = state
        state = remaining
        for (const listener of listeners) listener()
        void api.request({ type: 'browser.close', tabId }).catch(() => {
          /* Parent process owns final teardown after disconnect. */
        })
      }
      holders.set(signal, release)
      signal.addEventListener('abort', release, { once: true })
    },
    dispose: () => {
      unsubscribe()
      listeners.clear()
      for (const holders of owned.values()) {
        for (const [signal, release] of holders) signal.removeEventListener('abort', release)
      }
      owned.clear()
    },
  }
}
