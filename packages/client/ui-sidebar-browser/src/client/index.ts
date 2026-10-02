/** Register the HTTP(S) Browser tab type in the right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { TabRecord } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { VideoStudio, type VideoStudioState } from './view/VideoStudio.tsx'
import type { MediaAsset } from '@deepseek-ai/dsh-agentos-protocol'
import { DesktopBrowserBody } from './view/DesktopBrowserBody.tsx'
import { DesktopBrowserTitle } from './view/DesktopBrowserTitle.tsx'
import { createDesktopBrowser, desktopTabId } from './browser/DesktopBrowser.ts'
import { OwnedPanes } from './browser/OwnedPanes.ts'
import { BrowserBody } from './view/BrowserBody.tsx'
import { BrowserTitle } from './view/BrowserTitle.tsx'
import { createBrowserControllers } from './browser/BrowserController.ts'
import { BROWSER_ID, BROWSER_KIND, browserDefinition } from './definition.tsx'
import { en, zh } from './locales.ts'
import { createBrowserStore } from './browser/store.ts'

export type { BrowserBodyProps } from './view/BrowserBody.tsx'
export type { BrowserInjected } from './browser/BrowserController.ts'
export type { BrowserDocument, BrowserFrame, BrowserFrameState } from './browser/BrowserFrame.ts'
export type { BrowserFailure, BrowserHistoryEntry, BrowserNavigationStatus, BrowserTabState } from './browser/BrowserNavigation.ts'
export type { SidebarBrowserKey } from './locales.ts'
export type { BrowserState } from './browser/store.ts'
export type { BrowserAddressFailure, BrowserAddressResult, BrowserTarget } from './browser/url.ts'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Optional initial Browser URL. */
    browser: { readonly url?: string; readonly nativeTabId?: string }
    video: { readonly assetId?: string }
  }
}

/** A Session identity, as the Sidebar face addresses one. */
type SessionKey = Parameters<Context['sidebarRight']['closeIn']>[0]

