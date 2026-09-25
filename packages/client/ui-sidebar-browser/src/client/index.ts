/** Register the HTTP(S) Browser tab type in the right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { VideoStudio, type VideoStudioState } from './view/VideoStudio.tsx'
import type { MediaAsset } from '@deepseek-ai/dsh-agentos-protocol'
import { DesktopBrowserBody } from './view/DesktopBrowserBody.tsx'
import { DesktopBrowserTitle } from './view/DesktopBrowserTitle.tsx'
import { createDesktopBrowser, desktopTabId } from './browser/DesktopBrowser.ts'
import { BrowserBody } from './view/BrowserBody.tsx'
import { BrowserTitle } from './view/BrowserTitle.tsx'
import { createBrowserControllers } from './browser/BrowserController.ts'
import { BROWSER_ID, browserDefinition } from './definition.tsx'
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
    ctx.effect(() => desktop.subscribe((event) => {
      if (event.type !== 'browser.open') return
      const sessionId = event.sessionId as Parameters<typeof ctx.sidebarRight.openTabIn>[0]
      const existing = ctx.sidebarRight.tabsIn(sessionId).find((tab) => {
        const params = ctx.sidebarRight.tabDomain.occurrence(sessionId, tab).navigation.getSnapshot().params
        return tab.kind === 'browser' && desktopTabId(sessionId, tab.id,
          params !== undefined && 'nativeTabId' in params ? params.nativeTabId : undefined) === event.tabId
      })
      if (existing) ctx.sidebarRight.revealTabIn(sessionId, existing.id)
      else ctx.sidebarRight.openTabIn(sessionId, 'browser', { params: { url: event.url, nativeTabId: event.tabId } })
    }), 'agent-os: reveal owned browser')
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
