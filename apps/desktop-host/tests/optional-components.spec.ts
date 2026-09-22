import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar, Header } from 'tar'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { ComponentManager, parseComponentCatalog, type ComponentArtifact } from '../src/optional-components.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release() })

async function fixture(options: { badHash?: boolean; interrupt?: boolean; lowMemory?: boolean; extraFile?: boolean; hang?: boolean; unsafe?: 'escape' | 'link' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'strugend-components-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const payload = join(root, 'payload'); await mkdir(payload)
  const contents = Buffer.alloc(256 * 1024)
  for (let i = 0; i < contents.length; i++) contents[i] = i * 101 % 251
  await writeFile(join(payload, 'model.bin'), contents)
  const archive = join(root, 'pack.tar.gz')
  await createTar({ cwd: payload, file: archive, gzip: true, portable: true }, ['model.bin'])
  if (options.unsafe) {
    const block = Buffer.alloc(512)
    new Header({ path: options.unsafe === 'escape' ? '../escaped' : 'model.bin', type: options.unsafe === 'escape' ? 'File' : 'SymbolicLink',
      linkpath: '../escaped', size: 0, mode: 0o644 }).encode(block)
    await writeFile(archive, gzipSync(Buffer.concat([block, Buffer.alloc(1024)])))
  }
  const bytes = await readFile(archive)
  let requests = 0; const ranges: (string | undefined)[] = []
  const server: Server = createServer((request, response) => {
    requests++; ranges.push(request.headers.range)
    const start = Number(request.headers.range?.match(/^bytes=(\d+)-$/u)?.[1] ?? '0')
    const part = bytes.subarray(start)
    response.writeHead(start ? 206 : 200, { 'content-length': part.length,
      ...(start ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}) })
    if (options.interrupt && requests === 1) { response.end(part.subarray(0, Math.floor(part.length / 2))); return }
    if (options.hang && requests === 1) { response.write(part.subarray(0, Math.floor(part.length / 2))); return }
    response.end(part)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture listener has no address')
  const artifact: ComponentArtifact = { id: 'decision', version: '1.0.0', platform: process.platform, arch: process.arch,
    url: `http://127.0.0.1:${address.port}/pack`, downloadBytes: bytes.length, installedBytes: contents.length,
    files: options.extraFile ? 2 : 1, sha256: options.badHash ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex') }
  const catalog = join(root, 'component-catalog.json')
  await writeFile(catalog, JSON.stringify({ schemaVersion: 1, components: [artifact] }))
  const settings = { root: join(root, 'installed'), catalog, idleTimeoutMs: 1000, minimumDecisionMemoryMiB: 8192,
    totalMemoryMiB: options.lowMemory ? 4096 : 16_384, platform: process.platform, arch: process.arch }
  const manager = new ComponentManager(settings); await manager.initialize()
  cleanup.push(() => manager.dispose())
  return { manager, root, contents, settings, requests: () => requests, ranges }
}

async function terminal(manager: ComponentManager): Promise<void> {
  if (['installed', 'failed', 'absent'].includes(manager.list()[0]!.state)) return
  await new Promise<void>((resolve) => {
    const off = manager.onChange(() => {
      if (['installed', 'failed', 'absent'].includes(manager.list()[0]!.state)) { off(); resolve() }
    })
  })
}

it('opens without a download, persists Skip, and installs a verified component only on request', async () => {
  const { manager, root, contents, settings, requests } = await fixture()
  expect(requests()).toBe(0); expect(manager.setupComplete).toBe(false)
  expect(manager.installedPath('decision')).toBeUndefined()
  await manager.setup('skip')
  expect(requests()).toBe(0); expect(manager.setupComplete).toBe(true)
  manager.install('decision'); manager.install('decision'); await terminal(manager)
  expect(manager.list()[0]?.state).toBe('installed'); expect(requests()).toBe(1)
  expect(await readFile(join(manager.installedPath('decision')!, 'model.bin'))).toEqual(contents)
  const reopened = new ComponentManager(settings); await reopened.initialize()
  cleanup.push(() => reopened.dispose())
  expect(reopened.setupComplete).toBe(true)
  expect(reopened.installedPath('decision')).toBe(manager.installedPath('decision'))
  await manager.remove('decision')
  expect(manager.installedPath('decision')).toBeUndefined()
  await expect(readFile(join(root, 'installed', 'decision', '1.0.0', 'model.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('resumes a partial transfer with Range and verifies the entire archive', async () => {
  const { manager, ranges, contents } = await fixture({ interrupt: true })
  manager.install('decision'); await terminal(manager)
  expect(manager.list()[0]?.state).toBe('failed')
  manager.install('decision'); await terminal(manager)
  expect(manager.list()[0]?.state).toBe('installed')
  expect(ranges[0]).toBeUndefined(); expect(ranges[1]).toMatch(/^bytes=\d+-$/u)
  expect(await readFile(join(manager.installedPath('decision')!, 'model.bin'))).toEqual(contents)
})

it.each([{ badHash: true }, { extraFile: true }])('never publishes corrupt or incomplete archives: %j', async (options) => {
  const { manager } = await fixture(options)
  manager.install('decision'); await terminal(manager)
  expect(manager.list()[0]?.state).toBe('failed')
  expect(manager.installedPath('decision')).toBeUndefined()
})

it.each(['escape', 'link'] as const)('rejects an archive with a filesystem %s', async (unsafe) => {
  const { manager, root } = await fixture({ unsafe })
  manager.install('decision'); await terminal(manager)
  expect(manager.list()[0]?.state).toBe('failed')
  expect(manager.installedPath('decision')).toBeUndefined()
  await expect(readFile(join(root, 'installed', 'decision', 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('cancels a stalled download, retains resumable bytes, and joins native cleanup before removal', async () => {
  const { manager, ranges } = await fixture({ hang: true })
  manager.install('decision')
  await vi.waitFor(() => { expect(manager.list()[0]!.progressBytes).toBeGreaterThan(0) })
  await manager.cancel('decision'); expect(manager.list()[0]?.state).toBe('absent')
  manager.install('decision'); await terminal(manager)
  expect(ranges[1]).toMatch(/^bytes=\d+-$/u)
  let released = false
  const off = manager.onBeforeRemove(async () => { await Promise.resolve(); released = true })
  await manager.remove('decision'); off()
  expect(released).toBe(true); expect(manager.installedPath('decision')).toBeUndefined()
})

it('declines local installation on 4 GiB devices without affecting setup Skip', async () => {
  const { manager, requests } = await fixture({ lowMemory: true })
  expect(manager.list()[0]?.state).toBe('incompatible')
  expect(() => manager.install('decision')).toThrow('unavailable')
  await manager.setup('skip'); expect(requests()).toBe(0)
})

it('treats a missing catalog as optional and does not block the main application', async () => {
  const { manager, settings } = await fixture()
  await rm(settings.catalog)
  const absent = new ComponentManager(settings); await absent.initialize()
  cleanup.push(() => absent.dispose())
  expect(absent.list().every(component => !component.available)).toBe(true)
  await absent.setup('skip')
  expect(manager.list()).toHaveLength(2)
})

it.each([
  { schemaVersion: 2, components: [] },
  { schemaVersion: 1, components: [{ id: 'decision', version: '../outside' }] },
])('rejects malformed catalogs before filesystem or network operations', (value) => {
  expect(() => parseComponentCatalog(value)).toThrow('Invalid optional component catalog')
})

it('serializes removal against reinstall and recovers interrupted directory publication', async () => {
  const { manager, settings } = await fixture()
  manager.install('decision'); await terminal(manager)
  const path = manager.installedPath('decision')!
  await rename(path, `${path}.previous`)
  const recovered = new ComponentManager(settings); await recovered.initialize()
  cleanup.push(() => recovered.dispose())
  expect(recovered.installedPath('decision')).toBe(path)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  recovered.onBeforeRemove(async () => { calls++; await waiting })
  const removal = recovered.remove('decision'), joined = recovered.remove('decision')
  expect(recovered.installedPath('decision')).toBeUndefined()
  expect(() => recovered.install('decision')).toThrow('removal')
  release(); await Promise.all([removal, joined])
  expect(calls).toBe(1)
  recovered.install('decision'); await terminal(recovered)
  expect(recovered.list()[0]?.state).toBe('installed')
})

it('removal publishes unavailability before native teardown and removes cancelled download residue', async () => {
  const { manager, settings } = await fixture({ hang: true })
  manager.install('decision')
  await vi.waitFor(() => { expect(manager.list()[0]!.progressBytes).toBeGreaterThan(0) })
  await manager.remove('decision')
  expect((await readdir(join(settings.root, 'decision'))).filter(name => name.endsWith('.partial'))).toEqual([])
  manager.install('decision'); await terminal(manager)
  const notifications: (string | undefined)[] = []
  manager.onChange(() => { notifications.push(manager.installedPath('decision')) })
  manager.onBeforeRemove(async () => {
    expect(notifications[0]).toBeUndefined()
    expect(manager.installedPath('decision')).toBeUndefined()
    throw new Error('Native teardown failed')
  })
  await expect(manager.remove('decision')).rejects.toThrow('Native teardown failed')
  expect(notifications.at(-1)).toBe(manager.installedPath('decision'))
  expect(manager.installedPath('decision')).toBeTruthy()
})

it('keeps startup usable when optional catalog or setup JSON is damaged', async () => {
  const { settings } = await fixture()
  await writeFile(settings.catalog, '{broken')
  const unavailable = new ComponentManager(settings); await unavailable.initialize()
  cleanup.push(() => unavailable.dispose())
  expect(unavailable.list().every(component => component.state === 'failed' && !component.available)).toBe(true)
  await unavailable.setup('skip')
  expect(unavailable.setupComplete).toBe(true)
  await writeFile(join(settings.root, 'setup.json'), '{broken')
  const damagedPreference = new ComponentManager(settings); await damagedPreference.initialize()
  cleanup.push(() => damagedPreference.dispose())
  expect(damagedPreference.setupComplete).toBe(false)
  await damagedPreference.setup('skip')
  expect(damagedPreference.setupComplete).toBe(true)
})
