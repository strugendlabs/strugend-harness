/** Explicit persisted consent for signed updates; unsigned previews remain manual. */
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

/** Owns a small, private preference document independently of release discovery. */
export class UpdatePreferences {
  private mode: 'ask' | 'automatic' = 'ask'
  /** @param path - Private preference filename. @param eligible - Whether this build supports verified unattended installation. */
  constructor(private readonly path: string, private readonly eligible: () => boolean) {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (!value || typeof value !== 'object' || !('mode' in value) || !['ask', 'automatic'].includes(String(value.mode))) throw new Error('Invalid update preference.')
      this.mode = value.mode as 'ask' | 'automatic'
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  /** @returns Effective consent and this build's installation capability. */
  read(): { mode: 'ask' | 'automatic'; automaticAvailable: boolean } { return { mode: this.eligible() ? this.mode : 'ask', automaticAvailable: this.eligible() } }
  /** @param mode - Explicit user selection. @returns Persisted preference. */
  write(mode: unknown): ReturnType<UpdatePreferences['read']> {
    if (mode !== 'ask' && mode !== 'automatic') throw new Error('Invalid update preference.')
    if (mode === 'automatic' && !this.eligible()) throw new Error('Automatic installation requires a qualified signed build.')
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ mode }) + '\n', { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.path); this.mode = mode
    } finally { rmSync(temporary, { force: true }) }
    return this.read()
  }
}
