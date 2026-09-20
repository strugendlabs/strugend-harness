import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createSmokeDesktopBridge } from '../scripts/smoke-runtime.ts'

it('boots with an isolated empty skill directory and no access to real credentials or desktop actions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'strugend-bridge-'))
  try {
    const bridge = createSmokeDesktopBridge(home)
    expect(await bridge({ method: 'skill-root' })).toBe(join(home, 'skills'))
    expect(statSync(join(home, 'skills')).isDirectory()).toBe(true)
    expect(await bridge({ method: 'credential', operation: 'get', key: 'DEEPSEEK_API_KEY' })).toBeNull()
    await expect(bridge({ method: 'credential', operation: 'set', key: 'DEEPSEEK_API_KEY', value: 'fixture' })).rejects.toThrow('unsupported')
    await expect(bridge({ method: 'browser', action: 'open' })).rejects.toThrow('unsupported')
    await expect(bridge(null)).rejects.toThrow('unsupported')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