/** Required Browser services. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/** Register the Browser type, localized guide entry, body, and title. */
export function apply(ctx: Context): void {
  const namespace = 'sidebarBrowser'
  const t = ctx.locale.bind(namespace)
  const store = createBrowserStore()
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ui-sidebar-browser.copy')
  ctx.effect(() => ctx.sidebarRightTabs.register(browserDefinition(t)), 'ui-sidebar-browser.type')
  const desktop = typeof window === 'undefined' ? undefined : window.agentOS
  if (desktop !== undefined) {
    const controller = createDesktopBrowser(desktop)
    let videoState: VideoStudioState = { assets: [] }
    const videoListeners = new Set<() => void>()
    const updateVideo = (patch: Partial<VideoStudioState>): void => {
      videoState = { ...videoState, ...patch }
      for (const listener of videoListeners) listener()
    }
    const videoSource = {
      getSnapshot: () => videoState,
      subscribe: (listener: () => void) => { videoListeners.add(listener); return () => { videoListeners.delete(listener) } },
    }
    void desktop.request({ type: 'media.list' }).then((assets) => { updateVideo({ assets: assets as MediaAsset[] }) }).catch(() => { /* Parent startup errors are shown by the application boot surface. */ })
    ctx.effect(() => desktop.subscribe((event) => {
      if (event.type === 'media') updateVideo({ assets: event.assets })
      if (event.type === 'media.progress') updateVideo({ progress: event })
    }), 'agent-os: video library')
    const videoId = 'agent-os-video-studio'
    ctx.effect(() => ctx.sidebarRightTabs.register({ id: videoId, kind: 'video', multiple: false, priority: 'builtin', title: () => t('video.title'), guide: [{ id: 'new', order: 35, title: () => t('video.title'), description: () => t('video.description') }] }), 'agent-os: video type')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: videoId, locale: namespace,
      inject: sessionId => ({ hooks: { videoStudio: videoSource }, videoRequest: (command: Parameters<typeof desktop.request>[0]) => desktop.request(command), openSocial: (url: string) => { void desktop.request({ type: 'browser.action', sessionId, command: { action: 'open', url } }) } }),
    }, VideoStudio)), 'agent-os: video studio')

    ctx.effect(() => () =>{  controller.dispose() }, 'agent-os: browser source')
    // Panes a task opened live only as long as the turn that opened them; a
    // pane this plugin opened itself is the task's, and one it only revealed
    // belongs to whoever opened it.
    const taskPanes = new OwnedPanes()
    const nativeTabIdOf = (sessionId: SessionKey, tab: TabRecord): string => {
      const params = ctx.sidebarRight.tabDomain.occurrence(sessionId, tab).navigation.getSnapshot().params
      return desktopTabId(sessionId, tab.id,
        params !== undefined && 'nativeTabId' in params ? params.nativeTabId : undefined)
    }
    const browserTabIn = (sessionId: SessionKey, nativeTabId: string): TabRecord | undefined =>
      ctx.sidebarRight.tabsIn(sessionId).find(tab => tab.kind === BROWSER_KIND && nativeTabIdOf(sessionId, tab) === nativeTabId)
    const closeFinishedPanes = (sessionId: SessionKey): void => {
      const open = ctx.sidebarRight.tabsIn(sessionId)
      const desktopTabs = controller.hooks.desktopBrowser.getSnapshot()
      for (const tabId of taskPanes.finish(sessionId)) {
        const tab = open.find(candidate => candidate.id === tabId)
        // A pane the user already closed is gone; one they have taken over, or
        // are recording a demonstration in, is theirs now. Both stay put.
        if (tab === undefined) continue
        const native = desktopTabs[nativeTabIdOf(sessionId, tab)]
        if (native?.takenOver === true || native?.recording === true) continue
        ctx.sidebarRight.closeIn(sessionId, tabId)
      }
    }
    ctx.effect(() => desktop.subscribe((event) => {
      if (event.type !== 'browser.open') return
      const sessionId = event.sessionId as SessionKey
      const existing = browserTabIn(sessionId, event.tabId)
      if (existing !== undefined) ctx.sidebarRight.revealTabIn(sessionId, existing.id)
      else {
        ctx.sidebarRight.openTabIn(sessionId, BROWSER_KIND, { params: { url: event.url, nativeTabId: event.tabId } })
        const created = browserTabIn(sessionId, event.tabId)
        if (created !== undefined) taskPanes.claim(sessionId, created.id)
      }
    }), 'agent-os: reveal owned browser')
    // The turn that ran the task ends when its Session stops running; that is
    // the moment its panes have served it. The Session status source is a
    // dependency of this behavior alone, so a missing one leaves the rest of
    // the native browser face untouched.
    ctx.inject(['uiSession'], (scope: Context) => {
      const statuses = scope.uiSession.sessionStatus
      taskPanes.follow(statuses)
      scope.effect(() => {
        const running = new Map<SessionKey, boolean>()
        const settle = (): void => {
          for (const [sessionId, status] of statuses.getSnapshot()) {
            const before = running.get(sessionId)
            running.set(sessionId, status.running === true)
            if (before === true && status.running === false) closeFinishedPanes(sessionId)
          }
        }
        const unsubscribe = statuses.subscribe(settle)
        settle()
        return () => { unsubscribe() }
      }, 'agent-os: close finished task panes')
    })
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: BROWSER_ID, locale: namespace, store,
      inject: sessionId => ({ ...controller, desktopSessionId: sessionId }),
    }, DesktopBrowserBody)), 'agent-os: native browser')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title', key: BROWSER_ID,
      inject: sessionId => ({ ...controller, desktopSessionId: sessionId }),
    }, DesktopBrowserTitle)), 'agent-os: native browser title')
  } else {
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: BROWSER_ID, locale: namespace, store,
      inject: (_sessionId, actions) => createBrowserControllers(actions),
    }, BrowserBody)), 'ui-sidebar-browser.body')
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title', key: BROWSER_ID, store,
    }, BrowserTitle)), 'ui-sidebar-browser.title')
  }
}
