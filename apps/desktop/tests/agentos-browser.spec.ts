/** A tool open and renderer mount must share one navigation, including fast pane adoption. */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentOsEvent } from '@deepseek-ai/dsh-agentos-protocol'
import type { BrowserWindow, WebContentsView } from 'electron'
import { AgentOsStore } from '../src/agentos-store.ts'

const navigation = vi.hoisted(() => ({
  bounds: [] as unknown[], urls: [] as string[], inputs: [] as Record<string, unknown>[], release: () => {},
  acknowledge: (_event: Record<string, unknown>): Promise<void> => Promise.resolve(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    private url = ''
    navigationHistory = { canGoBack: () => false, canGoForward: () => false }
    getURL(): string { return this.url }
    getTitle(): string { return 'Fixture' }
    isDestroyed(): boolean { return false }
    isLoading(): boolean { return false }
    isLoadingMainFrame(): boolean { return false }
    setWindowOpenHandler(): void {}
    send(): void {}
    private attached = false
    debugger = {
      isAttached: (): boolean => this.attached,
      attach: (): void => { this.attached = true },
      detach: (): void => { this.attached = false },
      sendCommand: (_method: string, event: Record<string, unknown>): Promise<void> => {
        navigation.inputs.push(event)
        return navigation.acknowledge(event)
      },
    }
    close(): void { this.emit('destroyed') }
    stop(): void {}
    loadURL(url: string): Promise<void> {
      navigation.urls.push(url)
      return new Promise((resolve) => { navigation.release = () => { this.url = url; resolve() } })
    }
    executeJavaScriptInIsolatedWorld(_world: number, scripts: Array<{ code: string }>): Promise<unknown> {
      return Promise.resolve(scripts[0]?.code === '({width:innerWidth,height:innerHeight})'
        ? { width: 600, height: 500 }
        : { text: 'Fixture ready', elements: [], viewport: { width: 600, height: 500 } })
    }
  }
  return {
    session: { fromPartition: () => ({ setPermissionRequestHandler: () => {} }) },
    WebContentsView: class {
      webContents = new Contents()
      setVisible(): void {}
      setBounds(value: unknown): void { navigation.bounds.push(value) }
    },
  }
})
import { AgentOsBrowser } from '../src/agentos-browser.ts'

beforeEach(() => { navigation.bounds = []; navigation.urls = []; navigation.inputs = []; navigation.acknowledge = () => Promise.resolve() })

const dispose: Array<() => void> = []
afterEach(() => { for (const cleanup of dispose.splice(0).reverse()) cleanup() })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-discovery-'))
  dispose.push(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new AgentOsStore(root, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  dispose.push(() => { store.close() })
  const views: WebContentsView[] = []
  const window = {
    isDestroyed: () => false,
    contentView: { addChildView: (view: WebContentsView) => { views.push(view) }, removeChildView: vi.fn() },
  }
  let currentWindow = window
  const events: AgentOsEvent[] = []
  const browser = new AgentOsBrowser(() => currentWindow as unknown as BrowserWindow, (event) => { events.push(event) }, store)
  dispose.push(() => { browser.dispose() })
  return {
    browser, events, views, window,
    replaceWindow: () => {
      currentWindow = { ...window, contentView: { ...window.contentView, removeChildView: vi.fn() } }
      return currentWindow
    },
  }
}

const bounds = { x: 0, y: 0, width: 600, height: 500 }

async function navigate(browser: AgentOsBrowser, sessionId: string, tabId: string) {
  const count = navigation.urls.length
  const result = browser.act(sessionId, { action: 'open', tabId, url: 'https://example.test/' }, true)
  await vi.waitFor(() => { expect(navigation.urls).toHaveLength(count + 1) })
  navigation.release()
  return result
}

it('does not abort a tool navigation when its visible pane mounts, and keeps its owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-navigation-'))
  const store = new AgentOsStore(root, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const window = { isDestroyed: () => false, contentView: { addChildView: () => {}, removeChildView: () => {} } }
  let mounted: Promise<unknown> | undefined
  const browser = new AgentOsBrowser(() => window as unknown as BrowserWindow, (event) => {
    if (event.type === 'browser.open') {
      mounted = browser.mount(event.sessionId, event.tabId, { x: 0, y: 0, width: 600, height: 500 }, true, event.url)
    }
  }, store)
  try {
    const opening = browser.act('chat-one', { action: 'open', url: 'https://example.test/' })
    await mounted
    await vi.waitFor(() => { expect(navigation.urls).toEqual(['https://example.test/']) })
    navigation.release()
    const result = await opening
    expect(result).toMatchObject({ text: 'Fixture ready', state: { sessionId: 'chat-one', url: 'https://example.test/' } })
    const tab = browser.list('chat-one')[0]
    expect(tab).toBeDefined()
    if (tab === undefined) throw new Error('Expected the created tab')
    await expect(browser.act('chat-two', { action: 'observe', tabId: tab.tabId })).rejects.toThrow('another chat')
  } finally { browser.dispose(); store.close(); rmSync(root, { recursive: true, force: true }) }
})

