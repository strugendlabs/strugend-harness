/** Verified, opt-in runtime downloads; the coding runtime never waits for these components. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join, dirname, isAbsolute } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { x as extractTar } from 'tar'

/** Components distributed independently from the base application. */
export type ComponentId = 'decision' | 'documents'
/** A release-pinned component archive. */
export interface ComponentArtifact {
  readonly id: ComponentId
  readonly version: string
  readonly platform: string
  readonly arch: string
  readonly url: string
  readonly sha256: string
  readonly downloadBytes: number
  readonly installedBytes: number
  readonly files: number
}
/** Read-only installation state, safe to expose to the local application renderer. */
export interface ComponentStatus {
  readonly id: ComponentId
  readonly state: 'absent' | 'downloading' | 'verifying' | 'installed' | 'incompatible' | 'failed'
  readonly version: string
  readonly downloadBytes: number
  readonly installedBytes: number
  readonly progressBytes: number
  readonly available: boolean
  readonly error?: string | undefined
}

/** Deployment-owned paths and download limits. */
export interface ComponentOptions {
  readonly root: string
  readonly catalog: string
  readonly idleTimeoutMs: number
  readonly minimumDecisionMemoryMiB: number
  readonly totalMemoryMiB: number
  readonly platform: string
  readonly arch: string
}

/** Validate catalog bytes before any URL or filesystem entry is used.
 * @param value - Parsed packaged catalog.
 * @returns Validated, uniquely identified release archives.
 */
export function parseComponentCatalog(value: unknown): ComponentArtifact[] {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('components' in value) || !Array.isArray(value.components)) throw new Error('Invalid optional component catalog.')
  const ids = new Set<string>()
  return value.components.map((input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid optional component catalog.')
    const v = input as Record<string, unknown>
    if (!['decision', 'documents'].includes(String(v.id)) || ids.has(String(v.id))
      || typeof v.version !== 'string' || !/^[0-9][a-zA-Z0-9.-]{0,100}$/u.test(v.version)
      || !['darwin', 'win32', 'linux'].includes(String(v.platform)) || !['arm64', 'x64'].includes(String(v.arch))
      || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(v.sha256)
      || !['downloadBytes', 'installedBytes', 'files'].every(key => Number.isSafeInteger(v[key]) && Number(v[key]) > 0)
      || Number(v.files) > 200_000 || typeof v.url !== 'string') throw new Error('Invalid optional component catalog.')
    const url = new URL(v.url)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.hash) throw new Error('Invalid optional component download address.')
    ids.add(String(v.id))
    return input as ComponentArtifact
  })
}

async function ordinaryDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Optional component path must be an ordinary directory.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { recursive: true, mode: 0o700 })
  }
}

/** One manager owns downloads, publication and disposal for a desktop Host lifetime. */
export class ComponentManager {
  private readonly artifacts = new Map<ComponentId, ComponentArtifact>()
  private readonly states = new Map<ComponentId, ComponentStatus>()
  private readonly installations = new Map<ComponentId, string>()
  private readonly pending = new Map<ComponentId, { controller: AbortController; done: Promise<void> }>()
  private readonly removals = new Map<ComponentId, Promise<void>>()
  private readonly listeners = new Set<(id: ComponentId) => void>()
  private readonly removalListeners = new Set<(id: ComponentId) => Promise<void>>()
  private closed = false
  private acknowledged = false

  /** @param options - Explicit storage, target and resource policy. */
  constructor(private readonly options: ComponentOptions) {}

