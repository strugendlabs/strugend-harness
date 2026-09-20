// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { AgentOsDesktopApi, AgentOsEvent, DesktopBrowserState } from '@deepseek-ai/dsh-agentos-protocol'
import { createDesktopBrowser } from '../src/client/browser/DesktopBrowser.ts'
import { createBrowserStore } from '../src/client/browser/store.ts'
import { DesktopBrowserBody } from '../src/client/view/DesktopBrowserBody.tsx'
import { en } from '../src/client/locales.ts'

const TAB = 'native-persistence' as TabId
function hookOf<T>(source: { subscribe(listener: () => void): () => void; getSnapshot(): T }) {
  return function useSelector<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot()))
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('resumes the last committed native address after renderer recreation and ignores failed or unfinished loads', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const store = createBrowserStore().create('native-browser-persistence-test')
  const lifetime = new AbortController()
  const request = vi.fn<AgentOsDesktopApi['request']>().mockResolvedValue(undefined)
  let emit: (event: AgentOsEvent) => void = () => {}
  const controllers: ReturnType<typeof createDesktopBrowser>[] = []
  const mount = () => {
    const controller = createDesktopBrowser({ request, subscribe: (listener) => { emit = listener; return () => {} } })
    controllers.push(controller)
    const { hooks, ...commands } = controller
    const props = {
      useTabInfo: () => ({
        tab: {
          id: TAB, kind: 'browser', title: 'Browser', visible: true, signal: lifetime.signal,
          navigation: { address: 'sidebar://browser/1', params: undefined, revision: 0 },
        },
      }),
      ...commands,
      desktopSessionId: 'native-chat',
      useStore: hookOf(store), actions: store.actions,
      useDesktopBrowser: hookOf(hooks.desktopBrowser),
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof DesktopBrowserBody>
    const view = render(<DesktopBrowserBody {...props} />)
    const viewport = view.container.querySelector('[data-agent-os-browser]')!.lastElementChild!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 800, y: 100, width: 600, height: 500 } as DOMRect)
    return view
  }
  try {
    const view = mount()
    const state: DesktopBrowserState = {
      tabId: 'native-native-chat-native-persistence', sessionId: 'native-chat',
      url: 'https://example.com/finished', title: 'Finished page', revision: 1,
      loading: false, canGoBack: false, canGoForward: false, takenOver: false, recording: false, visible: true,
    }
    act(() => { emit({ type: 'browser', state }) })
    await waitFor(() => { expect(store.getSnapshot().byTab[TAB]?.entries).toEqual([
      { kind: 'https', url: state.url, title: state.title },
    ]) })
    act(() => { emit({ type: 'browser', state: { ...state, url: 'https://example.com/pending', loading: true } }) })
    act(() => { emit({ type: 'browser', state: { ...state, url: 'https://example.com/broken', error: 'Page unavailable' } }) })
    expect(store.getSnapshot().byTab[TAB]?.entries).toMatchInlineSnapshot(`
      [
        {
          "kind": "https",
          "title": "Finished page",
          "url": "https://example.com/finished",
        },
      ]
    `)
    view.unmount()
    controllers[0]!.dispose()
    request.mockClear()
    mount()
    await waitFor(() => { expect(request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'browser.mount', sessionId: 'native-chat', url: state.url,
    })) })
  } finally {
    cleanup()
    for (const controller of controllers) controller.dispose()
    lifetime.abort()
  }
})