it('discovers a manually opened page without a tab ID and does not duplicate its sidebar carrier', async () => {
  const { browser, events } = fixture()
  await browser.mount('chat-one', 'native-chat-one-tab2', bounds, true)
  await navigate(browser, 'chat-one', 'native-chat-one-tab2')
  expect(events.filter(event => event.type === 'browser.open')).toEqual([])
  await expect(browser.act('chat-one', { action: 'observe' })).resolves.toMatchObject({
    state: { tabId: 'native-chat-one-tab2', url: 'https://example.test/', visible: true }, text: 'Fixture ready',
  })
  expect(await browser.act('chat-one', { action: 'list' })).toMatchInlineSnapshot(`
    {
      "tabs": [
        {
          "canGoBack": false,
          "canGoForward": false,
          "loading": false,
          "recording": false,
          "revision": 2,
          "sessionId": "chat-one",
          "tabId": "native-chat-one-tab2",
          "takenOver": false,
          "title": "Fixture",
          "url": "https://example.test/",
          "visible": true,
        },
      ],
    }
  `)
})

it('resolves the visible tab, and requires an explicit choice when several panes are visible', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'first', bounds, true)
  await browser.mount('chat-one', 'second', bounds, false)
  await expect(browser.act('chat-one', { action: 'observe' })).resolves.toMatchObject({ state: { tabId: 'first' } })
  browser.hide('first')
  await browser.mount('chat-one', 'second', bounds, true)
  await expect(browser.act('chat-one', { action: 'observe' })).resolves.toMatchObject({ state: { tabId: 'second' } })
  await browser.mount('chat-one', 'first', bounds, true)
  await expect(browser.act('chat-one', { action: 'observe' })).rejects.toThrow('Several browser tabs')
  await expect(browser.act('chat-one', { action: 'observe', tabId: 'second' })).resolves.toMatchObject({ state: { tabId: 'second' } })
})

it('keeps discovery isolated between chats even when their local sidebar tab numbers match', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'native-chat-one-tab2', bounds, true)
  await browser.mount('chat-two', 'native-chat-two-tab2', bounds, true)
  await expect(browser.act('chat-two', { action: 'observe' })).resolves.toMatchObject({ state: { tabId: 'native-chat-two-tab2' } })
  expect(browser.list('chat-two').map(tab => tab.tabId)).toEqual(['native-chat-two-tab2'])
  await expect(browser.act('chat-two', { action: 'observe', tabId: 'native-chat-one-tab2' })).rejects.toThrow('another chat')
  await expect(browser.act('empty-chat', { action: 'observe' })).rejects.toThrow('No browser tab is open in this chat')
  await expect(browser.act('empty-chat', { action: 'list' })).resolves.toEqual({ tabs: [] })
})

