import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewUpdateSource, previewManifest } from '../src/preview-updates.ts'
const dispose: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const fn of dispose.splice(0).reverse()) await fn() })
const bytes = Buffer.from('synthetic installer fixture')
const digest = createHash('sha256').update(bytes).digest('hex')
const version = '0.1.6-alpha.2.20260925.1'
function manifest() { return { version, installers: ['win-x64', 'mac-arm64', 'mac-x64'].map(target => ({ target, file: `strugend-${target}.${target.startsWith('win') ? 'exe' : 'dmg'}`, bytes: bytes.length, sha256: digest })) } }
async function fixture(bad = false) {
  const root = await mkdtemp(join(tmpdir(), 'strugend-update-')); dispose.push(() => rm(root, { recursive: true, force: true }))
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.includes('api.github.com')) return Response.json([{ tag_name: `strugend-v${version}`, draft: false, body: 'Release notes', assets: [{ name: 'strugend-update.json' }, ...manifest().installers.map(i => ({ name: i.file }))] }])
    if (url.endsWith('.json')) return Response.json(manifest())
    return new Response(bad ? Buffer.from('wrong') : bytes)
  })
  const source = new PreviewUpdateSource(root, 'mac-arm64', fetcher); dispose.push(() =>{  source.dispose() })
  return { source, fetcher, root }
}
it('checks the release without downloading and rejects stale download consent', async () => {
  const { source, fetcher } = await fixture()
  expect(await source.check('0.1.6-alpha.2.20260923.3')).toBe(version)
  expect(fetcher).toHaveBeenCalledTimes(2)
  await expect(source.download('0.1.0', () => {})).rejects.toThrow(/selection changed/)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('verifies installer bytes before handing off, and detects later tampering', async () => {
  const { source } = await fixture(); await source.check('0.1.0')
  const progress = vi.fn(); await source.download(version, progress)
  const path = await source.installer(version)
  expect(await readFile(path)).toEqual(bytes)
  expect(progress).toHaveBeenLastCalledWith(100)
  await writeFile(path, 'tampered')
  await expect(source.installer(version)).rejects.toThrow(/changed/)
})
it('refuses corrupt downloads and does not offer a current or older release', async () => {
  const { source } = await fixture(true); await source.check('0.1.0')
  await expect(source.download(version, () => {})).rejects.toThrow(/checksum/)
  await expect(source.installer(version)).rejects.toThrow(/not been downloaded/)
  expect(await source.check(version)).toBeUndefined()
  expect(await source.check('1.0.0')).toBeUndefined()
})
it('rejects incomplete platform releases, path traversal and mismatched platform installers', () => {
  expect(() => previewManifest({ ...manifest(), installers: manifest().installers.slice(1) }, version)).toThrow(/missing/)
  expect(() => previewManifest({ ...manifest(), version: '1.0.0' }, version)).toThrow(/Invalid/)
  const input = manifest(); input.installers[0]!.file = '../installer.exe'
  expect(() => previewManifest(input, version)).toThrow(/Invalid/)
  input.installers[0]!.file = 'mac.dmg'
  expect(() => previewManifest(input, version)).toThrow(/platform/)
})
