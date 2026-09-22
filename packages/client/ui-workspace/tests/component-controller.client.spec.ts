import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentController, parseComponentSnapshot, type ComponentSnapshot } from '../src/client/component-controller.ts'

function snapshot(state: 'absent' | 'downloading' | 'installed' = 'absent'): ComponentSnapshot {
  return { setupComplete: false, localAllowed: true, localReason: '', components: [{ id: 'decision', state, version: '1', downloadBytes: 100, installedBytes: 200, progressBytes: state === 'installed' ? 100 : 0, available: true }] }
}
const response = (value: unknown): Response => new Response(JSON.stringify(value))
afterEach(() => { vi.useRealTimers() })

describe('optional tools status', () => {
  it('does no idle polling and downloads nothing when loading the catalog', async () => {
    vi.useFakeTimers()
    const request = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async () => response(snapshot()))
    const controller = new ComponentController(request)
    await controller.load()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe('/api/strugend/components')
    controller.dispose()
  })

  it('polls downloads until their installation commits', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValueOnce(response(snapshot('downloading'))).mockResolvedValueOnce(response(snapshot('installed')))
    const controller = new ComponentController(request)
    await controller.load()
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.store.getSnapshot().value?.components[0]?.state).toBe('installed')
    await vi.advanceTimersByTimeAsync(5000)
    expect(request).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('does not replace an accepted setup choice with an older catalog read', async () => {
    let release!: (value: Response) => void
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(response({ ...snapshot(), setupComplete: true }))
    const controller = new ComponentController(request)
    const loading = controller.load()
    expect(await controller.setup('skip')).toBe(true)
    release(response(snapshot()))
    await loading
    expect(controller.store.getSnapshot().value?.setupComplete).toBe(true)
    expect(request.mock.calls[1]?.[1].body).toBe('{"decision":"skip"}')
    controller.dispose()
  })

  it('keeps catalog reads behind an active installation change', async () => {
    let release!: (value: Response) => void
    const request = vi.fn().mockResolvedValueOnce(response(snapshot()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
    const controller = new ComponentController(request)
    await controller.load()
    const installing = controller.change('decision', 'install')
    await controller.load()
    expect(request).toHaveBeenCalledTimes(2)
    release(response(snapshot('downloading')))
    expect(await installing).toBe(true)
    expect(controller.store.getSnapshot().value?.components[0]?.state).toBe('downloading')
    controller.dispose()
  })

  it('cancels reads on disposal and exposes failures without losing installed state', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(snapshot('installed'))).mockRejectedValueOnce(new Error('offline'))
    const controller = new ComponentController(request)
    await controller.load()
    expect(await controller.change('decision', 'remove')).toBe(false)
    expect(controller.store.getSnapshot().value?.components[0]?.state).toBe('installed')
    expect(controller.store.getSnapshot().error).toBe('offline')
    const signal = request.mock.calls[0]?.[1].signal as AbortSignal
    controller.dispose()
    expect(signal.aborted).toBe(true)
  })

  it('rejects duplicate components and invalid progress from the wire', () => {
    expect(() => parseComponentSnapshot({ ...snapshot(), components: [...snapshot().components, ...snapshot().components] })).toThrow('Invalid optional tool')
    expect(() => parseComponentSnapshot({ ...snapshot(), components: [{ ...snapshot().components[0], progressBytes: -1 }] })).toThrow('Invalid optional tool')
  })
})