it('fills a credential only on its exact site with a fresh observation and respects takeover', async () => {
  const { browser } = fixture()
  await browser.mount('chat', 'login', bounds, true)
  await navigate(browser, 'chat', 'login')
  const state = browser.list('chat')[0]!
  await expect(browser.fillCredential('other', 'login', 'https://example.test', 'alice', 'fixture', { revision: state.revision })).rejects.toThrow('another chat')
  await expect(browser.fillCredential('chat', 'login', 'https://wrong.test', 'alice', 'fixture', { revision: state.revision })).rejects.toThrow('different website')
  await expect(browser.fillCredential('chat', 'login', 'https://example.test', 'alice', 'fixture', { revision: state.revision - 1 })).rejects.toThrow('observe')
  await browser.act('chat', { action: 'takeover', tabId: 'login' }, true)
  await expect(browser.fillCredential('chat', 'login', 'https://example.test', 'alice', 'fixture', { revision: browser.list('chat')[0]!.revision })).rejects.toThrow('Resume')
  await browser.act('chat', { action: 'resume', tabId: 'login' }, true)
  const revision = browser.list('chat')[0]!.revision
  await browser.fillCredential('chat', 'login', 'https://example.test', 'alice', 'fixture', { revision })
  expect(browser.list('chat')[0]!.revision).toBe(revision + 1)
  const cancellation = new AbortController(); cancellation.abort(new Error('Cancelled fixture'))
  await expect(browser.fillCredential('chat', 'login', 'https://example.test', 'alice', 'fixture', { revision: revision + 1, signal: cancellation.signal })).rejects.toThrow('Cancelled fixture')
})

it('allows observing the only hidden tab but never returns a closed one', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'only-tab', bounds, true)
  browser.hide('only-tab')
  await expect(browser.act('chat-one', { action: 'observe' })).resolves.toMatchObject({ state: { visible: false } })
  browser.close('only-tab')
  await expect(browser.act('chat-one', { action: 'observe' })).rejects.toThrow('No browser tab')
  expect(browser.list('chat-one')).toEqual([])
})

it('can read during human takeover but still rejects agent mutations', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'only-tab', bounds, true)
  await browser.act('chat-one', { action: 'takeover', tabId: 'only-tab' }, true)
  await expect(browser.act('chat-one', { action: 'observe' })).resolves.toMatchObject({ state: { takenOver: true } })
  await expect(browser.act('chat-one', { action: 'reload', tabId: 'only-tab' })).rejects.toThrow('taken control')
})

it('clicks a canvas point relative to its observed viewport and rejects stale or out-of-bounds points', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'canvas-tab', bounds, true)
  const command = { action: 'click_point' as const, tabId: 'canvas-tab', x: 0.5, y: 0.25, revision: 0 }
  await expect(browser.act('chat-one', command)).resolves.toMatchObject({ viewport: { width: 600, height: 500 } })
  expect(navigation.inputs).toEqual([
    { type: 'mouseMoved', x: 300, y: 125 },
    { type: 'mousePressed', x: 300, y: 125, button: 'left', clickCount: 1 },
    { type: 'mouseReleased', x: 300, y: 125, button: 'left', clickCount: 1 },
  ])
  await expect(browser.act('chat-one', command)).rejects.toThrow('page changed')
  const revision = browser.list('chat-one')[0]?.revision ?? 0
  await expect(browser.act('chat-one', { ...command, revision, x: 1.1 })).rejects.toThrow('between 0 and 1')
  expect(navigation.inputs).toHaveLength(3)
})

it('releases a held movement key when the user takes over', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'canvas-tab', bounds, true)
  const held = browser.act('chat-one', { action: 'key', tabId: 'canvas-tab', key: 'w', holdMs: 1000 })
  const rejected = expect(held).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => { expect(navigation.inputs).toMatchObject([{ type: 'keyDown', key: 'w', code: 'KeyW' }]) })
  await browser.act('chat-one', { action: 'takeover', tabId: 'canvas-tab' }, true)
  await rejected
  expect(navigation.inputs).toMatchObject([{ type: 'keyDown', key: 'w' }, { type: 'keyUp', key: 'w' }])
})

