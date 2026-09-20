/** Cancellation settles only after the isolated native worker has exited. */
import { EventEmitter } from 'node:events'
import { fork } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentOsCrawler } from '../src/agentos-crawler.ts'

vi.mock('node:child_process', () => ({ fork: vi.fn() }))

class Worker extends EventEmitter {
  kill = vi.fn(() => true)
  send = vi.fn((_value: unknown, callback: (error: Error | null) => void) => { callback(null) })
}

const workers: Worker[] = []
afterEach(() => {
  for (const child of workers.splice(0)) child.emit('close', 1)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function worker(): Worker {
  const child = new Worker()
  workers.push(child)
  vi.mocked(fork).mockReturnValueOnce(child as unknown as ReturnType<typeof fork>)
  return child
}

it('waits for exit before returning a result', async () => {
  const child = worker()
  const crawler = new AgentOsCrawler()
  const run = crawler.run({ url: 'https://example.com' })
  let settled = false
  void run.then(() => { settled = true }).catch(() => {})
  const result = { engine: 'Spider (Rust)', pages: [], url: 'https://example.com/' }
  child.emit('message', { result })
  await Promise.resolve()
  expect(settled).toBe(false)
  child.emit('close', 0)
  await expect(run).resolves.toEqual(result)
  await crawler.dispose()
})

it('cancels in-flight work and waits for close instead of leaving a native worker', async () => {
  const child = worker()
  const controller = new AbortController()
  const crawler = new AgentOsCrawler()
  const run = crawler.run({ url: 'https://example.com' }, controller.signal)
  const result = expect(run).rejects.toThrow('cancelled')
  let exited = false
  void run.catch(() => { exited = true })
  controller.abort()
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  await Promise.resolve()
  expect(exited).toBe(false)
  child.emit('close', null)
  await result
  await crawler.dispose()
})

it('drains both workers at shutdown and refuses further work', async () => {
  const first = worker()
  const second = worker()
  const crawler = new AgentOsCrawler()
  const one = crawler.run({ url: 'https://example.com' }).catch((error: unknown) => error)
  const two = crawler.run({ url: 'https://example.net' }).catch((error: unknown) => error)
  await expect(crawler.run({ url: 'https://example.org' })).rejects.toThrow('Two crawls')
  const closing = crawler.dispose()
  await expect(crawler.run({ url: 'https://example.org' })).rejects.toThrow('shutting down')
  expect(first.kill).toHaveBeenCalled()
  expect(second.kill).toHaveBeenCalled()
  first.emit('close', null)
  second.emit('close', null)
  await closing
  expect(await one).toBeInstanceOf(Error)
  expect(await two).toBeInstanceOf(Error)
})

it('reports a deadline even if a killed worker later emits a successful result', async () => {
  vi.useFakeTimers()
  const child = worker()
  const crawler = new AgentOsCrawler()
  const result = expect(crawler.run({ url: 'https://example.com', timeoutMs: 10 })).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(10)
  child.emit('message', { result: { engine: 'Spider (Rust)', pages: [] } })
  child.emit('close', 0)
  await result
  await crawler.dispose()
})

it('rejects an invalid native response instead of returning it to the model', async () => {
  const child = worker()
  const crawler = new AgentOsCrawler()
  const result = expect(crawler.run({ url: 'https://example.com' })).rejects.toThrow('Invalid crawler response')
  child.emit('message', { result: { engine: 'unexpected', pages: [] } })
  child.emit('close', 0)
  await result
  await crawler.dispose()
})