  /** Read small catalog and completion markers; never load model weights.
   * @returns After installed component availability is known.
   */
  async initialize(): Promise<void> {
    let artifacts: ComponentArtifact[] = []
    let startupError: string | undefined
    try { artifacts = parseComponentCatalog(JSON.parse(await readFile(this.options.catalog, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') startupError = 'Optional component catalog is damaged. Reinstall the application to restore downloads.' }
    await ordinaryDirectory(this.options.root)
    try { this.acknowledged = (JSON.parse(await readFile(join(this.options.root, 'setup.json'), 'utf8')) as { complete?: unknown }).complete === true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') startupError = 'Optional component setup preferences are damaged. Choose install or skip to repair them.' }
    for (const id of ['decision', 'documents'] as const) {
      const artifact = artifacts.find(candidate => candidate.id === id)
      if (artifact) this.artifacts.set(id, artifact)
      const compatible = artifact !== undefined && artifact.platform === this.options.platform && artifact.arch === this.options.arch
        && (id !== 'decision' || this.options.totalMemoryMiB >= this.options.minimumDecisionMemoryMiB)
      this.states.set(id, { id, state: startupError ? 'failed' : artifact && !compatible ? 'incompatible' : 'absent',
        error: startupError, version: artifact?.version ?? '',
        downloadBytes: artifact?.downloadBytes ?? 0, installedBytes: artifact?.installedBytes ?? 0,
        progressBytes: 0, available: compatible })
      if (!artifact) continue
      const root = this.target(artifact)
      try {
        try { await lstat(root) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          try { await rename(`${root}.previous`, root) }
          catch (recoveryError) { if ((recoveryError as NodeJS.ErrnoException).code !== 'ENOENT') throw recoveryError }
        }
        const marker: unknown = JSON.parse(await readFile(join(root, '.installed.json'), 'utf8'))
        await ordinaryDirectory(root)
        if (typeof marker === 'object' && marker !== null && 'sha256' in marker && marker.sha256 === artifact.sha256) {
          this.installations.set(id, root)
          this.update(id, { state: compatible ? 'installed' : 'incompatible', progressBytes: artifact.downloadBytes })
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.update(id, { state: 'failed', error: 'Installed component metadata is damaged. Install again to repair it.' }) }
    }
    if (!this.acknowledged) {
      let choice: unknown
      try { choice = JSON.parse(await readFile(join(dirname(this.options.catalog), 'component-choice.json'), 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.update('decision', { error: 'Installer component preference is unreadable. Choose install or skip in the application.' }) }
      if (choice && typeof choice === 'object' && 'decision' in choice && ['install', 'skip'].includes(String(choice.decision))) {
        await this.setup(choice.decision === 'install' && this.states.get('decision')?.available ? 'install' : 'skip')
      }
    }
  }

  /** @returns Snapshot of both component states. */
  list(): ComponentStatus[] { return [...this.states.values()].map(value => ({ ...value })) }
  /** @returns Whether this user has accepted or skipped optional setup. */
  get setupComplete(): boolean { return this.acknowledged }
  /** Persist an explicit setup choice before starting any download.
   * @param decision - User-selected installation or skip.
   * @returns After the preference is durable; download completion remains asynchronous.
   */
  async setup(decision: 'install' | 'skip'): Promise<void> {
    if (decision === 'install' && !this.states.get('decision')?.available) throw new Error('Local decision support is unavailable for this device.')
    const temporary = join(this.options.root, `.setup-${randomUUID()}`)
    try {
      await writeFile(temporary, JSON.stringify({ complete: true, decision }), { flag: 'wx', mode: 0o600 })
      await rename(temporary, join(this.options.root, 'setup.json'))
    } finally { await rm(temporary, { force: true }) }
    this.acknowledged = true
    if (decision === 'install') this.install('decision')
  }
  /** @param id - Component identifier. @returns Verified published root, or undefined when absent/incompatible. */
  installedPath(id: ComponentId): string | undefined {
    return this.states.get(id)?.available && !this.removals.has(id) ? this.installations.get(id) : undefined
  }
  /** @param id - Component identifier. @returns Version-selected installation directory, even before download. */
  expectedPath(id: ComponentId): string | undefined {
    const artifact = this.artifacts.get(id)
    return artifact ? this.target(artifact) : undefined
  }
  /** @param listener - Receives availability transitions. @returns Subscription disposer. */
  onChange(listener: (id: ComponentId) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** @param listener - Releases native handles before an installed component is removed. @returns Subscription disposer. */
  onBeforeRemove(listener: (id: ComponentId) => Promise<void>): () => void {
    this.removalListeners.add(listener)
    return () => { this.removalListeners.delete(listener) }
  }

  /** Start or join an explicitly requested download without holding the HTTP request open.
   * @param id - Component chosen by the user.
   * @returns Current installation status.
   */
  install(id: ComponentId): ComponentStatus {
    const artifact = this.artifacts.get(id), state = this.states.get(id)
    if (this.closed || !artifact || !state?.available) throw new Error('This optional component is unavailable for this device.')
    if (this.removals.has(id)) throw new Error('Wait for optional component removal to finish.')
    if (this.pending.has(id) || state.state === 'installed') return { ...state }
    const controller = new AbortController()
    this.update(id, { state: 'downloading', error: undefined })
    const done = this.download(artifact, controller.signal).catch((error) => {
      this.update(id, { state: this.installations.has(id) ? 'installed' : controller.signal.aborted ? 'absent' : 'failed',
        error: controller.signal.aborted ? undefined : error instanceof Error ? error.message : 'Optional component installation failed.' })
    }).finally(() => { this.pending.delete(id) })
    this.pending.set(id, { controller, done })
    return { ...state, state: 'downloading', error: undefined }
  }

  /** @param id - Component whose transfer should stop. @returns After the transfer has released its files. */
  async cancel(id: ComponentId): Promise<void> {
    const operation = this.pending.get(id)
    operation?.controller.abort()
    await operation?.done
  }

  /** Remove an optional installation; never touch user documents or the coding runtime.
   * @param id - Component chosen for removal.
   * @returns After cancellation, availability notification and file removal.
   */
  async remove(id: ComponentId): Promise<void> {
    const existing = this.removals.get(id)
    if (existing) return existing
    if (this.closed) throw new Error('Optional components have stopped.')
    const listeners = [...this.removalListeners]
    const operation = Promise.resolve().then(async () => {
      await this.cancel(id)
      const path = this.installations.get(id)
      await Promise.all(listeners.map(listener => listener(id)))
      if (path) { await ordinaryDirectory(path); await rm(path, { recursive: true, force: true }) }
      const artifact = this.artifacts.get(id)
      if (artifact) await rm(join(dirname(this.target(artifact)), `${artifact.sha256}.partial`), { force: true })
      this.installations.delete(id)
      this.update(id, { state: 'absent', progressBytes: 0, error: undefined })
    }).finally(() => { this.removals.delete(id); this.notify(id) })
    this.removals.set(id, operation)
    this.notify(id)
    return operation
  }

  /** @returns After all owned network and file operations have stopped. */
  async dispose(): Promise<void> {
    this.closed = true; this.listeners.clear(); this.removalListeners.clear()
    for (const operation of this.pending.values()) operation.controller.abort()
    await Promise.all([...this.pending.values()].map(operation => operation.done).concat([...this.removals.values()]))
  }

  private target(artifact: ComponentArtifact): string { return join(this.options.root, artifact.id, artifact.version) }
  private update(id: ComponentId, change: Partial<ComponentStatus>): void {
    const current = this.states.get(id)
    if (!current) return
    this.states.set(id, { ...current, ...change })
    if (change.state !== undefined && change.state !== current.state) this.notify(id)
  }
  private notify(id: ComponentId): void {
    for (const listener of this.listeners) {
      try { listener(id) } catch (error) { console.error('Optional component availability listener failed.', error) }
    }
  }

  private async download(artifact: ComponentArtifact, signal: AbortSignal): Promise<void> {
    const parent = dirname(this.target(artifact)); await ordinaryDirectory(parent)
    const partial = join(parent, `${artifact.sha256}.partial`)
    const staging = join(parent, `.install-${randomUUID()}`)
    let offset = 0
    try {
      const info = await lstat(partial)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Optional component download path is not a regular file.')
      offset = info.size
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (offset > artifact.downloadBytes) { await rm(partial); offset = 0 }
    const space = await statfs(parent)
    if (space.bavail * space.bsize < artifact.downloadBytes - offset + artifact.installedBytes) throw new Error('Not enough free disk space for this optional component.')
    if (offset < artifact.downloadBytes) await this.transfer(artifact, partial, offset, signal)
    signal.throwIfAborted()
    this.update(artifact.id, { state: 'verifying', progressBytes: artifact.downloadBytes })
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(partial)) { signal.throwIfAborted(); digest.update(chunk) }
    if (digest.digest('hex') !== artifact.sha256) { await rm(partial); throw new Error('Optional component checksum mismatch. Retry the download.') }
    await ordinaryDirectory(staging)
    try {
      let size = 0, files = 0, invalid = false
      await extractTar({ file: partial, cwd: staging, strict: true, preserveOwner: false, noChmod: true,
        filter: (path, entry) => {
          signal.throwIfAborted()
          const parts = path.replaceAll('\\', '/').split('/')
          const type = 'type' in entry ? entry.type : ''
          const safe = !isAbsolute(path) && !/^[a-z]:/iu.test(path) && !parts.includes('..')
            && !path.includes('\0') && ['File', 'Directory'].includes(type)
          size += entry.size; files += type === 'File' ? 1 : 0
          if (!safe || size > artifact.installedBytes || files > artifact.files) invalid = true
          return safe && !invalid
        } })
      signal.throwIfAborted()
      if (invalid || files !== artifact.files || size !== artifact.installedBytes) throw new Error('Optional component archive does not match its catalog.')
      await writeFile(join(staging, '.installed.json'), JSON.stringify({ sha256: artifact.sha256, version: artifact.version }), { flag: 'wx', mode: 0o600 })
      const target = this.target(artifact), previous = `${target}.previous`
      let replacing = false
      try {
        const info = await lstat(target)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Optional component target is not an ordinary directory.')
        await rm(previous, { recursive: true, force: true }); await rename(target, previous); replacing = true
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try { await rename(staging, target) }
      catch (error) { if (replacing) await rename(previous, target); throw error }
      this.installations.set(artifact.id, target)
      this.update(artifact.id, { state: 'installed', error: undefined })
      await rm(previous, { recursive: true, force: true }); await rm(partial, { force: true })
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  private async transfer(artifact: ComponentArtifact, partial: string, offset: number, signal: AbortSignal): Promise<void> {
    const idle = new AbortController()
    let timer = setTimeout(() => { idle.abort(new Error('Optional component download timed out. Retry to resume.')) }, this.options.idleTimeoutMs)
    const combined = AbortSignal.any([signal, idle.signal])
    try {
      let url = new URL(artifact.url), response: Response | undefined
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await fetch(url, { signal: combined, redirect: 'manual', headers: offset ? { Range: `bytes=${offset}-` } : {} })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location || redirects === 5) throw new Error('Optional component redirect failed.')
        const next = new URL(location, url)
        if (next.protocol !== 'https:' || next.username || next.password) throw new Error('Optional component redirect is not secure.')
        url = next
      }
      if (!response || ![200, 206].includes(response.status) || !response.body) throw new Error(`Optional component download failed (HTTP ${response?.status ?? 0}).`)
      if (response.status === 200) offset = 0
      else if (response.headers.get('content-range') !== `bytes ${offset}-${artifact.downloadBytes - 1}/${artifact.downloadBytes}`) {
        await response.body.cancel(); throw new Error('Optional component server returned an invalid resume range.')
      }
      let size = offset
      const guard = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
        clearTimeout(timer)
        timer = setTimeout(() => { idle.abort(new Error('Optional component download timed out. Retry to resume.')) }, this.options.idleTimeoutMs)
        size += chunk.length
        if (size > artifact.downloadBytes) { callback(new Error('Optional component download exceeds the pinned size.')); return }
        this.update(artifact.id, { progressBytes: size }); callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), guard,
        createWriteStream(partial, { flags: offset ? 'a' : 'w', mode: 0o600 }), { signal: combined })
      if (size !== artifact.downloadBytes) throw new Error('Optional component download was interrupted. Retry to resume.')
    } finally { clearTimeout(timer) }
  }
}
