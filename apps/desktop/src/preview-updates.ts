/** GitHub release metadata and verified installer downloads for unsigned Strugend previews. */
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { gt, valid, rcompare } from 'semver'

/** One immutable native installer advertised by the release job. */
export interface PreviewInstaller { target: string; file: string; bytes: number; sha256: string }
/** Only complete release sets are eligible for updater discovery. */
export interface PreviewManifest { version: string; installers: PreviewInstaller[] }
/**
 * Validate release metadata before deriving any download destination.
 * @param input - Downloaded JSON.
 * @param version - Checked release tag version.
 * @returns Validated platform manifest.
 */
export function previewManifest(input: unknown, version: string): PreviewManifest {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== version
    || !('installers' in input) || !Array.isArray(input.installers)) throw new Error('Invalid release manifest.')
  const installers = input.installers.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid release installer.')
    const r = item as Record<string, unknown>
    if (!['win-x64', 'mac-arm64', 'mac-x64'].includes(String(r.target)) || typeof r.file !== 'string'
      || !/^[a-zA-Z0-9._-]+\.(exe|dmg)$/u.test(r.file) || basename(r.file) !== r.file
      || !Number.isSafeInteger(r.bytes) || Number(r.bytes) < 1 || Number(r.bytes) > 600 * 1024 ** 2
      || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(r.sha256)) throw new Error('Invalid release installer.')
    if (String(r.target).startsWith('mac-') !== r.file.endsWith('.dmg')) throw new Error('Incorrect installer platform.')
    return r as unknown as PreviewInstaller
  })
  if (installers.length !== 3 || new Set(installers.map(i => i.target)).size !== 3) throw new Error('Release is missing a native installer.')
  return { version, installers }
}

/** Network source used by the existing update coordinator; it cannot install unsigned code unattended. */
export class PreviewUpdateSource {
  private readonly abort = new AbortController()
  private selected: { version: string; installer: PreviewInstaller; notes: string } | undefined
  private ready: { version: string; path: string; sha256: string } | undefined
  /**
   * @param root - Private update cache.
   * @param target - Installed architecture.
   * @param fetcher - HTTPS transport; injectable for fixture releases.
   */
  constructor(private readonly root: string, private readonly target: string, private readonly fetcher: typeof fetch = fetch) {}
  /** @returns Checked release notes, bounded for native dialogs. */
  get notes(): string { return this.selected?.notes ?? '' }
  /** @param current - Installed version. @returns Newer qualified preview, or undefined when current. */
  async check(current: string): Promise<string | undefined> {
    const releases = await this.json('https://api.github.com/repos/strugendlabs/strugend-harness/releases?per_page=30')
    if (!Array.isArray(releases)) throw new Error('GitHub did not return releases.')
    const candidates = releases.filter((r: unknown): r is { tag_name: string; body?: string; assets: Array<{ name: string }> } =>
      !!r && typeof r === 'object' && 'draft' in r && r.draft === false && 'tag_name' in r && typeof r.tag_name === 'string' && r.tag_name.startsWith('strugend-v')
      && valid(r.tag_name.slice(10)) !== null && gt(r.tag_name.slice(10), current) && 'assets' in r && Array.isArray(r.assets)
      && r.assets.some((a: unknown) => !!a && typeof a === 'object' && 'name' in a && a.name === 'strugend-update.json'))
      .sort((a, b) => rcompare(a.tag_name.slice(10), b.tag_name.slice(10)))
    this.selected = undefined
    if (!candidates[0]) return undefined
    const release = candidates[0], version = release.tag_name.slice(10)
    const manifest = previewManifest(await this.json(this.url(version, 'strugend-update.json')), version)
    const installer = manifest.installers.find(i => i.target === this.target)
    if (!installer || !release.assets.some(a => a.name === installer.file)) throw new Error('No installer for this computer.')
    this.selected = { version, installer, notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '' }
    return version
  }
  /**
   * @param version - User-confirmed checked version.
   * @param progress - Download percentage.
   * @returns When bytes and digest match the immutable manifest.
   */
  async download(version: string, progress: (percent: number) => void): Promise<void> {
    const candidate = this.selected
    if (!candidate || candidate.version !== version) throw new Error('Update selection changed; check again.')
    const { installer } = candidate
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = join(this.root, installer.file), partial = `${path}.${randomUUID()}.partial`
    const response = await this.fetcher(this.url(version, installer.file), {
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20 * 60_000)]),
    })
    if (!response.ok || !response.body) throw new Error(`Installer download failed (${response.status}).`)
    const file = await open(partial, 'wx', 0o600)
    let count = 0
    const hash = createHash('sha256')
    try {
      for await (const chunk of response.body) {
        count += chunk.length
        if (count > installer.bytes) throw new Error('Installer exceeds its declared size.')
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) { const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset); if (bytesWritten === 0) throw new Error('Installer write stopped.'); offset += bytesWritten }
        progress(count / installer.bytes * 100)
      }
      if (count !== installer.bytes || hash.digest('hex') !== installer.sha256) throw new Error('Installer checksum verification failed.')
      await file.sync()
    } catch (error) { await file.close(); await rm(partial, { force: true }); throw error }
    await file.close()
    await rm(path, { force: true }); await rename(partial, path)
    this.ready = { version, path, sha256: installer.sha256 }
  }
  /** @param version - User-confirmed version. @returns Verified installer path for a manual installation handoff. */
  async installer(version: string): Promise<string> {
    const ready = this.ready
    if (!ready || ready.version !== version) throw new Error('The requested installer has not been downloaded.')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(ready.path)) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid installer stream.')
      hash.update(chunk)
    }
    if (hash.digest('hex') !== ready.sha256) throw new Error('Downloaded installer changed. Download it again.')
    return ready.path
  }
  /** Cancel network activity; coordinator joins its owned operations. */
  dispose(): void { this.abort.abort(new Error('Updater stopped.')) }
  private url(version: string, file: string): string { return `https://github.com/strugendlabs/strugend-harness/releases/download/strugend-v${encodeURIComponent(version)}/${encodeURIComponent(file)}` }
  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]) })
    if (!response.ok || !response.body) throw new Error(`Release check failed (${response.status}).`)
    const chunks: Uint8Array[] = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 ** 2) throw new Error('Release metadata is too large.'); chunks.push(chunk) }
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown
  }
}
