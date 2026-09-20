/** Track main-document completion when a page replaces its initial navigation. */
import type { WebContents } from 'electron'

/**
 * Load a website, including redirects that cancel Electron's original loadURL promise.
 * @param contents - The conversation's native browser target.
 * @param url - Validated HTTP(S) address.
 * @param signal - Calling tool's lifetime, absent for address-bar navigation.
 * @returns Completion of a newly committed document; an old page is not success.
 */
export function loadWebsite(contents: WebContents, url: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let committed = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      contents.off('did-navigate', navigated)
      contents.off('did-finish-load', loaded)
      contents.off('did-fail-load', failed)
      contents.off('did-fail-provisional-load', failed)
      contents.off('destroyed', destroyed)
      signal?.removeEventListener('abort', aborted)
      if (error === undefined) resolve()
      else reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Navigation failed.'))
    }
    const navigated = (): void => { committed = true }
    const loaded = (): void => { if (committed) finish() }
    const failed = (_event: unknown, code: number, description: string, failedUrl: string, main: boolean): void => {
      // A replacement navigation cancels its predecessor with ERR_ABORTED.
      if (main && code !== -3) finish(Object.assign(new Error(description), { url: failedUrl }))
    }
    const destroyed = (): void => { finish(new Error('The browser tab was closed.')) }
    const stop = (error: unknown): void => {
      finish(error)
      if (!contents.isDestroyed()) contents.stop()
    }
    const aborted = (): void => { stop(signal?.reason ?? new Error('Navigation cancelled.')) }
    // Settle before the desktop bridge's 45-second deadline, including hung redirects.
    const timer = setTimeout(() => { stop(new Error('ERR_TIMED_OUT')) }, 30_000)
    contents.on('did-navigate', navigated)
    contents.on('did-finish-load', loaded)
    contents.on('did-fail-load', failed)
    contents.on('did-fail-provisional-load', failed)
    contents.once('destroyed', destroyed)
    signal?.addEventListener('abort', aborted, { once: true })
    try {
      void contents.loadURL(url).then(() => { finish() }, (error: unknown) => {
        if (!String(error).includes('ERR_ABORTED')) finish(error)
      })
    } catch (error) {
      finish(error)
    }
  })
}
