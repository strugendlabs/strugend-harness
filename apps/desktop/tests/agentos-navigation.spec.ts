/** Redirect cancellation must not hide a successful destination or accept a stale page. */
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { loadWebsite } from '../src/agentos-navigation.ts'

function fixture() {
  const events = new EventEmitter()
  const loadURL = vi.fn<(url: string) => Promise<void>>()
  const stop = vi.fn()
  const contents = Object.assign(events, { loadURL, stop, isDestroyed: () => false })
  return { events, loadURL, stop, contents: contents as unknown as WebContents }
}

afterEach(() => { vi.useRealTimers() })

it('waits for the replacement document after ERR_ABORTED', async () => {
  const { contents, events, loadURL } = fixture()
  loadURL.mockRejectedValue(new Error('ERR_ABORTED (-3)'))
  const settled = vi.fn()
  const pending = loadWebsite(contents, 'https://example.test/start').then(settled)
  await Promise.resolve()
  events.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://example.test/start', true)
  events.emit('did-finish-load')
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  events.emit('did-navigate', {}, 'https://example.test/redirected')
  events.emit('did-finish-load')
  await pending
  expect(settled).toHaveBeenCalledOnce()
  expect(events.eventNames()).toEqual([])
})

it('handles a replacement completing before the original rejection is delivered', async () => {
  const { contents, events, loadURL } = fixture()
  loadURL.mockImplementation(() => {
    events.emit('did-navigate', {}, 'https://example.test/final')
    events.emit('did-finish-load')
    return Promise.reject(new Error('ERR_ABORTED (-3)'))
  })
  await loadWebsite(contents, 'https://example.test/start')
  expect(events.eventNames()).toEqual([])
})

it('ignores failed subresources but reports a failed main-frame redirect', async () => {
  const { contents, events, loadURL } = fixture()
  loadURL.mockRejectedValue(new Error('ERR_ABORTED (-3)'))
  const pending = loadWebsite(contents, 'https://example.test/start')
  const rejected = expect(pending).rejects.toMatchObject({ message: 'ERR_NAME_NOT_RESOLVED', url: 'https://missing.test/' })
  events.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://image.test/', false)
  expect(events.listenerCount('did-finish-load')).toBe(1)
  events.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://missing.test/', true)
  await rejected
  expect(events.eventNames()).toEqual([])
})

it('does not convert a genuine loadURL failure into a successful old page', async () => {
  const { contents, events, loadURL } = fixture()
  loadURL.mockRejectedValue(new Error('ERR_CERT_AUTHORITY_INVALID'))
  await expect(loadWebsite(contents, 'https://example.test/')).rejects.toThrow('ERR_CERT_AUTHORITY_INVALID')
  expect(events.eventNames()).toEqual([])
})

it('bounds a cancelled navigation that never commits a replacement', async () => {
  vi.useFakeTimers()
  const { contents, events, loadURL, stop } = fixture()
  loadURL.mockRejectedValue(new Error('ERR_ABORTED (-3)'))
  const pending = loadWebsite(contents, 'https://example.test/')
  const rejected = expect(pending).rejects.toThrow('ERR_TIMED_OUT')
  await vi.advanceTimersByTimeAsync(30_000)
  await rejected
  expect(stop).toHaveBeenCalledOnce()
  expect(events.eventNames()).toEqual([])
})

it('stops pending navigation when the calling tool is cancelled', async () => {
  const { contents, events, loadURL, stop } = fixture()
  loadURL.mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const pending = loadWebsite(contents, 'https://example.test/', controller.signal)
  const rejected = expect(pending).rejects.toThrow('User stopped the task')
  controller.abort(new Error('User stopped the task'))
  await rejected
  expect(stop).toHaveBeenCalledOnce()
  expect(events.eventNames()).toEqual([])
})

it('settles and removes listeners when the tab is destroyed', async () => {
  const { contents, events, loadURL } = fixture()
  loadURL.mockReturnValue(new Promise(() => {}))
  const pending = loadWebsite(contents, 'https://example.test/')
  const rejected = expect(pending).rejects.toThrow('tab was closed')
  events.emit('destroyed')
  await rejected
  expect(events.eventNames()).toEqual([])
})
