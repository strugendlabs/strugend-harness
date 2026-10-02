/** Native file-manager handoff with validated local paths and awaited directory errors. */
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Electron operations injected by the main process. */
export interface LocationShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): void
}

/**
 * Open a file or folder with its default application, or reveal a file in the
 * file manager, without invoking a shell command.
 * @param input - Untrusted IPC fields from the authenticated application renderer.
 * @param native - Main-process Electron shell operations.
 * @param platform - Operating system owning the native shell.
 * @returns After the OS accepts the handoff; Linux acknowledges launcher startup, not the opened window.
 */
export async function openLocation(
  input: { path?: unknown; reveal?: unknown }, native: LocationShell, platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (typeof input.path !== 'string' || !isAbsolute(input.path) || input.path.includes('\0'))
    throw new Error('Choose an absolute local file or folder path.')
  if (input.reveal !== undefined && typeof input.reveal !== 'boolean') throw new Error('Invalid location action.')
  const info = await stat(input.path).catch(() => { throw new Error('This file or folder has moved or is no longer accessible.') })
  if (input.reveal === true) { native.showItemInFolder(input.path); return }
  if (platform === 'linux') {
    // Electron 44's Linux openPath drops its completion callback; openExternal acknowledges the same XDG launch.
    await native.openExternal(pathToFileURL(input.path).href)
    return
  }
  const error = await native.openPath(input.path)
  if (error) throw new Error(`Could not open this ${info.isDirectory() ? 'folder' : 'file'}: ${error}`)
}
