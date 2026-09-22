/** Native file-manager handoff with validated local paths and awaited directory errors. */
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Electron operations injected by the main process. */
export interface LocationShell {
  openPath(path: string): Promise<string>
  showItemInFolder(path: string): void
}

/**
 * Open a directory or reveal a file without invoking a shell command.
 * @param input - Untrusted IPC fields from the authenticated application renderer.
 * @param native - Main-process Electron shell operations.
 * @returns After the OS accepts a directory open or a file reveal is submitted.
 */
export async function openLocation(input: { path?: unknown; reveal?: unknown }, native: LocationShell): Promise<void> {
  if (typeof input.path !== 'string' || !isAbsolute(input.path) || input.path.includes('\0'))
    throw new Error('Choose an absolute local file or folder path.')
  if (input.reveal !== undefined && typeof input.reveal !== 'boolean') throw new Error('Invalid location action.')
  const info = await stat(input.path).catch(() => { throw new Error('This file or folder has moved or is no longer accessible.') })
  if (input.reveal === true) { native.showItemInFolder(input.path); return }
  if (!info.isDirectory()) throw new Error('Choose a folder, or use Show in folder for a file.')
  const error = await native.openPath(input.path)
  if (error) throw new Error(`Could not open this folder: ${error}`)
}
