/** Video studio commands reach the media layer instead of refusing as unfinished. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOsCommand, VideoEdit } from '@deepseek-ai/dsh-agentos-protocol'

// The electron module factory is hoisted above the imports, so the shared doubles live here.
const mocked = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>>(),
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) => {
      mocked.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => { mocked.handlers.delete(channel) },
  },
  safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  clipboard: {}, shell: {}, dialog: { showOpenDialog: mocked.showOpenDialog }, session: {},
  WebContentsView: vi.fn(),
}))
import { AgentOsDesktop } from '../src/agentos.ts'

const EDIT: VideoEdit = { clips: [{ path: '/tmp/take.mp4' }], format: 'portrait' }

async function desktop(root: string, hasWindow = true) {
  const window = { isDestroyed: () => false, webContents: { send: () => {} } }
  const instance = new AgentOsDesktop(root, () => (hasWindow ? window as unknown as BrowserWindow : undefined), () => {})
  return instance
}

/** Send one command through the handler the constructed instance installed. */
async function command(input: AgentOsCommand): Promise<unknown> {
  const handler = mocked.handlers.get('agent-os:request')
  if (handler === undefined) throw new Error('the desktop request handler is not installed')
  return handler({} as IpcMainInvokeEvent, input)
}

// The electron module mock is shared by every case, so the dialog starts each one untouched.
beforeEach(() => { mocked.showOpenDialog.mockReset() })

describe('video studio commands', () => {
  it('imports the files the owner picks in the native dialog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strugend-video-'))
    const instance = await desktop(root)
    try {
      mocked.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/take.mp4', '/tmp/take.mp3'] })
      const imported = vi.spyOn(instance.media, 'import').mockResolvedValue([])
      await expect(command({ type: 'media.import' })).resolves.toEqual([])
      expect(imported).toHaveBeenCalledExactlyOnceWith(['/tmp/take.mp4', '/tmp/take.mp3'])
      expect(mocked.showOpenDialog).toHaveBeenCalledOnce()
    } finally { await instance.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
  })

  it('imports nothing when the owner cancels the dialog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strugend-video-'))
    const instance = await desktop(root)
    try {
      mocked.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const imported = vi.spyOn(instance.media, 'import').mockResolvedValue([])
      await expect(command({ type: 'media.import' })).resolves.toEqual([])
      expect(imported).not.toHaveBeenCalled()
    } finally { await instance.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
  })

  it('refuses to open a dialog without an owner window', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strugend-video-'))
    const instance = await desktop(root, false)
    try {
      mocked.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/take.mp4'] })
      await expect(command({ type: 'media.import' })).rejects.toThrow('Open the application window')
      expect(mocked.showOpenDialog).not.toHaveBeenCalled()
    } finally { await instance.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
  })

  it('edits with the recipe the studio sends, from the window and from the agent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strugend-video-'))
    const instance = await desktop(root)
    try {
      const edited = vi.spyOn(instance.media, 'edit').mockResolvedValue({ id: 'export' } as never)
      await command({ type: 'media.edit', edit: EDIT })
      expect(edited).toHaveBeenCalledWith(EDIT)
      const controller = new AbortController()
      await instance.hostRequest({ method: 'media', edit: EDIT, workspace: '/work' }, controller.signal)
      expect(edited).toHaveBeenLastCalledWith(EDIT, '/work', controller.signal)
    } finally { await instance.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
  })

  it('still advertises the library read and cancel commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'strugend-video-'))
    const instance = await desktop(root)
    try {
      const listed = vi.spyOn(instance.media, 'list').mockReturnValue([])
      const cancel = vi.spyOn(instance.media, 'cancel').mockImplementation(() => {})
      await expect(command({ type: 'media.list' })).resolves.toEqual([])
      await command({ type: 'media.cancel', jobId: 'job-1' })
      expect(listed).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledExactlyOnceWith('job-1')
    } finally { await instance.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
  })
})
