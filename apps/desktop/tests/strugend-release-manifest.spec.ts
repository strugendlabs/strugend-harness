/** Release manifests are emitted only for a complete, hashed native set. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'

it('hashes every native artifact and refuses an incomplete release', () => {
  const root = mkdtempSync(join(tmpdir(), 'strugend-release-')), version = '1.0.1-alpha.1'
  try {
    const args = [resolve('apps/desktop/scripts/strugend-release-manifest.mjs'), root, version]
    expect(() => execFileSync(process.execPath, args, { stdio: 'pipe' })).toThrow()
    for (const target of ['win-x64', 'mac-arm64', 'mac-x64'])
      writeFileSync(join(root, `strugend-harness-${version}-${target}.${target.startsWith('win') ? 'exe' : 'dmg'}`), target)
    execFileSync(process.execPath, args, { stdio: 'pipe' })
    const manifest = JSON.parse(readFileSync(join(root, 'strugend-update.json'), 'utf8')) as {
      version: string
      installers: Array<{ target: string; sha256: string; bytes: number }>
    }
    expect(manifest.version).toBe(version); expect(manifest.installers).toHaveLength(3)
    for (const installer of manifest.installers) {
      expect(installer.bytes).toBe(Buffer.byteLength(installer.target))
      expect(installer.sha256).toBe(createHash('sha256').update(installer.target).digest('hex'))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
