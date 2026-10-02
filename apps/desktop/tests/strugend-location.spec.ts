/** The native bridge reports OS failures and never treats a missing path as success. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { openLocation } from '../src/strugend-location.ts'

it('opens folders with spaces, reveals files and surfaces missing paths and native errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'strugend-location-'))
  const native = { openPath: vi.fn(async () => ''), openExternal: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined), showItemInFolder: vi.fn() }
  try {
    const folder = join(root, 'App output'); await mkdir(folder)
    const file = join(folder, 'My app.zip'); await writeFile(file, 'artifact')
    await openLocation({ path: folder }, native, 'darwin')
    expect(native.openPath).toHaveBeenCalledWith(folder)
    await openLocation({ path: file, reveal: true }, native)
    expect(native.showItemInFolder).toHaveBeenCalledWith(file)
    await openLocation({ path: file }, native, 'darwin')
    expect(native.openPath).toHaveBeenLastCalledWith(file)
    await expect(openLocation({ path: join(root, 'missing') }, native)).rejects.toThrow('moved')
    await expect(openLocation({ path: 'relative' }, native)).rejects.toThrow('absolute')
    native.openPath.mockResolvedValueOnce('OS refused')
    await expect(openLocation({ path: folder }, native, 'win32')).rejects.toThrow('OS refused')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('hands Linux folders to XDG as encoded local URLs and propagates launch failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'strugend-location-'))
  const native = { openPath: vi.fn(async () => ''), openExternal: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined), showItemInFolder: vi.fn() }
  try {
    const folder = join(root, 'Output #1 %'); await mkdir(folder)
    await openLocation({ path: folder }, native, 'linux')
    expect(native.openPath).not.toHaveBeenCalled()
    expect(native.openExternal).toHaveBeenCalledWith(pathToFileURL(folder).href)
    expect(native.openExternal.mock.calls[0]![0]).toContain('Output%20%231%20%25')
    const document = join(folder, 'report #1.pdf'); await writeFile(document, 'pages')
    await openLocation({ path: document }, native, 'linux')
    expect(native.openExternal).toHaveBeenLastCalledWith(pathToFileURL(document).href)
    native.openExternal.mockRejectedValueOnce(new Error('Launcher unavailable'))
    await expect(openLocation({ path: folder }, native, 'linux')).rejects.toThrow('Launcher unavailable')
    native.openExternal.mockClear()
    await expect(openLocation({ path: 'https://example.com' }, native, 'linux')).rejects.toThrow('absolute')
    expect(native.openExternal).not.toHaveBeenCalled()
  } finally { await rm(root, { recursive: true, force: true }) }
})
