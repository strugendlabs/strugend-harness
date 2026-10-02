/** A task's browser pane closes with its turn; a pane the user opened survives. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentOsDesktopApi, AgentOsEvent, DesktopBrowserState } from '@deepseek-ai/dsh-agentos-protocol'
import type { TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightCloseHandler } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { OwnedPanes } from '../src/client/browser/OwnedPanes.ts'
import { apply, inject } from '../src/client/index.ts'

type SessionId = Parameters<SidebarRightCloseHandler>[0]

afterEach(() => { vi.unstubAllGlobals() })

/** Let the plugin's own sub-fibers activate on a fresh status service. */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/** The right Sidebar, the Session status service, and the desktop bridge one chat pane needs. */
function bench(options: { adopt?: boolean; status?: 'ready' | 'late' | 'absent' } = {}) {
  const adopted = options.adopt !== false
  const mode = options.status ?? 'ready'
  const ctx = new Context()
  const records = new Map<SessionId, TabRecord[]>()
  const occurrences = new Map<string, { params?: unknown; address: string }>()
  const opens: TabId[] = []
  const reveals: TabId[] = []
  const closes: TabId[] = []
  const keyOf = (sessionId: SessionId, tabId: TabId): string => sessionId + ':' + tabId
  let minted = 0
  const place = (sessionId: SessionId, tab: TabRecord, params?: unknown): void => {
    records.set(sessionId, [...(records.get(sessionId) ?? []), tab])
    occurrences.set(keyOf(sessionId, tab.id), { params, address: tab.contentId })
  }
  ctx.provide('sidebarRight', {
    tabsIn: (sessionId: SessionId): readonly TabRecord[] => records.get(sessionId) ?? [],
    openTabIn: (sessionId: SessionId, kind: string, opts?: { params?: unknown }): void => {
      if (!adopted) return
      const tab: TabRecord = { id: `tab${++minted}` as TabId, kind, contentId: `sidebar://${kind}`, title: kind }
      place(sessionId, tab, opts?.params)
      opens.push(tab.id)
    },
    revealTabIn: (_sessionId: SessionId, tabId: TabId): void => { reveals.push(tabId) },
    closeIn: (sessionId: SessionId, tabId: TabId): void => {
      closes.push(tabId)
      records.set(sessionId, (records.get(sessionId) ?? []).filter(tab => tab.id !== tabId))
    },
    tabDomain: {
      occurrence: (sessionId: SessionId, tab: Pick<TabRecord, 'id'>) => ({
        navigation: { getSnapshot: () => occurrences.get(keyOf(sessionId, tab.id)) ?? { address: '', params: undefined } },
      }),
    },
  } as never)
  ctx.provide('sidebarRightTabs', { register: vi.fn(() => () => {}) } as never)
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: () => () => {},
  } as never)
  ctx.provide('locale', { bind: () => (name: string) => name, register: () => () => {} } as never)
  let status: SessionStatusSnapshot = new Map()
  const statusListeners = new Set<() => void>()
  const sessionStatus = {
    getSnapshot: () => status,
    subscribe: (listener: () => void) => { statusListeners.add(listener); return () => { statusListeners.delete(listener) } },
  }
  if (mode === 'ready') ctx.provide('uiSession', { sessionStatus } as never)
  const listeners = new Set<(event: AgentOsEvent) => void>()
  const api: AgentOsDesktopApi = {
    request: vi.fn(async () => []),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  vi.stubGlobal('window', { agentOS: api })
  const emit = (event: AgentOsEvent): void => { for (const listener of [...listeners]) listener(event) }
  const desktopState = (sessionId: SessionId, tabId: string, patch: Partial<DesktopBrowserState>): void => {
    emit({
      type: 'browser',
      state: {
        tabId, sessionId, url: 'https://example.test/', title: 'Example', loading: false,
        canGoBack: false, canGoForward: false, revision: 0, takenOver: false, recording: false,
        visible: true, ...patch,
      },
    })
  }
  return {
    ctx, opens, reveals, closes,
    /** A pane the user opened: the sidebar mints its native id from the record. */
    seedUserPane(sessionId: SessionId, tabId: TabId): void {
      place(sessionId, { id: tabId, kind: 'browser', contentId: 'sidebar://browser', title: 'Browser' })
    },
    setRunning(sessionId: SessionId, running: boolean): void {
      const next = new Map(status)
      next.set(sessionId, { running, pendingInteraction: undefined, completionUnread: false })
      status = next
      for (const listener of [...statusListeners]) listener()
    },
    emit,
    openNative(sessionId: SessionId, tabId: string): void {
      emit({ type: 'browser.open', sessionId, tabId, url: 'https://example.test/' })
    },
    desktopState,
    /** The Session status service arriving after the pane was already opened. */
    attachStatus(): void {
      ctx.provide('uiSession', { sessionStatus } as never)
    },
    async start(): Promise<{ dispose(): Promise<void> }> {
      const fiber = await ctx.plugin({ inject, apply })
      await settle()
      return { dispose: async () => { await fiber.dispose(); await ctx.fiber.dispose() } }
    },
  }
}

