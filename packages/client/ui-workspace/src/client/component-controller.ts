/** Client mirror for optional component installation; polling exists only during active downloads. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Optional desktop capabilities downloaded independently of Core. */
export type ComponentId = 'decision' | 'documents'
/** Installer state returned by the desktop Host. */
export interface ComponentStatus {
  id: ComponentId
  state: 'absent' | 'downloading' | 'verifying' | 'installed' | 'incompatible' | 'failed'
  version: string
  downloadBytes: number
  installedBytes: number
  progressBytes: number
  available: boolean
  error?: string
}
/** Validated component catalog and setup preferences. */
export interface ComponentSnapshot {
  components: ComponentStatus[]
  setupComplete: boolean
  localAllowed: boolean
  localReason: string
}
/** UI-visible state for the optional tools page and setup step. */
export interface ComponentViewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  value: ComponentSnapshot | null
  busy: boolean
  error: string | null
}

/**
 * Validate installer status before it reaches progress and action controls.
 * @param value - Parsed Host response.
 * @returns The validated component snapshot.
 */
export function parseComponentSnapshot(value: unknown): ComponentSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid optional tools response.')
  const snapshot = value as Record<string, unknown>
  if (typeof snapshot.setupComplete !== 'boolean' || typeof snapshot.localAllowed !== 'boolean'
    || typeof snapshot.localReason !== 'string' || !Array.isArray(snapshot.components)) throw new Error('Invalid optional tools response.')
  const ids = new Set<string>()
  const components = snapshot.components.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid optional tool.')
    const row = item as Record<string, unknown>
    if ((row.id !== 'decision' && row.id !== 'documents') || ids.has(row.id)
      || !['absent', 'downloading', 'verifying', 'installed', 'incompatible', 'failed'].includes(String(row.state))
      || typeof row.version !== 'string' || typeof row.available !== 'boolean'
      || !['downloadBytes', 'installedBytes', 'progressBytes'].every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)
      || (row.error !== undefined && typeof row.error !== 'string')) throw new Error('Invalid optional tool.')
    ids.add(row.id)
    return item as ComponentStatus
  })
  return { components, setupComplete: snapshot.setupComplete, localAllowed: snapshot.localAllowed, localReason: snapshot.localReason }
}

/** Owns request cancellation and the single active installation-status poll. */
export class ComponentController {
  /** Current catalog, request state, and download progress for framework-bound views. */
  readonly store = createSnapshotStore<ComponentViewState>({ status: 'idle', value: null, busy: false, error: null })
  private readonly abort = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> | undefined
  private revision = 0

  /** @param request - Authenticated Host fetch operation supplied by the registration. */
  constructor(private readonly request: (path: string, init: RequestInit) => Promise<Response>) {}

  /** Load a fresh catalog without starting any optional runtime. @returns When the read settles. */
  load(): Promise<void> {
    if (this.abort.signal.aborted || this.store.getSnapshot().busy) return Promise.resolve()
    if (this.pending) return this.pending
    const revision = this.revision
    if (this.store.getSnapshot().value === null) this.update({ status: 'loading' })
    this.pending = this.read('/api/strugend/components', { method: 'GET' }).then((value) => {
      if (revision === this.revision) this.update({ value, status: 'ready', error: null })
    }).catch((error: unknown) => {
      if (revision === this.revision) this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { this.pending = undefined; this.poll() })
    return this.pending
  }

  /**
   * Start, cancel, or remove one optional runtime.
   * @param id - Catalog component identifier.
   * @param action - Requested installation operation.
   * @returns Whether the Host accepted the action.
   */
  change(id: ComponentId, action: 'install' | 'cancel' | 'remove'): Promise<boolean> {
    return this.mutate(`/api/strugend/components/${id}/${action}`, {})
  }

  /**
   * Record the user's installation choice, independently of download completion.
   * @param decision - Install explicitly, or keep Core alone.
   * @returns Whether the preference was saved.
   */
  setup(decision: 'install' | 'skip'): Promise<boolean> {
    return this.mutate('/api/strugend/components/setup', { decision })
  }

  /** Stop polling and cancel in-flight status requests when the plugin unloads. */
  dispose(): void {
    this.abort.abort()
    clearTimeout(this.timer)
  }

  private async mutate(path: string, body: object): Promise<boolean> {
    if (this.store.getSnapshot().busy || this.abort.signal.aborted) return false
    clearTimeout(this.timer)
    this.revision++
    this.update({ busy: true, error: null })
    try {
      const value = await this.read(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      this.update({ value, status: 'ready' })
      return !this.abort.signal.aborted
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally { this.update({ busy: false }); this.poll() }
  }

  private async read(path: string, init: RequestInit): Promise<ComponentSnapshot> {
    const response = await this.request(path, { ...init, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]) })
    if (!response.ok) throw new Error(`Optional tools request failed (${response.status}).`)
    return parseComponentSnapshot(await response.json())
  }

  private update(patch: Partial<ComponentViewState>): void {
    if (!this.abort.signal.aborted) this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private poll(): void {
    clearTimeout(this.timer)
    const active = this.store.getSnapshot().value?.components.some(row => row.state === 'downloading' || row.state === 'verifying')
    if (!this.abort.signal.aborted && active) {
      this.timer = setTimeout(() => { void this.load() }, this.store.getSnapshot().error === null ? 1000 : 5000)
    }
  }
}
