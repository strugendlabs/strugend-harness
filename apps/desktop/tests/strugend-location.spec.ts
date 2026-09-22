/** The native bridge reports OS failures and never treats a missing path as success. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { openLocation } from '../src/strugend-location.ts'

it('opens folders with spaces, reveals files and surfaces missing paths and native errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'strugend-location-'))
  const native = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
  try {
    const folder = join(root, 'App output'); await mkdir(folder)
    const file = join(folder, 'My app.zip'); await writeFile(file, 'artifact')
    await openLocation({ path: folder }, native)
    expect(native.openPath).toHaveBeenCalledWith(folder)
    await openLocation({ path: file, reveal: true }, native)
    expect(native.showItemInFolder).toHaveBeenCalledWith(file)
    await expect(openLocation({ path: file }, native)).rejects.toThrow('folder')
    await expect(openLocation({ path: join(root, 'missing') }, native)).rejects.toThrow('moved')
    await expect(openLocation({ path: 'relative' }, native)).rejects.toThrow('absolute')
    native.openPath.mockResolvedValueOnce('OS refused')
    await expect(openLocation({ path: folder }, native)).rejects.toThrow('OS refused')
  } finally { await rm(root, { recursive: true, force: true }) }
})
