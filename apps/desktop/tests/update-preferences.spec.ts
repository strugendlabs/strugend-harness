import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { UpdatePreferences } from '../src/update-preferences.ts'
it('defaults to consent and preserves optional automatic installation only for eligible builds', () => {
  const root = mkdtempSync(join(tmpdir(), 'strugend-preference-'))
  try {
    const path = join(root, 'preference.json')
    const signed = new UpdatePreferences(path, () => true)
    expect(signed.read().mode).toBe('ask')
    signed.write('automatic')
    expect(new UpdatePreferences(path, () => true).read().mode).toBe('automatic')
    const preview = new UpdatePreferences(path, () => false)
    expect(preview.read()).toEqual({ mode: 'ask', automaticAvailable: false })
    expect(() => preview.write('automatic')).toThrow(/signed/)
    preview.write('ask')
    expect(new UpdatePreferences(path, () => true).read().mode).toBe('ask')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
