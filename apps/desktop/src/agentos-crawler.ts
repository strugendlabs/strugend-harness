/** Owns isolated Rust crawler processes and drains them on cancel or app shutdown. */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { CrawlResult } from './agentos-crawl-contract.ts'
import { resolveCrawl } from './agentos-crawl-contract.ts'

/** Desktop lifetime owner for bounded, cancellable website reads. */
export class AgentOsCrawler {
  private readonly running = new Map<AbortController, Promise<CrawlResult>>()
  private closing = false

  /** @param input - Tool request. @param signal - Tool cancellation. @returns Pages after worker exit. */
  run(input: unknown, signal?: AbortSignal): Promise<CrawlResult> {
    if (this.closing)
      return Promise.reject(new Error('The crawler is shutting down.'))
    if (this.running.size >= 2)
      return Promise.reject(
        new Error('Two crawls are already running. Wait for one to finish.'),
      )
    signal?.throwIfAborted()
    const spec = resolveCrawl(input)
    const lifetime = new AbortController()
    const abort = (): void => {
      lifetime.abort(new Error('Crawl cancelled.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    const operation = new Promise<CrawlResult>((resolve, reject) => {
      const child = fork(
        fileURLToPath(new URL('./agentos-crawl-worker.js', import.meta.url)),
        [],
        {
          execArgv: [],
          env: {
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
            ELECTRON_RUN_AS_NODE: '1',
            DSH_DESKTOP_HOST_PORT: process.env.DSH_DESKTOP_HOST_PORT,
          },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      let result: CrawlResult | undefined
      let failure: Error | undefined
      const stop = (): void => {
        failure =
          lifetime.signal.reason instanceof Error
            ? lifetime.signal.reason
            : new Error('Crawl cancelled.')
        child.kill('SIGKILL')
      }
      lifetime.signal.addEventListener('abort', stop, { once: true })
      const timer = setTimeout(() => {
        lifetime.abort(
          new Error(
            'Crawl timed out. Try fewer pages or use the visible browser.',
          ),
        )
      }, spec.timeoutMs)
      child.on('message', (input: unknown) => {
        if (typeof input !== 'object' || input === null) {
          failure = new Error('Invalid crawler response.')
          return
        }
        const message = input as { result?: CrawlResult; error?: string }
        if (message.error !== undefined) failure = new Error(message.error)
        else if (
          message.result?.engine === 'Spider (Rust)' &&
          Array.isArray(message.result.pages) &&
          Buffer.byteLength(JSON.stringify(message.result)) <= 100_000
        )
          result = message.result
        else failure = new Error('Invalid crawler response.')
      })
      child.on('error', (error) => {
        failure = error
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        lifetime.signal.removeEventListener('abort', stop)
        if (failure !== undefined) reject(failure)
        else if (code !== 0 || result === undefined)
          reject(
            new Error(
              'The Rust crawler exited without a result. Check its installed native dependency.',
            ),
          )
        else resolve(result)
      })
      child.send(spec, (error) => {
        if (error !== null) {
          failure = error
          child.kill('SIGKILL')
        }
      })
    })
    this.running.set(lifetime, operation)
    void operation
      .finally(() => {
        signal?.removeEventListener('abort', abort)
        this.running.delete(lifetime)
      })
      .catch(() => {
        /* The caller receives the operation's rejection. */
      })
    return operation
  }

  /** Reject new work, terminate current native workers, and await their exits. */
  async dispose(): Promise<void> {
    this.closing = true
    for (const lifetime of this.running.keys())
      lifetime.abort(new Error('The crawler is shutting down.'))
    await Promise.allSettled(this.running.values())
  }
}
