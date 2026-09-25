/** Owns the exact Chromium targets displayed beside Agent OS conversations. */
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { WebContentsView, session, type BrowserWindow, type Debugger } from 'electron'
import type {
  AgentOsEvent,
  BrowserAction,
  BrowserBounds,
  BrowserObservation,
  BrowserTabList,
  DesktopBrowserState,
  Recording,
  RecordedStep,
} from '@deepseek-ai/dsh-agentos-protocol'
import type { AgentOsStore } from './agentos-store.ts'
import { browserUrl, navigationError, websiteUrl } from './agentos-address.ts'
import { loadWebsite } from './agentos-navigation.ts'
import { elementTargetScript } from './agentos-browser-target.ts'
import { OBSERVE, MASK_INPUTS, selectEditableScript } from './agentos-browser-page.ts'

const ISOLATED_WORLD = 999
const KEY_CODES: Record<string, number> = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32,
}


interface OwnedTab {
  view: WebContentsView
  window: BrowserWindow
  renderer: AbortController
  state: DesktopBrowserState
  bounds?: BrowserBounds
  recording?: Recording
  queue: Promise<unknown>
  closed: boolean
  initialNavigation?: Promise<void>
  navigationUrl?: string
  input?: AbortController
}

/** Owns conversation targets, serializes input, and rejects work from crashed renderers until explicit navigation. */
export class AgentOsBrowser {
  private readonly tabs = new Map<string, OwnedTab>()
  private readonly selectedTabs = new Map<string, string>()