describe('Browser panes a task opened', () => {
  it('closes the pane with the turn that opened it', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.setRunning(session, true)
    h.openNative(session, 'native-1')
    expect(h.opens).toEqual(['tab1'])
    expect(h.closes).toEqual([])
    h.setRunning(session, false)
    expect(h.closes).toEqual(['tab1'])
    await app.dispose()
  })

  it('leaves a pane the user opened, including one a task later reveals', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.seedUserPane(session, 'tab7' as TabId)
    h.setRunning(session, true)
    // The desktop addresses a user-opened pane by the id the sidebar minted.
    h.openNative(session, 'native-chat-tab7')
    expect(h.reveals).toEqual(['tab7'])
    expect(h.opens).toEqual([])
    h.setRunning(session, false)
    expect(h.closes).toEqual([])
    await app.dispose()
  })

  it('keeps the user pane while the task pane closes beside it', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.seedUserPane(session, 'mine' as TabId)
    h.setRunning(session, true)
    h.openNative(session, 'native-1')
    h.setRunning(session, false)
    expect(h.closes).toEqual(['tab1'])
    await app.dispose()
  })

  it('never claims a pane opened while its Session is known idle', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.setRunning(session, false)
    // The Video Studio's social buttons drive the same desktop command.
    h.openNative(session, 'native-1')
    expect(h.opens).toEqual(['tab1'])
    h.setRunning(session, true)
    h.setRunning(session, false)
    expect(h.closes).toEqual([])
    await app.dispose()
  })

  it('releases a pane under user control or mid-demonstration instead of closing it', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.setRunning(session, true)
    h.openNative(session, 'native-1')
    h.openNative(session, 'native-2')
    h.desktopState(session, 'native-1', { takenOver: true })
    h.desktopState(session, 'native-2', { recording: true })
    h.setRunning(session, false)
    expect(h.closes).toEqual([])
    await app.dispose()
  })

  it('claims an open that arrives before the Session status service does', async () => {
    const h = bench({ status: 'late' })
    const app = await h.start()
    const session = 'chat' as SessionId
    h.openNative(session, 'native-1')
    h.attachStatus()
    await settle()
    h.setRunning(session, true)
    h.setRunning(session, false)
    expect(h.closes).toEqual(['tab1'])
    await app.dispose()
  })

  it('still opens and reveals panes without a Session status service', async () => {
    const h = bench({ status: 'absent' })
    const app = await h.start()
    const session = 'chat' as SessionId
    h.openNative(session, 'native-1')
    expect(h.opens).toEqual(['tab1'])
    h.openNative(session, 'native-1')
    expect(h.reveals).toEqual(['tab1'])
    expect(h.closes).toEqual([])
    await app.dispose()
  })

  it('opens and claims nothing for a Session with no adopted sidebar store', async () => {
    const h = bench({ adopt: false })
    const app = await h.start()
    const session = 'chat' as SessionId
    h.setRunning(session, true)
    h.openNative(session, 'native-1')
    h.setRunning(session, false)
    expect(h.opens).toEqual([])
    expect(h.closes).toEqual([])
    await app.dispose()
  })

  it('stops closing panes when the plugin unloads', async () => {
    const h = bench()
    const app = await h.start()
    const session = 'chat' as SessionId
    h.setRunning(session, true)
    h.openNative(session, 'native-1')
    await app.dispose()
    h.setRunning(session, false)
    expect(h.closes).toEqual([])
  })
})

describe('OwnedPanes', () => {
  const session = 'chat' as SessionId
  const statusSource = (result: SessionStatusSnapshot) => ({ getSnapshot: () => result, subscribe: () => () => {} })
  const status = (running: boolean | undefined): SessionStatusSnapshot => new Map([
    [session, { running, pendingInteraction: undefined, completionUnread: false } as SessionStatus],
  ])

  it('hands a Session its claims back once', () => {
    const panes = new OwnedPanes()
    panes.follow(statusSource(status(true)))
    panes.claim(session, 'first' as TabId)
    panes.claim(session, 'second' as TabId)
    expect(panes.finish(session)).toEqual(['first', 'second'])
    expect(panes.finish(session)).toEqual([])
  })

  it('ignores an open its Session status reports as idle', () => {
    const panes = new OwnedPanes()
    panes.follow(statusSource(status(false)))
    panes.claim(session, 'user-owned' as TabId)
    expect(panes.finish(session)).toEqual([])
  })

  it('claims an open whose Session status is unknown', () => {
    const panes = new OwnedPanes()
    panes.follow(statusSource(status(undefined)))
    panes.claim(session, 'task-owned' as TabId)
    expect(panes.finish(session)).toEqual(['task-owned'])
  })
})
