/** Native targets retain conversation identity and outlive any one sidebar occurrence. */
import { expect, it, vi } from 'vitest'
import type { AgentOsDesktopApi, AgentOsEvent } from '@deepseek-ai/dsh-agentos-protocol'
import { createDesktopBrowser, desktopTabId } from '../src/client/browser/DesktopBrowser.ts'

function fixture() {
  let emit: (event: AgentOsEvent) => void = () => {}
  const request = vi.fn<AgentOsDesktopApi['request']>().mockResolvedValue(undefined)
  const unsubscribe = vi.fn()
  const api: AgentOsDesktopApi = { request, subscribe: (listener) => { emit = listener; return unsubscribe } }
  return { controller: createDesktopBrowser(api), request, unsubscribe, emit: (event: AgentOsEvent) => { emit(event) } }
}

it('namespaces repeated sidebar record numbers by their owning chat', () => {
  expect(desktopTabId('chat-one', 'tab2')).not.toBe(desktopTabId('chat-two', 'tab2'))
  expect(desktopTabId('chat-one', 'tab2', 'agent-created-target')).toBe('agent-created-target')
})

it('keeps a shared native target alive until its final sidebar occurrence closes', () => {
  const { controller, request } = fixture()
  const first = new AbortController()
  const second = new AbortController()
  controller.ownDesktopTab('target', first.signal)
  controller.ownDesktopTab('target', first.signal)
  controller.ownDesktopTab('target', second.signal)
  first.abort()
  expect(request).not.toHaveBeenCalled()
  second.abort()
  expect(request.mock.calls).toEqual([[{ type: 'browser.close', tabId: 'target' }]])
  controller.dispose()
})

it('removes stale close listeners when the controller unloads', () => {
  const { controller, request, unsubscribe } = fixture()
  const lifetime = new AbortController()
  controller.ownDesktopTab('target', lifetime.signal)
  controller.dispose()
  lifetime.abort()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(request).not.toHaveBeenCalled()
})