function viewportFixture() {
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  let resized = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {}
    disconnect() {}
  })
  const store = createBrowserStore().create('native-browser-placement-test')
  const lifetime = new AbortController()
  const request = vi.fn<AgentOsDesktopApi['request']>().mockResolvedValue(undefined)
  const controller = createDesktopBrowser({ request, subscribe: () => () => {} })
  const { hooks, ...commands } = controller
  const props = {
    useTabInfo: () => ({ tab: {
      id: TAB, kind: 'browser', title: 'Browser', visible: true, signal: lifetime.signal,
      navigation: { address: 'sidebar://browser/1', params: undefined, revision: 0 },
    } }),
    ...commands, desktopSessionId: 'native-chat',
    useStore: hookOf(store), actions: store.actions, useDesktopBrowser: hookOf(hooks.desktopBrowser),
    t: (key: keyof typeof en) => en[key],
  } as unknown as ComponentProps<typeof DesktopBrowserBody>
  const view = render(<DesktopBrowserBody {...props} />)
  const viewport = view.container.querySelector('[data-agent-os-browser]')!.lastElementChild!
  let bounds = { x: 800, y: 100, width: 600, height: 500 }
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => bounds as DOMRect)
  const flush = async () => {
    await act(async () => {
      // Deliver MutationObserver callbacks before the next browser frame.
      await Promise.resolve()
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(0)
      await Promise.resolve()
    })
  }
  return {
    view, request, flush,
    resize: (value: typeof bounds) => { bounds = value; resized() },
    dispose: () => { view.unmount(); controller.dispose(); lifetime.abort() },
  }
}

it('does not reposition an unchanged native pane for streaming chat mutations', async () => {
  const fixture = viewportFixture()
  const stream = document.createElement('div')
  document.body.append(stream)
  try {
    await fixture.flush()
    for (let index = 0; index < 120; index++) {
      stream.replaceChildren(document.createTextNode(`Streaming update ${index}`))
      await fixture.flush()
    }
    expect(fixture.request.mock.calls.filter(([command]) => command.type === 'browser.mount')).toHaveLength(1)
  } finally { stream.remove(); fixture.dispose() }
})

it('updates changed bounds, yields to overlays, and hides zero-sized panes until they are measurable', async () => {
  const fixture = viewportFixture()
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'dialog')
  try {
    await fixture.flush()
    fixture.resize({ x: 799.8, y: 100.2, width: 600.1, height: 500.2 })
    await fixture.flush()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    fixture.resize({ x: 750, y: 100, width: 650, height: 500 })
    await fixture.flush()
    expect(fixture.request).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'browser.mount', bounds: { x: 750, y: 100, width: 650, height: 500 }, visible: true,
    }))
    document.body.append(overlay)
    await fixture.flush()
    expect(fixture.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser.mount', visible: false }))
    overlay.remove()
    await fixture.flush()
    expect(fixture.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser.mount', visible: true }))
    fixture.resize({ x: 0, y: 0, width: 0, height: 0 })
    await fixture.flush()
    expect(fixture.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser.hide' }))
    const hiddenCalls = fixture.request.mock.calls.length
    fixture.resize({ x: 0, y: 0, width: 0, height: 0 })
    await fixture.flush()
    expect(fixture.request).toHaveBeenCalledTimes(hiddenCalls)
    fixture.resize({ x: 750, y: 100, width: 650, height: 500 })
    await fixture.flush()
    expect(fixture.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'browser.mount', visible: true }))
    fixture.resize({ x: 750, y: 100, width: 700, height: 500 })
    fixture.view.unmount()
    const closedCalls = fixture.request.mock.calls.length
    await fixture.flush()
    expect(fixture.request).toHaveBeenCalledTimes(closedCalls)
  } finally { overlay.remove(); fixture.dispose() }
})

it('does not replace a newer navigation with an older request failure', async () => {
  const fixture = viewportFixture()
  let rejectOld = (_reason: Error) => {}
  try {
    await fixture.flush()
    fixture.request.mockImplementation(command => command.type === 'browser.action'
      && command.command.action === 'open' && command.command.url === 'https://old.test/'
      ? new Promise((_resolve, reject) => { rejectOld = reject })
      : Promise.resolve(undefined))
    const input = fixture.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'https://old.test/' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.change(input, { target: { value: 'https://new.test/' } })
    fireEvent.submit(input.closest('form')!)
    await act(async () => { rejectOld(new Error('Old request failed')) })
    expect(fixture.view.queryByRole('alert')).toBeNull()
  } finally { fixture.dispose() }
})
