/** Local organization, memory, recording metadata, and encrypted secrets for Agent OS. */
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  OrganizationMutation,
  OrganizationState,
  Recording,
  VaultItem,
  MediaAsset,
} from '@deepseek-ai/dsh-agentos-protocol'

/** OS-backed cryptography supplied by the Electron main process. */
export interface SecretCipher {
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

function label(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || value.includes('\0'))
    throw new Error('Enter a name between 1 and 160 characters.')
  return value.trim()
}

function identity(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[\w-]{1,160}$/u.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    throw new Error('Invalid item identifier.')
  return value
}

/** Stores application metadata separately from Harness conversation logs. */
export class AgentOsStore {
  private readonly db: DatabaseSync
  private readonly memoryPath: string

  /** @param root - Private application directory. @param cipher - OS-backed encryption functions. */
  constructor(
    private readonly root: string,
    private readonly cipher: SecretCipher,
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const path = join(root, 'agent-os.sqlite')
    this.db = new DatabaseSync(path)
    chmodSync(path, 0o600)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > 1) {
      this.db.close()
      throw new Error('This Agent OS database needs a newer application version.')
    }
    this.db.exec(
      'PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value BLOB NOT NULL); PRAGMA user_version=1; COMMIT;',
    )
    this.memoryPath = join(root, 'soul.md')
    if (!existsSync(this.memoryPath))
      writeFileSync(this.memoryPath, '# About me\n\n## Preferences\n\n## Important facts\n\n## Goals\n', {
        mode: 0o600,
      })
  }

  /** Release the database after owned work has stopped. */
  close(): void {
    this.db.close()
  }

  private read<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)
    return row === undefined ? fallback : (JSON.parse(String(row.value)) as T)
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  /** @returns The durable sidebar tree and its optimistic-concurrency revision. */
  organization(): OrganizationState {
    return this.read('organization', { revision: 0, groups: [], assignments: {}, pinned: [] })
  }

  /** @param revision - Last read revision. @param mutation - One atomic tree operation. @returns Committed tree. */
  mutateOrganization(revision: number, mutation: OrganizationMutation): OrganizationState {
    const state = this.organization()
    if (revision !== state.revision) throw new Error('The sidebar changed. Try again with the latest state.')
    const group = (id: string) => {
      const found = state.groups.find(item => item.id === identity(id))
      if (found === undefined) throw new Error('This group no longer exists.')
      return found
    }
    switch (mutation.kind) {
      case 'create': {
        if (mutation.parentId !== null) group(mutation.parentId)
        state.groups.push({
          id: randomUUID(),
          parentId: mutation.parentId,
          name: label(mutation.name),
          order: state.groups.length,
          collapsed: false,
        })
        break
      }
      case 'rename':
        group(mutation.id).name = label(mutation.name)
        break
      case 'collapse': {
        if (typeof mutation.collapsed !== 'boolean') throw new Error('Invalid expanded state.')
        group(mutation.id).collapsed = mutation.collapsed
        break
      }
      case 'move': {
        const moving = group(mutation.id)
        let parent = mutation.parentId
        while (parent !== null) {
          if (parent === moving.id) throw new Error('A group cannot contain itself or one of its parents.')
          parent = group(parent).parentId
        }
        moving.parentId = mutation.parentId
        const siblings = state.groups
          .filter(item => item.parentId === moving.parentId && item.id !== moving.id)
          .sort((a, b) => a.order - b.order)
        const index =
          mutation.beforeId === undefined
            ? siblings.length
            : siblings.findIndex(item => item.id === mutation.beforeId)
        if (index < 0) throw new Error('The destination group moved. Try again.')
        siblings.splice(index, 0, moving)
        siblings.forEach((item, order) => {
          item.order = order
        })
        break
      }
      case 'delete': {
        const removed = group(mutation.id)
        state.groups = state.groups.filter(item => item.id !== removed.id)
        for (const item of state.groups) if (item.parentId === removed.id) item.parentId = removed.parentId
        for (const [sessionId, groupId] of Object.entries(state.assignments)) {
          if (groupId !== removed.id) continue
          if (removed.parentId === null) {
            state.assignments = Object.fromEntries(Object.entries(state.assignments).filter(([id]) => id !== sessionId))
          }
          else state.assignments[sessionId] = removed.parentId
        }
        break
      }
      case 'assign':
        identity(mutation.sessionId)
        if (mutation.groupId === null) {
          state.assignments = Object.fromEntries(Object.entries(state.assignments).filter(([id]) => id !== mutation.sessionId))
        }
        else {
          group(mutation.groupId)
          state.assignments[mutation.sessionId] = mutation.groupId
        }
        break
      case 'pin':
        identity(mutation.sessionId)
        if (typeof mutation.pinned !== 'boolean') throw new Error('Invalid pinned state.')
        state.pinned = state.pinned.filter(id => id !== mutation.sessionId)
        if (mutation.pinned) state.pinned.push(mutation.sessionId)
        break
      default:
        throw new Error('Unknown sidebar operation.')
    }
    state.revision++
    this.write('organization', state)
    return state
  }

  /** @returns Editable memory with a content revision for concurrent edits. */
  memory(): { text: string; revision: string; path: string } {
    const text = readFileSync(this.memoryPath, 'utf8')
    return { text, revision: createHash('sha256').update(text).digest('hex'), path: this.memoryPath }
  }

  /** @param text - New memory text. @param revision - Previously read content digest. @returns Saved memory. */
  writeMemory(text: string, revision: string): ReturnType<AgentOsStore['memory']> {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 65_536 || text.includes('\0'))
      throw new Error('Memory must be text smaller than 64 KB.')
    const previous = this.memory()
    if (previous.revision !== revision) throw new Error('Memory changed elsewhere. Reload before saving.')
    const history = join(this.root, 'memory-history')
    mkdirSync(history, { recursive: true, mode: 0o700 })
    writeFileSync(join(history, `${previous.revision}.md`), previous.text, { mode: 0o600 })
    const pending = `${this.memoryPath}.${randomUUID()}.tmp`
    writeFileSync(pending, text, { mode: 0o600, flag: 'wx' })
    renameSync(pending, this.memoryPath)
    return this.memory()
  }

  /** @param key - Trusted credential reference. @returns Decrypted value inside the trusted process only. */
  secret(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key)
    return row === undefined ? undefined : this.cipher.decrypt(Buffer.from(row.value as Uint8Array))
  }

  /** @param key - Trusted reference. @param value - Secret value; undefined removes it. */
  setSecret(key: string, value: string | undefined): void {
    if (value === undefined) {
      this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key)
      return
    }
    const encrypted = this.cipher.encrypt(value)
    this.db
      .prepare('INSERT INTO secrets VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, encrypted)
  }

  /** @returns Non-secret vault labels only. */
  vault(): VaultItem[] {
    return this.read('vault', [])
  }

  /** @param entry - User-entered login. @returns Saved labels, excluding the password. */
  saveVault(entry: { id?: string; name: string; username: string; origin: string; password: string }): VaultItem[] {
    const origin = new URL(entry.origin)
    if (origin.protocol !== 'https:' || origin.username || origin.password)
      throw new Error('Use the exact HTTPS website address.')
    if (
      typeof entry.username !== 'string' ||
      entry.username.length > 500 ||
      typeof entry.password !== 'string' ||
      !entry.password ||
      entry.password.length > 16_384
    )
      throw new Error('Enter a username and password within the supported length.')
    const item: VaultItem = {
      id: entry.id === undefined ? randomUUID() : identity(entry.id),
      name: label(entry.name),
      username: entry.username,
      origin: origin.origin,
      updatedAt: Date.now(),
    }
    const items = this.vault().filter(value => value.id !== item.id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.setSecret(`vault:${item.id}`, entry.password)
      this.write('vault', [...items, item])
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.vault()
  }

  /** @param id - Login to remove, including encrypted material. */
  removeVault(id: string): void {
    identity(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.setSecret(`vault:${id}`, undefined)
      this.write(
        'vault',
        this.vault().filter(item => item.id !== id),
      )
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** @returns Persisted media library. */
  media(): MediaAsset[] {
    return this.read('media', [])
  }
  /** @param asset - Imported file or completed export. */
  saveMedia(asset: MediaAsset): void {
    this.write('media', [...this.media().filter(item => item.id !== asset.id), asset])
  }

  /** @returns Redacted recorded demonstrations. */
  recordings(): Recording[] {
    return this.read('recordings', [])
  }

  /** @param recording - Captured or reviewed demonstration. */
  saveRecording(recording: Recording): void {
    this.write('recordings', [...this.recordings().filter(item => item.id !== recording.id), recording])
  }

  /**
   * @param id - Demonstration identity.
   * @param name - Portable skill slug.
   * @param instructions - User-reviewed instructions.
   * @returns Skill file path.
   */
  saveSkill(id: string, name: string, instructions: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 80)
      throw new Error('Use a short lowercase skill-name with hyphens.')
    if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 65_536)
      throw new Error('Add the reviewed skill instructions.')
    const recording = this.recordings().find(item => item.id === id)
    if (recording === undefined) throw new Error('Recording not found.')
    const folder = join(this.root, 'skills', name)
    if (existsSync(folder)) throw new Error('That skill already exists. Choose a new version name.')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const path = join(folder, 'SKILL.md')
    writeFileSync(
      path,
      `---\nname: ${name}\ndescription: ${JSON.stringify(recording.title)}\n---\n\n${instructions.trim()}\n`,
      { mode: 0o600 },
    )
    writeFileSync(join(folder, 'recording.json'), JSON.stringify(recording, null, 2), { mode: 0o600 })
    this.saveRecording({ ...recording, skillPath: path })
    return path
  }
}
