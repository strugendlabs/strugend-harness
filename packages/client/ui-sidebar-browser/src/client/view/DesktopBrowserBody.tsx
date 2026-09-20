/** Native Chromium viewport with controls; the Electron view occupies this measured rectangle. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserAction, Recording } from '@deepseek-ai/dsh-agentos-protocol'
import { desktopTabId, type DesktopBrowserInjected } from '../browser/DesktopBrowser.ts'
import { BrowserNavigation } from '../browser/BrowserNavigation.ts'
import { parseBrowserAddress } from '../browser/url.ts'
import type { BrowserStore } from '../browser/store.ts'
import css from './Browser.module.css'

type Props = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'sidebarBrowser'>
  & PropsStore<BrowserStore> & InjectFace<DesktopBrowserInjected>

function requestError(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason))
    .replace(/^Error invoking remote method '[^']+': Error: /u, '')
}

/** Display the actual tab targeted by Harness desktop_browser calls. */
export function DesktopBrowserBody({
  useTabInfo,
  useDesktopBrowser,
  desktopRequest,
  ownDesktopTab,
  useStore,
  actions,
  desktopSessionId: sessionId,
  t,
}: Props): ReactNode {
  const { tab } = useTabInfo()
  const saved = useStore(value => value.byTab[tab.id])
  const restoredUrl = useRef(BrowserNavigation.current(saved)?.url)
  const params = tab.navigation.params
  const initialUrl = (params !== undefined && 'url' in params ? params.url : undefined) ?? restoredUrl.current
  const nativeTabId = params !== undefined && 'nativeTabId' in params ? params.nativeTabId : undefined
  const tabId = desktopTabId(sessionId, tab.id, nativeTabId)
  const state = useDesktopBrowser(value => value[tabId])
  const viewport = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestRevision = useRef(0)
  useEffect(() => () => { requestRevision.current++ }, [tabId])
  const failed = Boolean(error || state?.error)
  useEffect(() => {
    // Only committed pages resume; in-flight addresses and failed loads do not replace the last working URL.
    if (!state?.url || state.loading || state.error) return
    const parsed = parseBrowserAddress(state.url, window.location.origin)
    if (!parsed.ok) return
    const target = { ...parsed.target, title: state.title || parsed.target.title }
    const previous = BrowserNavigation.current(saved)
    if (previous?.url === target.url && previous.title === target.title) return
    actions.replace(tab.id, {
      ...BrowserNavigation.empty(), entries: [target], index: 0,
      navigation: { status: 'known', revision: state.revision },
    })
  }, [actions, saved, state?.url, state?.title, state?.loading, state?.error, state?.revision, tab.id])
  const run = (command: BrowserAction): void => {
    const revision = ++requestRevision.current
    setError('')
    void desktopRequest({ type: 'browser.action', sessionId, command }).catch((reason: unknown) => {
      if (revision === requestRevision.current) setError(requestError(reason))
    })
  }
  useEffect(() => {
    ownDesktopTab(tabId, tab.signal)
    const element = viewport.current
    if (element === null) return
    let disposed = false
    let frame: number | undefined
    let placement: string | undefined
    const place = (): void => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (disposed) return
        const { x, y, width, height } = element.getBoundingClientRect()
        const bounds = {
          x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
          width: Math.round(width), height: Math.round(height),
        }
        // Native views must yield to app dialogs and menus instead of covering them.
        const covered = document.querySelector('[role="dialog"], [role="menu"], [data-agent-os-overlay]') !== null
        const visible = tab.visible && !covered && !failed
        const measurable = bounds.width > 0 && bounds.height > 0
        const next = measurable ? `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}:${visible}` : 'hidden'
        // Streaming chat mutates the DOM without moving the native viewport.
        if (placement === next) return
        placement = next
        void desktopRequest(measurable ? {
          type: 'browser.mount',
          sessionId,
          tabId,
          bounds,
          visible,
          ...(initialUrl ? { url: initialUrl } : {}),
        } : { type: 'browser.hide', tabId }).catch((reason: unknown) => {
          if (!disposed && placement === next) {
            placement = undefined
            setError(requestError(reason))
          }
        })
      })
    }
    const resize = new ResizeObserver(place)
    resize.observe(element)
    const overlays = new MutationObserver(place)
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'data-agent-os-overlay'],
    })
    window.addEventListener('resize', place)
    place()
    return () => {
      disposed = true
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      overlays.disconnect()
      window.removeEventListener('resize', place)
      void desktopRequest({ type: 'browser.hide', tabId }).catch(() => {
        /* Closing the app already destroys native views. */
      })
    }
  }, [desktopRequest, ownDesktopTab, sessionId, tab.id, tab.signal, tab.visible, initialUrl, tabId, failed])

  const record = (): void => {
    setError('')
    setNotice('')
    void desktopRequest(
      state?.recording ? { type: 'recording.stop', tabId } : { type: 'recording.start', sessionId, tabId },
    )
      .then((value) => {
        if (state?.recording) setNotice(t('native.recorded', { count: (value as Recording).steps.length }))
      })
      .catch((reason: unknown) => {
        setError(String(reason))
      })
  }
  return (
    <div className={css.root} data-agent-os-browser>
      <form
        className={css.toolbar}
        onSubmit={(event) => {
          event.preventDefault()
          run({ action: 'open', tabId, url: draft ?? state?.url ?? '' })
          setDraft(undefined)
        }}
      >
        <button
          className={css.tool}
          type="button"
          aria-label={t('back')}
          disabled={!state?.canGoBack}
          onClick={() => {
            run({ action: 'back', tabId })
          }}
        >
          ‹
        </button>
        <button
          className={css.tool}
          type="button"
          aria-label={t('forward')}
          disabled={!state?.canGoForward}
          onClick={() => {
            run({ action: 'forward', tabId })
          }}
        >
          ›
        </button>
        <button
          className={css.tool}
          type="button"
          aria-label={t('reload')}
          onClick={() => {
            run({ action: 'reload', tabId })
          }}
        >
          ↻
        </button>
        <input
          className={css.address}
          value={draft ?? state?.url ?? initialUrl ?? ''}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          placeholder={t('native.address')}
          aria-label={t('native.address')}
          spellCheck={false}
        />
      </form>
      <div className={css.nativeControls}>
        <span className={css.nativeStatus}>
          {state?.loading ? t('loading') : t(state?.takenOver ? 'native.human' : 'native.ready')}
        </span>
        <button
          type="button"
          onClick={() => {
            run({ action: state?.takenOver ? 'resume' : 'takeover', tabId })
          }}
        >
          {t(state?.takenOver ? 'native.resume' : 'native.takeover')}
        </button>
        <button type="button" disabled={!state?.url} aria-pressed={state?.recording ?? false} onClick={record}>
          {t(state?.recording ? 'native.stop' : 'native.record')}
        </button>
      </div>
      {(error || state?.error) && (
        <div className={css.failure} role="alert">
          {error || state?.error}
          <button type="button" onClick={() => {
            const input = draft ?? state?.url ?? initialUrl ?? ''
            const query = input.replace(/^https?:\/\//u, '').replace(/\/$/u, '')
            run({ action: 'open', tabId, url: `https://search.brave.com/search?${new URLSearchParams({ q: query })}` })
            setDraft(undefined)
          }}>{t('native.search')}</button>
        </div>
      )}
      {notice && (
        <div className={css.nativeNotice} role="status">
          {notice}
        </div>
      )}
      <div ref={viewport} className={css.nativeViewport}>
        {(!state?.url || failed) && <div className={css.start}>{t('native.start')}</div>}
      </div>
    </div>
  )
}