it('releases held keys on task cancellation and refuses unsafe keys or excessive holds', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'canvas-tab', bounds, true)
  const controller = new AbortController()
  const held = browser.act('chat-one', { action: 'key', tabId: 'canvas-tab', key: 'Space', holdMs: 1000 }, false, controller.signal)
  const rejected = expect(held).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => { expect(navigation.inputs).toMatchObject([{ type: 'keyDown', key: ' ', code: 'Space' }]) })
  controller.abort()
  await rejected
  expect(navigation.inputs).toMatchObject([{ type: 'keyDown', key: ' ' }, { type: 'keyUp', key: ' ' }])
  await expect(browser.act('chat-one', { action: 'key', tabId: 'canvas-tab', key: 'Cmd+Q' })).rejects.toThrow('Unsupported key')
  await expect(browser.act('chat-one', { action: 'key', tabId: 'canvas-tab', key: 'a', holdMs: 1001 })).rejects.toThrow('between 0 and 1000')
  expect(navigation.inputs).toHaveLength(2)
})

it('waits for the arrow key release acknowledgement before returning its observation', async () => {
  const { browser } = fixture()
  await browser.mount('chat-one', 'canvas-tab', bounds, true)
  let acknowledge = () => {}
  navigation.acknowledge = event => event.type === 'keyUp'
    ? new Promise<void>((resolve) => { acknowledge = resolve })
    : Promise.resolve()
  let observed = false
  const result = browser.act('chat-one', { action: 'key', tabId: 'canvas-tab', key: 'ArrowRight' })
    .then(() => { observed = true })
  try {
    await vi.waitFor(() => { expect(navigation.inputs).toHaveLength(2) })
    expect(navigation.inputs).toEqual([
      { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 0 },
      { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 0 },
    ])
    expect(observed).toBe(false)
  } finally {
    acknowledge()
    await result
  }
  expect(observed).toBe(true)
})


it('reports a crashed renderer, rejects stale queued input, and only navigates again on request', async () => {
  const { browser, views, events } = fixture()
  await browser.mount('chat-one', 'crash-tab', bounds, true)
  const contents = views[0]!.webContents
  const opening = browser.act('chat-one', { action: 'open', tabId: 'crash-tab', url: 'https://example.test/' })
  const settled = opening.catch((error: unknown) => error)
  await vi.waitFor(() => { expect(navigation.urls).toHaveLength(1) })
  const queued = browser.act('chat-one', { action: 'key', tabId: 'crash-tab', key: 'Enter' })
  const queuedSettled = queued.catch((error: unknown) => error)
  const queuedOpen = browser.act('chat-one', { action: 'open', tabId: 'crash-tab', url: 'https://queued.test/' }).catch((error: unknown) => error)
  try {
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(events.at(-1)).toMatchObject({ type: 'browser', state: { error: 'This page stopped unexpectedly. Reload it to continue.', loading: false } })
    await expect(settled).resolves.toBeInstanceOf(Error)
    await expect(queuedSettled).resolves.toBeInstanceOf(Error)
    await expect(queuedOpen).resolves.toBeInstanceOf(Error)
    expect(navigation.inputs).toEqual([])
    expect(navigation.urls).toEqual(['https://example.test/'])
    await expect(browser.act('chat-one', { action: 'observe', tabId: 'crash-tab' })).rejects.toThrow('Reload')
    await expect(browser.act('chat-two', { action: 'open', tabId: 'crash-tab', url: 'https://example.test/' })).rejects.toThrow('another chat')
    const recovered = navigate(browser, 'chat-one', 'crash-tab')
    await expect(recovered).resolves.toMatchObject({ text: 'Fixture ready', state: { sessionId: 'chat-one', tabId: 'crash-tab' } })
    expect(browser.list('chat-one')[0]?.error).toBeUndefined()
    expect(navigation.inputs).toEqual([])
  } finally {
    navigation.release()
    await Promise.all([settled, queuedSettled, queuedOpen])
  }
})

