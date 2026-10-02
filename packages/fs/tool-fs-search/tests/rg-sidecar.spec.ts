import { delimiter as pathDelimiter, join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dependency, existsSync, statSync } = vi.hoisted(() => ({
  dependency: { rgPath: '/node_modules/@vscode/ripgrep/bin/rg' },
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))
const originalPlatform = process.platform
const originalExecPath = process.execPath

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync, statSync }
})

vi.mock('@vscode/ripgrep', () => ({ get rgPath() { return dependency.rgPath } }))

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReset()
  // No host rg by default, so the PATH fallback stays out of the packaged-path cases.
  statSync.mockReset().mockImplementation(() => { throw new Error('ENOENT') })
  dependency.rgPath = '/node_modules/@vscode/ripgrep/bin/rg'
  Reflect.deleteProperty(process, 'pkg')
  Reflect.deleteProperty(process.versions, 'electron')
  Reflect.defineProperty(process, 'platform', { configurable: true, enumerable: true, value: originalPlatform })
  process.execPath = originalExecPath
})

afterEach(() => {
  Reflect.deleteProperty(process, 'pkg')
  Reflect.deleteProperty(process.versions, 'electron')
  Reflect.defineProperty(process, 'platform', { configurable: true, enumerable: true, value: originalPlatform })
  process.execPath = originalExecPath
})

describe('ripgrep resolution', () => {
  it('uses the native sidecar beside the current executable', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    Reflect.defineProperty(process, 'platform', { configurable: true, enumerable: true, value: 'linux' })
    process.execPath = '/runtime/dsh'
    existsSync.mockReturnValue(true)
    const sidecar = '/runtime/dsh-rg'
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(sidecar)
    expect(existsSync).toHaveBeenCalledWith(sidecar)
  })

  it('uses a conventional executable name for the Windows ripgrep sidecar', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    Reflect.defineProperty(process, 'platform', { configurable: true, enumerable: true, value: 'win32' })
    process.execPath = 'C:\\runtime\\deepseek-harness-sdk-runtime-win-x64.exe'
    existsSync.mockReturnValue(true)
    const sidecar = 'C:\\runtime\\deepseek-harness-sdk-runtime-win-x64-rg.exe'
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(sidecar)
    expect(existsSync).toHaveBeenCalledWith(sidecar)
  })

  it('uses the dependency binary in an ordinary Node process', async () => {
    existsSync.mockReturnValue(true)
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependency.rgPath)
    expect(existsSync).toHaveBeenCalledWith(dependency.rgPath)
  })

  it('uses the dependency binary when a packaged runtime has no sidecar', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    existsSync.mockImplementation((path: string) => path === dependency.rgPath)
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependency.rgPath)
    const executable = parse(process.execPath)
    const sidecar = process.platform === 'win32'
      ? join(executable.dir, `${executable.name}-rg.exe`)
      : `${process.execPath}-rg`
    expect(existsSync).toHaveBeenCalledWith(sidecar)
  })

  it('uses the unpacked executable path for an Electron ASAR dependency', async () => {
    Reflect.defineProperty(process.versions, 'electron', { configurable: true, value: '44.0.0' })
    dependency.rgPath = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@vscode/ripgrep/bin/rg'
    existsSync.mockReturnValue(true)
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    const unpacked = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar.unpacked/dsh/node_modules/@vscode/ripgrep/bin/rg'
    await expect(resolveRgPath()).resolves.toBe(unpacked)
    expect(existsSync).toHaveBeenCalledWith(unpacked)
  })

  it('names the missing path and the packaging cause when the archive never unpacked it', async () => {
    // The shipped regression: the Electron rewrite is a string operation, so a release that
    // failed to unpack ripgrep produced a path that does not exist and a bare spawn error.
    Reflect.defineProperty(process.versions, 'electron', { configurable: true, value: '44.0.0' })
    const archived = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg'
    dependency.rgPath = archived
    existsSync.mockReturnValue(false)
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).rejects.toThrow(/app\.asar\.unpacked\/dsh\/node_modules\/@vscode\/ripgrep-darwin-arm64\/bin\/rg/u)
    await expect(resolveRgPath()).rejects.toThrow(/asarUnpack/u)
  })

  it('names the missing path when the installed dependency binary is absent', async () => {
    dependency.rgPath = '/node_modules/@vscode/ripgrep/bin/rg'
    existsSync.mockReturnValue(false)
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).rejects.toThrow(/no usable ripgrep binary: \/node_modules\/@vscode\/ripgrep\/bin\/rg is missing/u)
    await expect(resolveRgPath()).rejects.toThrow(/no rg executable is on PATH/u)
  })

  it('falls back to a host rg when the packaged binary is absent', async () => {
    // One bad release must not disable search for a session when the host has rg.
    const originalPath = process.env.PATH
    process.env.PATH = ['/opt/homebrew/bin', '/usr/bin'].join(pathDelimiter)
    try {
      existsSync.mockReturnValue(false)
      const hostRg = join('/opt/homebrew/bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
      statSync.mockImplementation((candidate: string) => {
        if (candidate === hostRg) return { isFile: () => true, mode: 0o755 }
        throw new Error('ENOENT')
      })
      const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

      await expect(resolveRgPath()).resolves.toBe(hostRg)
      expect(statSync).toHaveBeenCalledWith(hostRg)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('skips a PATH entry that is not executable and reports where it looked', async () => {
    // A data file called rg on PATH must not be handed to spawn.
    const originalPath = process.env.PATH
    process.env.PATH = ['/opt/homebrew/bin', '/usr/bin'].join(pathDelimiter)
    try {
      existsSync.mockReturnValue(false)
      statSync.mockImplementation(() => ({ isFile: () => true, mode: 0o644 }))
      const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

      const searched = /no rg executable is on PATH\. PATH was searched in \/opt\/homebrew\/bin, \/usr\/bin\./u
      await expect(resolveRgPath()).rejects.toThrow(searched)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('accepts an executable host rg on PATH', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/opt/homebrew/bin'
    try {
      existsSync.mockReturnValue(false)
      statSync.mockImplementation(() => ({ isFile: () => true, mode: 0o755 }))
      const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

      await expect(resolveRgPath()).resolves.toBe(join('/opt/homebrew/bin', process.platform === 'win32' ? 'rg.exe' : 'rg'))
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('prefers the packaged binary over a host rg', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/opt/homebrew/bin'
    try {
      existsSync.mockReturnValue(true)
      const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

      await expect(resolveRgPath()).resolves.toBe(dependency.rgPath)
      expect(statSync).not.toHaveBeenCalled()
    } finally {
      process.env.PATH = originalPath
    }
  })
})
