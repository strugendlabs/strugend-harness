/** Private request transport to the Electron parent; never exposed as a model tool. */
import { randomUUID } from 'node:crypto'

/** @param request - Structured desktop operation. @param signal - Calling tool lifetime. @returns Parent response. */
export function desktopRequest<T>(request: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) {
      reject(new Error('Agent OS desktop is disconnected.'))
      return
    }
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      return
    }
    const id = randomUUID()
    const finish = (error?: unknown, result?: T): void => {
      clearTimeout(timer)
      process.off('message', receive)
      process.off('disconnect', disconnect)
      signal?.removeEventListener('abort', abort)
      if (error !== undefined) reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Desktop request failed.'))
      else resolve(result as T)
    }
    const receive = (input: unknown): void => {
      if (typeof input !== 'object' || input === null) return
      const response = input as { type?: string; id?: string; error?: string; result?: T }
      if (response.type !== 'agent-os:response' || response.id !== id) return
      finish(response.error === undefined ? undefined : new Error(response.error), response.result)
    }
    const disconnect = (): void => {
      finish(new Error('Agent OS desktop disconnected.'))
    }
    const abort = (): void => {
      if (process.connected)
        process.send?.({ type: 'agent-os:cancel', id }, () => {
          /* Disconnect is handled by the request lifetime. */
        })
      finish(signal?.reason ?? new Error('Cancelled.'))
    }
    const timer = setTimeout(
      () => {
        if (process.connected)
          process.send?.({ type: 'agent-os:cancel', id }, () => {
            /* A closed transport is already handled below. */
          })
        finish(new Error('Agent OS desktop request timed out.'))
      },
      typeof request === 'object' && request !== null && 'method' in request && request.method === 'media'
        ? 1_200_000
        : 45_000,
    )
    process.on('message', receive)
    process.once('disconnect', disconnect)
    signal?.addEventListener('abort', abort, { once: true })
    process.send({ type: 'agent-os:request', id, request }, (error) => {
      if (error !== null) finish(error)
    })
  })
}