  /** @param window - Current owned application window. @param emit - Redacted UI event sink. @param store - Recording persistence. */
  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly emit: (event: AgentOsEvent) => void,
    private readonly store: AgentOsStore,
  ) {}

  private publish(tab: OwnedTab): void {
    if (tab.closed || tab.view.webContents.isDestroyed()) return
    const wc = tab.view.webContents
    Object.assign(tab.state, {
      url: tab.state.error ? tab.state.url : wc.getURL(),
      title: wc.getTitle(),
      loading: !tab.renderer.signal.aborted && wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
    this.emit({ type: 'browser', state: { ...tab.state } })
  }

  private owned(sessionId: string, tabId: string | undefined): OwnedTab {
    if (typeof tabId !== 'string' || tabId.length === 0)
      throw new Error('This action needs a tabId from desktop_browser list or observe.')
    const tab = this.tabs.get(tabId)
    if (tab === undefined || tab.closed || tab.state.sessionId !== sessionId)
      throw new Error('This browser tab belongs to another chat or has been closed.')
    return tab
  }

  private current(sessionId: string): OwnedTab {
    const tabs = [...this.tabs.values()].filter(tab => !tab.closed && tab.state.sessionId === sessionId)
    const visible = tabs.filter(tab => tab.state.visible)
    const selected = tabs.find(tab => tab.state.tabId === this.selectedTabs.get(sessionId))
    if (selected && (selected.state.visible || visible.length === 0)) return selected
    const candidates = visible.length > 0 ? visible : tabs
    const [candidate] = candidates
    if (candidates.length === 1 && candidate !== undefined) return candidate
    if (tabs.length === 0)
      throw new Error('No browser tab is open in this chat. Use desktop_browser open to open a website.')
    throw new Error('Several browser tabs are open in this chat. Use desktop_browser list and select a tabId.')
  }

  private create(sessionId: string, tabId: string = randomUUID()): OwnedTab {
    if (!/^[\w-]{1,160}$/u.test(sessionId) || !/^[\w-]{1,160}$/u.test(tabId)) throw new Error('Invalid browser owner.')
    const existing = this.tabs.get(tabId)
    if (existing !== undefined) return this.owned(sessionId, tabId)
    const window = this.window()
    if (window === undefined || window.isDestroyed()) throw new Error('Open the Strugend window to use its browser.')
    const profile = session.fromPartition('persist:agent-os-browser')
    profile.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })
    const view = new WebContentsView({
      webPreferences: {
        session: profile,
        preload: fileURLToPath(new URL('./preload-browser.cjs', import.meta.url)),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        backgroundThrottling: false,
      },
    })
    const tab: OwnedTab = {
      view,
      window,
      renderer: new AbortController(),
      bounds: { x: 0, y: 0, width: 1024, height: 768 },
      closed: false,
      queue: Promise.resolve(),
      state: {
        tabId,
        sessionId,
        url: '',
        title: 'Browser',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        revision: 0,
        takenOver: false,
        recording: false,
        visible: false,
      },
    }
    this.tabs.set(tabId, tab)
    window.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
    view.setVisible(false)
    view.webContents.setWindowOpenHandler(({ url }) => {
      void this.act(sessionId, { action: 'open', url }, true).catch(() => {
        /* The originating page retains its current tab on popup refusal. */
      })
      return { action: 'deny' }
    })
    view.webContents.on('focus', () => {
      if (!tab.closed) this.selectedTabs.set(sessionId, tabId)
    })
    view.webContents.on('will-navigate', (event, url) => {
      try {
        websiteUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    view.webContents.on('did-navigate', (_event, url) => {
      if (tab.closed || tab.renderer.signal.aborted) return
      delete tab.state.error
      tab.state.revision++
      if (tab.recording !== undefined) {
        const safeUrl = new URL(url)
        safeUrl.search = ''
        safeUrl.hash = ''
        tab.recording.steps.push({ action: 'navigate', url: safeUrl.href, time: Date.now() })
      }
      this.publish(tab)
    })
    view.webContents.on('did-start-loading', () => {
      this.publish(tab)
    })
    view.webContents.on('did-stop-loading', () => {
      this.publish(tab)
    })
    view.webContents.on('page-title-updated', () => {
      this.publish(tab)
    })
    view.webContents.on('did-navigate-in-page', () => {
      tab.state.revision++
      this.publish(tab)
    })
    view.webContents.on('dom-ready', () => {
      view.webContents.send('agent-os:recording', tab.recording !== undefined)
    })
    view.webContents.on('ipc-message', (_event, channel, input: unknown) => {
      if (
        channel !== 'agent-os:record-step' ||
        tab.recording === undefined ||
        typeof input !== 'object' ||
        input === null
      )
        return
      const step = input as RecordedStep
      if (
        !['click', 'change'].includes(step.action) ||
        typeof step.target !== 'string' ||
        step.target.length > 200 ||
        typeof step.url !== 'string'
      )
        return
      tab.recording.steps.push(step)
      if (tab.recording.steps.length > 2000) tab.recording.steps.shift()
      this.store.saveRecording(tab.recording)
    })
    view.webContents.on('render-process-gone', () => {
      if (tab.closed) return
      const error = new Error('This page stopped unexpectedly. Reload it to continue.')
      tab.state.error = error.message
      tab.state.url = tab.navigationUrl ?? (view.webContents.getURL() || tab.state.url)
      tab.state.revision++
      tab.input?.abort(error)
      tab.renderer.abort(error)
      this.publish(tab)
    })
    view.webContents.on('destroyed', () => { this.close(tabId) })
    view.webContents.on('did-fail-load', (_event, code, description, url, main) => {
      if (!tab.closed && !tab.renderer.signal.aborted && main && code !== -3) {
        tab.state.error = navigationError(description)
        tab.state.url = url
        this.publish(tab)
      }
    })
    return tab
  }

  private rendererResult<T>(tab: OwnedTab, run: () => Promise<T>, caller?: AbortSignal): Promise<T> {
    const signal = caller === undefined ? tab.renderer.signal : AbortSignal.any([caller, tab.renderer.signal])
    signal.throwIfAborted()
    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Browser operation cancelled.')) }
      signal.addEventListener('abort', aborted, { once: true })
      void Promise.resolve().then(() => { signal.throwIfAborted(); return run() }).then(
        (value) => { signal.removeEventListener('abort', aborted); resolve(value) },
        (error: unknown) => { signal.removeEventListener('abort', aborted); reject(error instanceof Error ? error : new Error(String(error))) },
      )
    })
  }

  private async script<T>(tab: OwnedTab, code: string, signal?: AbortSignal): Promise<T> {
    // Electron drops exceptions crossing an isolated world; return their message as data.
    const wrapped = `(async()=>{try{return {ok:true,value:await (${code})}}catch(error){return {ok:false,error:String(error?.message||error).slice(0,1000)}}})()`
    const result = await this.rendererResult(tab,
      () => tab.view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: wrapped }], true) as Promise<
        { ok: true; value: T } | { ok: false; error: string }
      >, signal)
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  private enqueue<T>(
    tab: OwnedTab, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, recover = false, human = false,
  ): Promise<T> {
    const renderer = tab.renderer
    const recovery = recover && renderer.signal.aborted
    const result = tab.queue.then(() => {
      signal?.throwIfAborted()
      if (tab.closed) throw new Error('The browser tab was closed.')
      if (renderer !== tab.renderer) throw new Error('The page changed. Observe it again before acting.')
      if (recovery) {
        if (!human && tab.state.takenOver) throw new Error('The user has taken control. Wait for them to resume the agent.')
        tab.renderer = new AbortController()
        delete tab.state.error
      } else renderer.signal.throwIfAborted()
      const operation = signal === undefined ? tab.renderer.signal : AbortSignal.any([signal, tab.renderer.signal])
      return run(operation)
    })
    tab.queue = result.catch(() => undefined)
    return result
  }

  private async dispatchInput(tab: OwnedTab, operation: (debug: Debugger) => Promise<void>): Promise<void> {
    const debug = tab.view.webContents.debugger
    const attached = !debug.isAttached()
    if (attached) debug.attach('1.3')
    try {
      // CDP acknowledges input delivery before the following page observation.
      await operation(debug)
    } finally {
      if (attached && debug.isAttached()) debug.detach()
    }
  }

  private async clickPoint(tab: OwnedTab, point: { x: number; y: number }, human: boolean, signal?: AbortSignal): Promise<void> {
    const operation = signal === undefined ? tab.renderer.signal : AbortSignal.any([signal, tab.renderer.signal])
    await this.dispatchInput(tab, async (debug) => {
      await this.rendererResult(tab, () => debug.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }), operation)
      signal?.throwIfAborted()
      if (!human && tab.state.takenOver) throw new Error('The user has taken control.')
      try {
        await this.rendererResult(tab, () => debug.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }), operation)
      } finally {
        if (!tab.view.webContents.isDestroyed() && !tab.renderer.signal.aborted)
          await this.rendererResult(tab, () => debug.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }))
      }
    })
  }

  private async navigate(tab: OwnedTab, url: string, signal?: AbortSignal): Promise<void> {
    delete tab.state.error
    tab.navigationUrl = url
    try {
      const operation = signal === undefined ? tab.renderer.signal : AbortSignal.any([signal, tab.renderer.signal])
      await loadWebsite(tab.view.webContents, url, operation)
    } catch (error) {
      if (signal?.aborted || tab.renderer.signal.aborted || tab.closed || tab.view.webContents.isDestroyed()) throw error
      tab.state.url = error instanceof Error && 'url' in error && typeof error.url === 'string' ? error.url : url
      tab.state.error = navigationError(error)
      this.publish(tab)
      throw new Error(tab.state.error)
    } finally {
      delete tab.navigationUrl
    }
  }

  /**
   * @param sessionId - Chat owner.
   * @param tabId - Visible tab identity.
   * @param bounds - Viewport.
   * @param visible - Whether to show the native view.
   * @param url - Optional first navigation.
   * @param selected - The active tab in the active sidebar pane, even when hidden by an overlay.
   * @returns Tab state.
   */
  async mount(
    sessionId: string,
    tabId: string,
    bounds: BrowserBounds,
    visible: boolean,
    url?: string,
    selected?: boolean,
  ): Promise<DesktopBrowserState> {
    const tab = this.create(sessionId, tabId)
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width < 0 ||
      bounds.height < 0 ||
      bounds.width > 20000 ||
      bounds.height > 20000
    )
      throw new Error('Invalid browser viewport.')
    if (bounds.width > 0 && bounds.height > 0) tab.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    if (selected === true) this.selectedTabs.set(sessionId, tabId)
    if (tab.bounds) tab.view.setBounds(tab.bounds)
    tab.state.visible = visible && bounds.width > 0 && bounds.height > 0
    tab.view.setVisible(tab.state.visible)
    if (!tab.state.url && url !== undefined && tab.initialNavigation === undefined) {
      tab.initialNavigation = this.navigate(tab, browserUrl(url))
      await tab.initialNavigation
    }
    this.publish(tab)
    return { ...tab.state }
  }

  /** @param tabId - Tab hidden by pane switching; session state remains intact. */
  hide(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) return
    tab.state.visible = false
    tab.view.setVisible(false)
    this.publish(tab)
  }

  /** @param tabId - Tab being closed. */
  close(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined || tab.closed) return
    if (tab.recording !== undefined) this.store.saveRecording(tab.recording)
    tab.closed = true
    this.tabs.delete(tabId)
    if (this.selectedTabs.get(tab.state.sessionId) === tabId) this.selectedTabs.delete(tab.state.sessionId)
    const error = new Error('The browser tab was closed.')
    tab.input?.abort(error)
    tab.renderer.abort(error)
    if (!tab.window.isDestroyed()) tab.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  /** Close all owned targets when the application exits. */
  dispose(): void {
    for (const id of this.tabs.keys()) this.close(id)
  }

  /** @param sessionId - Chat owner. @returns Only that chat's tabs. */
  list(sessionId: string): DesktopBrowserState[] {
    return [...this.tabs.values()].filter(tab => tab.state.sessionId === sessionId).map(tab => ({ ...tab.state }))
  }

  /**
   * @param sessionId - Tool's actual chat owner.
   * @param command - Restricted operation.
   * @param human - True only for trusted UI commands.
   * @param signal - Task cancellation; queued and active renderer requests honor it.
   * @returns Observed result.
   */
  async act(
    sessionId: string,
    command: BrowserAction,
    human = false,
    signal?: AbortSignal,
  ): Promise<BrowserObservation | DesktopBrowserState | BrowserTabList> {
    signal?.throwIfAborted()
    if (command.action === 'list') return { tabs: this.list(sessionId) }
    if (command.action === 'open') {
      const url = browserUrl(command.url)
      const tab = command.tabId === undefined ? this.create(sessionId) : this.owned(sessionId, command.tabId)
      if (!human && tab.state.takenOver)
        throw new Error('The user has taken control. Wait for them to resume the agent.')
      const run = async (operation: AbortSignal): Promise<BrowserObservation> => {
        signal?.throwIfAborted()
        if (tab.closed || (!human && tab.state.takenOver))
          throw new Error('The browser is closed or under user control.')
        await this.navigate(tab, url, operation)
        return this.observe(tab, false, operation)
      }
      this.selectedTabs.set(sessionId, tab.state.tabId)
      const result = this.enqueue(tab, run, signal, true, human)
      // The renderer may mount immediately in response to this event. Reserve
      // navigation first so the pane does not race a second loadURL against it.
      tab.initialNavigation = result.then(() => undefined, () => undefined)
      if (command.tabId === undefined || (!human && !tab.state.visible))
        this.emit({ type: 'browser.open', sessionId, tabId: tab.state.tabId, url })
      return result
    }
    const tab = command.action === 'observe' && command.tabId === undefined
      ? this.current(sessionId)
      : this.owned(sessionId, command.tabId)
    if (command.action === 'takeover' || command.action === 'resume') {
      if (!human) throw new Error('Only the user can change browser control.')
      tab.state.takenOver = command.action === 'takeover'
      if (tab.state.takenOver) tab.input?.abort(new Error('The user has taken control.'))
      tab.state.revision++
      this.publish(tab)
      return { ...tab.state }
    }
    const recovering = command.action === 'reload' && tab.renderer.signal.aborted
    if (!human && !tab.state.visible && !tab.state.takenOver)
      this.emit({ type: 'browser.open', sessionId, tabId: tab.state.tabId, url: tab.state.url })
    const run = async (operation: AbortSignal): Promise<BrowserObservation> => {
      operation.throwIfAborted()
      if (tab.closed) throw new Error('The browser tab was closed.')
      if (command.action !== 'observe' && !human && tab.state.takenOver)
        throw new Error('The user has taken control. Wait for them to resume the agent.')
      const wc = tab.view.webContents
      switch (command.action) {
        case 'observe':
          return this.observe(tab, command.screenshot === true, operation)
        case 'back':
          if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
          break
        case 'forward':
          if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
          break
        case 'reload':
          if (recovering) await this.navigate(tab, websiteUrl(tab.state.url), operation)
          else wc.reload()
          break
        case 'scroll':
          await this.script(tab, `window.scrollBy(0, ${command.direction === 'up' ? -600 : 600})`, operation)
          break
        case 'key': {
          if (!/^(?:[a-zA-Z0-9]|Enter|Tab|Escape|Backspace|Delete|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Space)$/u.test(command.key))
            throw new Error('Unsupported key.')
          const holdMs = command.holdMs ?? 0
          if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 1000)
            throw new Error('Key holdMs must be between 0 and 1000 milliseconds.')
          const key = command.key === 'Space' ? ' ' : command.key
          const code = /^[a-z]$/iu.test(key) ? `Key${key.toUpperCase()}` : /^\d$/u.test(key) ? `Digit${key}` : command.key
          const keyEvent = {
            key, code,
            windowsVirtualKeyCode: KEY_CODES[command.key] ?? key.toUpperCase().charCodeAt(0),
            modifiers: /^[A-Z]$/u.test(key) ? 8 : 0,
          }
          const input = new AbortController()
          tab.input = input
          const inputSignal = AbortSignal.any([operation, input.signal])
          try {
            await this.dispatchInput(tab, async (debug) => {
              try {
                inputSignal.throwIfAborted()
                await this.rendererResult(tab, () => debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...keyEvent, ...(key.length === 1 ? { text: key } : {}) }), inputSignal)
                if (holdMs > 0) await delay(holdMs, undefined, { signal: inputSignal })
              } finally {
                if (!wc.isDestroyed() && !tab.renderer.signal.aborted)
                  await this.rendererResult(tab, () => debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent }))
              }
            })
          } finally {
            delete tab.input
          }
          break
        }
        case 'click_point': {
          if (command.revision !== tab.state.revision)
            throw new Error('The page changed. Observe it again before acting.')
          if (![command.x, command.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Point coordinates must be between 0 and 1 within the observed viewport.')
          const viewport = await this.script<{ width: number; height: number }>(tab, '({width:innerWidth,height:innerHeight})', operation)
          if (viewport.width <= 0 || viewport.height <= 0) throw new Error('The browser viewport is not ready.')
          signal?.throwIfAborted()
          if (!human && tab.state.takenOver) throw new Error('The user has taken control.')
          const point = {
            x: Math.min(viewport.width - 1, Math.round(command.x * viewport.width)),
            y: Math.min(viewport.height - 1, Math.round(command.y * viewport.height)),
          }
          await this.clickPoint(tab, point, human, operation)
          break
        }
        case 'click':
        case 'fill': {
          if (command.revision !== tab.state.revision)
            throw new Error('The page changed. Observe it again before acting.')
          if (!/^e\d{1,3}$/u.test(command.ref)) throw new Error('Use an element reference from the latest observation.')
          const point = await this.script<{ x: number; y: number }>(
            tab,
            elementTargetScript(command.ref),
            operation,
          )
          signal?.throwIfAborted()
          if (!human && tab.state.takenOver) throw new Error('The user has taken control.')
          if (command.action === 'click') {
            await this.clickPoint(tab, point, human, operation)
          } else {
            if (typeof command.value !== 'string' || command.value.length > 20000)
              throw new Error('Input text is too long.')
            const input = await this.script(tab, selectEditableScript(command.ref, true, command.value), operation)
            if (input !== 'native') await this.rendererResult(tab, () => wc.insertText(command.value), operation)
          }
          break
        }
        case 'fill_form': {
          if (command.revision !== tab.state.revision) throw new Error('The page changed. Observe it again before acting.')
          if (!Array.isArray(command.fields) || command.fields.length < 1 || command.fields.length > 30
            // Model JSON may contain null array entries despite the declared command type.
            || command.fields.some(field => !field || !/^e\d{1,3}$/u.test(field.ref) || typeof field.value !== 'string' || field.value.length > 20000)
            || new Set(command.fields.map(field => field.ref)).size !== command.fields.length)
            throw new Error('Provide 1–30 distinct observed editable refs with values of at most 20000 characters.')
          for (const field of command.fields) await this.script(tab, selectEditableScript(field.ref, false, field.value), operation)
          const applied: string[] = []
          let error: string | undefined
          for (const field of command.fields) {
            try {
              operation.throwIfAborted()
              if (tab.state.revision !== command.revision) throw new Error('The page navigated during input. Observe before filling the remaining fields.')
              if (!human && tab.state.takenOver) throw new Error('The user has taken control.')
              await this.script(tab, elementTargetScript(field.ref), operation)
              const input = await this.script(tab, selectEditableScript(field.ref, true, field.value), operation)
              if (input !== 'native') await this.rendererResult(tab, () => wc.insertText(field.value), operation)
              applied.push(field.ref)
            } catch (failure) {
              operation.throwIfAborted()
              error = failure instanceof Error ? failure.message : String(failure)
              break
            }
          }
          tab.state.revision++
          const observation = await this.observe(tab, false, operation)
          return { ...observation, formFill: {
            applied, remaining: command.fields.slice(applied.length).map(field => field.ref), ...(error === undefined ? {} : { error }),
          } }
        }
        default:
          throw new Error('Unknown browser action.')
      }
      tab.state.revision++
      return this.observe(tab, false, operation)
    }
    return this.enqueue(tab, run, signal, command.action === 'reload', human)
  }

  private async observe(tab: OwnedTab, screenshot: boolean, signal?: AbortSignal): Promise<BrowserObservation> {
    const lifetime = signal === undefined ? tab.renderer.signal : AbortSignal.any([signal, tab.renderer.signal])
    lifetime.throwIfAborted()
    if (tab.view.webContents.isLoadingMainFrame())
      await this.rendererResult(tab, () => new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          tab.view.webContents.off('did-stop-loading', done)
          lifetime.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, 3000)
        tab.view.webContents.once('did-stop-loading', done)
        lifetime.addEventListener('abort', done, { once: true })
      }), signal)
    const observed = await this.script<Pick<BrowserObservation, 'text' | 'elements' | 'viewport'>>(tab, OBSERVE, signal)
    tab.state.revision++
    this.publish(tab)
    let image: string | undefined
    if (screenshot) {
      await this.script(
        tab,
        MASK_INPUTS,
        signal,
      )
      try {
        const captureSignal = AbortSignal.any([lifetime, AbortSignal.timeout(5000)])
        const captured = await this.rendererResult(tab,
          () => tab.view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), captureSignal)
        if (captured.isEmpty()) throw new Error('Browser screenshot is temporarily unavailable; use the current page observation.')
        image = captured.toDataURL()
      } finally {
        await this.script(tab, 'globalThis.__agentOSMasks?.forEach(el=>el.remove())')
      }
    }
    return { state: { ...tab.state }, ...observed, ...(image === undefined ? {} : { screenshot: image }) }
  }

  /** @param sessionId - Chat owner. @param tabId - Demonstration surface. @returns New recording identity. */
  startRecording(sessionId: string, tabId: string): Recording {
    const tab = this.owned(sessionId, tabId)
    if (tab.recording !== undefined) throw new Error('This tab is already recording.')
    const url = new URL(tab.state.url)
    url.search = ''
    url.hash = ''
    tab.recording = {
      id: randomUUID(),
      title: `Workflow on ${url.hostname}`,
      createdAt: Date.now(),
      steps: [{ action: 'navigate', url: url.href, time: Date.now() }],
    }
    tab.view.webContents.send('agent-os:recording', true)
    tab.state.recording = true
    this.publish(tab)
    return tab.recording
  }

  /** @param tabId - Recording to finalize. @returns Redacted demonstration. */
  stopRecording(tabId: string): Recording {
    const tab = this.tabs.get(tabId)
    if (tab?.recording === undefined) throw new Error('No recording is active in this tab.')
    tab.view.webContents.send('agent-os:recording', false)
    const recording = { ...tab.recording, steps: [...tab.recording.steps].sort((a, b) => a.time - b.time) }
    this.store.saveRecording(recording)
    delete tab.recording
    tab.state.recording = false
    this.publish(tab)
    return recording
  }

  /**
   * @param sessionId - Actual chat owner.
   * @param input - Observed file picker and already-admitted paths.
   * @param signal - Task cancellation before file selection and while observing the result.
   * @returns Updated page observation.
   */
  async upload(
    sessionId: string,
    input: Extract<BrowserAction, { action: 'upload' }>,
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    const tab = this.owned(sessionId, input.tabId)
    const run = async (operation: AbortSignal): Promise<BrowserObservation> => {
      operation.throwIfAborted()
      if (tab.closed || tab.state.takenOver) throw new Error('Resume the agent before uploading.')
      if (input.revision !== tab.state.revision || !/^e\d{1,3}$/u.test(input.ref))
        throw new Error('Observe the page again before uploading.')
      const marker = randomUUID()
      await this.script(
        tab,
        `(() => {const el=globalThis.__agentOSNodes?.get(${JSON.stringify(input.ref)});if(!el?.isConnected||!el.matches('input[type="file"]'))throw Error('Choose a file input from the observation.');el.setAttribute('data-agent-os-upload',${JSON.stringify(marker)});})()`,
        operation,
      )
      const debug = tab.view.webContents.debugger
      const attached = !debug.isAttached()
      if (attached) debug.attach('1.3')
      try {
        const document = (await this.rendererResult(tab, () => debug.sendCommand('DOM.getDocument'), operation)) as { root: { nodeId: number } }
        const node = (await this.rendererResult(tab, () => debug.sendCommand('DOM.querySelector', {
          nodeId: document.root.nodeId,
          selector: `input[data-agent-os-upload="${marker}"]`,
        }), operation)) as { nodeId: number }
        signal?.throwIfAborted()
        if (!node.nodeId || this.owned(sessionId, input.tabId).state.takenOver) throw new Error('The upload field changed. Observe again.')
        await this.rendererResult(tab, () => debug.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: input.paths }), operation)
      } finally {
        if (attached && debug.isAttached()) debug.detach()
        await this.script(
          tab,
          `document.querySelector('[data-agent-os-upload="${marker}"]')?.removeAttribute('data-agent-os-upload')`,
        )
      }
      return this.observe(tab, false, operation)
    }
    return this.enqueue(tab, run, signal)
  }

  /**
   * @param sessionId - Chat owner.
   * @param tabId - Destination.
   * @param origin - Exact approved origin.
   * @param username - Login name.
   * @param password - Decrypted value kept inside the broker.
   * @param options - Model callers require a fresh revision and respect user takeover; UI fills omit it.
   */
  async fillCredential(
    sessionId: string,
    tabId: string,
    origin: string,
    username: string,
    password: string,
    options?: { revision: number; signal?: AbortSignal | undefined },
  ): Promise<void> {
    const tab = this.owned(sessionId, tabId)
    await this.enqueue(tab, async (signal) => {
      signal.throwIfAborted()
      if (options !== undefined && (tab.state.takenOver || options.revision !== tab.state.revision))
        throw new Error('Resume the agent and observe the login page again before filling.')
      if (new URL(tab.view.webContents.getURL()).origin !== origin || !origin.startsWith('https://'))
        throw new Error('This login is saved for a different website.')
      await this.script(tab,
        `(() => { if(location.origin!==${JSON.stringify(origin)})throw Error('Website changed.');const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.disabled;};const fields=[...document.querySelectorAll('input[type="password"]')].filter(visible);if(fields.length!==1)throw Error('Open a login form with one visible password field.');const p=fields[0];const u=[...(p.form||document).querySelectorAll('input[autocomplete="username"],input[type="email"],input[name="username"]')].find(visible); const set=(e,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};if(u)set(u,${JSON.stringify(username)});if(location.origin!==${JSON.stringify(origin)}||!p.isConnected)throw Error('Website changed.');set(p,${JSON.stringify(password)});})()`, signal)
      tab.state.revision++
      this.publish(tab)
    }, options?.signal)
  }
}