it('detaches a closed view from its creating window after the active window changes', async () => {
  const { browser, views, window, replaceWindow } = fixture()
  await browser.mount('chat-one', 'old-window-tab', bounds, true)
  const replacement = replaceWindow()
  browser.close('old-window-tab')
  expect(window.contentView.removeChildView).toHaveBeenCalledExactlyOnceWith(views[0])
  expect(replacement.contentView.removeChildView).not.toHaveBeenCalled()
  expect(browser.list('chat-one')).toEqual([])
})


it('reloads the requested URL after a crash during first navigation and preserves human control', async () => {
  const { browser, views } = fixture()
  await browser.mount('chat-one', 'reload-tab', bounds, true)
  const opening = browser.act('chat-one', { action: 'open', tabId: 'reload-tab', url: 'https://example.test/' }).catch((error: unknown) => error)
  await vi.waitFor(() => { expect(navigation.urls).toHaveLength(1) })
  views[0]!.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  await expect(opening).resolves.toBeInstanceOf(Error)
  await browser.act('chat-one', { action: 'takeover', tabId: 'reload-tab' }, true)
  await expect(browser.act('chat-one', { action: 'reload', tabId: 'reload-tab' })).rejects.toThrow('taken control')
  expect(browser.list('chat-one')[0]?.error).toContain('Reload')
  const reload = browser.act('chat-one', { action: 'reload', tabId: 'reload-tab' }, true)
  try {
    await vi.waitFor(() => { expect(navigation.urls).toEqual(['https://example.test/', 'https://example.test/']) })
  } finally { navigation.release() }
  await expect(reload).resolves.toMatchObject({ state: { tabId: 'reload-tab', takenOver: true, url: 'https://example.test/' } })
  expect(browser.list('chat-one')[0]?.error).toBeUndefined()
})

it.each(['crash', 'close', 'cancel'] as const)('settles a blocked page read on %s and ignores its late result', async (ending) => {
  const { browser, views, events } = fixture()
  await browser.mount('chat-one', 'read-tab', bounds, true)
  const contents = views[0]!.webContents
  const started = Promise.withResolvers<undefined>()
  const blocked = Promise.withResolvers<unknown>()
  vi.spyOn(contents, 'executeJavaScriptInIsolatedWorld').mockImplementationOnce(() => { started.resolve(undefined); return blocked.promise })
  const controller = new AbortController()
  const read = browser.act('chat-one', { action: 'observe', tabId: 'read-tab' }, false, controller.signal).catch((error: unknown) => error)
  await started.promise
  try {
    if (ending === 'crash') contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    else if (ending === 'close') browser.close('read-tab')
    else controller.abort(new Error('Fixture task cancelled.'))
    await expect(read).resolves.toBeInstanceOf(Error)
    const published = events.length
    blocked.resolve({ text: 'Stale read', elements: [], viewport: { width: 600, height: 500 } })
    await blocked.promise
    await Promise.resolve()
    expect(events).toHaveLength(published)
    expect(navigation.inputs).toEqual([])
  } finally {
    blocked.resolve({ text: 'Fixture cleanup', elements: [] })
    await read
  }
})

it('keeps a usable viewport for background tasks without a mounted sidebar', async () => {
  const { browser } = fixture()
  const opening = browser.act('background-task', { action: 'open', url: 'https://example.test/' })
  await vi.waitFor(() => { expect(navigation.urls).toContain('https://example.test/') })
  navigation.release(); await opening
  const tab = browser.list('background-task')[0]
  if (!tab) throw new Error('Background tab is missing')
  expect(navigation.bounds).toContainEqual({ x: 0, y: 0, width: 1024, height: 768 })
  await browser.mount('background-task', tab.tabId, { x: 0, y: 0, width: 0, height: 0 }, false)
  expect(navigation.bounds.at(-1)).toEqual({ x: 0, y: 0, width: 1024, height: 768 })
})
