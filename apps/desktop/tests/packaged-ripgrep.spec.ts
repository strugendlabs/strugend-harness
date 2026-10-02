/**
 * The packaged app spawns ripgrep through the @vscode/ripgrep loader, and
 * Electron cannot spawn an executable that lives inside app.asar. This spec ties
 * the release packaging globs to the executable the loader actually resolves, so
 * a pattern that unpacks nothing is caught here instead of by a shipped build
 * whose glob and grep tools always fail.
 */

import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const RELEASE_ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.example.desktop',
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_API_KEY: '/private/credentials/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
}

/** Where electron-builder places the dereferenced pnpm dependency tree. */
const PACKAGED_DSH_ROOT = 'dsh/node_modules'

/** Windows ships rg.exe; every other target ships a bare rg. */
const BINARY_NAME = process.platform === 'win32' ? 'rg.exe' : 'rg'

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

/** The loader package the search tools depend on, resolved from its dependent. */
function loaderEntry(): string | undefined {
  const require = createRequire(new URL('../../../packages/fs/tool-fs-search/package.json', import.meta.url))
  try {
    return require.resolve('@vscode/ripgrep')
  } catch {
    return undefined
  }
}

/** The package root above the resolved entry file, whatever entry it names. */
function packageDirectoryOf(entry: string): string | undefined {
  let directory = dirname(entry)
  for (let step = 0; step < 4; step += 1) {
    if (basename(directory) === 'ripgrep') return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

const wrapperEntry = loaderEntry()
const wrapperDirectory = wrapperEntry === undefined ? undefined : packageDirectoryOf(wrapperEntry)

/**
 * The platform package the loader resolves, which sits beside the loader in the
 * store rather than inside it. Absent when optional dependencies were omitted.
 */
const platformPackageName = 'ripgrep-' + process.platform + '-' + process.arch
const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg'
const platformBinary = wrapperDirectory === undefined
  ? undefined
  : join(dirname(wrapperDirectory), platformPackageName, 'bin', binaryName)
/** False when optional dependencies were omitted for this host. */
const hostHasPlatformPackage = platformBinary !== undefined && existsSync(platformBinary)

/** The location that executable occupies once the pnpm symlink is dereferenced. */
function packagedPathOf(binary: string): string {
  const marker = '/@vscode/'
  const portable = portablePath(binary)
  const start = portable.lastIndexOf(marker)
  if (start === -1) throw new Error('unexpected ripgrep binary location: ' + binary)
  return PACKAGED_DSH_ROOT + portable.slice(start)
}

const packagedRipgrep = platformBinary === undefined || !hostHasPlatformPackage
  ? undefined
  : packagedPathOf(platformBinary)

function expandBraces(pattern: string): string[] {
  const braces = /[{]([^{}]*)[}]/u.exec(pattern)
  if (braces === null) return [pattern]
  const whole = braces[0]
  const options = braces[1] ?? ''
  const head = pattern.slice(0, braces.index)
  const tail = pattern.slice(braces.index + whole.length)
  return options.split(',').flatMap(option => expandBraces(head + option + tail))
}

/** One path segment: brace alternatives, then star wildcards, then literal text. */
function matchesSegment(pattern: string, value: string): boolean {
  return expandBraces(pattern).some((expanded) => {
    const source = expanded.split('*').map(part => RegExp.escape(part)).join('[^/]*')
    return new RegExp('^' + source + '$', 'u').test(value)
  })
}

/**
 * The electron-builder glob subset its own patterns use: a double-star segment
 * spanning directories, a single star within a segment, and brace alternatives.
 */
function matchesGlob(patterns: readonly string[], path: string): boolean {
  const target = path.split('/')
  const matchesAt = (segments: string[], segment: number, index: number): boolean => {
    if (segment === segments.length) return index === target.length
    const current = segments[segment] ?? ''
    if (current === '**') {
      for (let skip = index; skip <= target.length; skip += 1) {
        if (matchesAt(segments, segment + 1, skip)) return true
      }
      return false
    }
    if (index >= target.length || !matchesSegment(current, target[index] ?? '')) return false
    return matchesAt(segments, segment + 1, index + 1)
  }
  return patterns.some(pattern => matchesAt(pattern.split('/'), 0, 0))
}

/** The packaged path this build target gives ripgrep, independent of the installed store. */
const packagedRipgrepForTarget = PACKAGED_DSH_ROOT + '/@vscode/ripgrep-' + process.platform + '-' + process.arch + '/bin/' + BINARY_NAME

/** The Linux sandbox launcher, which is also a bare executable name. */
const PACKAGED_SANDBOX_LAUNCHER = PACKAGED_DSH_ROOT + '/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run'

describe('packaged ripgrep', () => {
  // The release entry evaluates createElectronBuilderConfig() against process.env
  // at import time, so the release environment must exist before the import.
  beforeAll(() => {
    for (const [name, value] of Object.entries(RELEASE_ENVIRONMENT)) vi.stubEnv(name, value)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('unpacks the executable this target packages', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
    expect(packagedRipgrepForTarget).toMatch(
      /^dsh[/]node_modules[/]@vscode[/]ripgrep-[a-z0-9]+-[a-z0-9]+[/]bin[/]rg(?:[.]exe)?$/u,
    )
    expect(matchesGlob(config.asarUnpack, packagedRipgrepForTarget)).toBe(true)
  })

  it('unpacks the Linux sandbox launcher, which also has no file extension', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
    expect(matchesGlob(config.asarUnpack, PACKAGED_SANDBOX_LAUNCHER)).toBe(true)
  })

  it('rejects the exact pattern list that shipped a broken build', () => {
    // The regression is encoded here: this is the shipped list, and the launcher below is the
    // binary it left inside the archive.
    const shipped = [
      '**/*.{node,dylib,dll,so,exe}',
      '**/*.so.*',
      '**/spawn-helper',
      '**/@vscode/ripgrep/bin/rg',
    ]
    const launcher = PACKAGED_DSH_ROOT + '/@vscode/ripgrep-darwin-arm64/bin/rg'
    expect(matchesGlob(shipped, launcher)).toBe(false)
    expect(matchesGlob([...shipped, '**/@vscode/ripgrep*/bin/rg'], launcher)).toBe(true)
  })

  it.skipIf(!hostHasPlatformPackage)('unpacks the path the loader really resolves on this host', async () => {
    if (packagedRipgrep === undefined) return
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
    // Ties the target-derived path above to the dependency actually installed here.
    expect(packagedRipgrep).toBe(packagedRipgrepForTarget)
    expect(matchesGlob(config.asarUnpack, packagedRipgrep)).toBe(true)
  })

  it.skipIf(!hostHasPlatformPackage)('resolves the executable beside the loader, not inside it', () => {
    // The loader package ships no bin/ directory; naming it alone unpacks nothing.
    expect(wrapperDirectory).toBeDefined()
    expect(existsSync(join(wrapperDirectory ?? '', 'bin'))).toBe(false)
  })

  it.skipIf(!hostHasPlatformPackage)('agrees with the path the loader returns', async () => {
    if (wrapperEntry === undefined || platformBinary === undefined) return
    const loader = await import(pathToFileURL(wrapperEntry).href) as { rgPath: string }
    // The loader reports the store realpath; the packaging path below is the same
    // file through the sibling symlink, so compare what they resolve to.
    expect(realpathSync(loader.rgPath)).toBe(realpathSync(platformBinary))
    expect(packagedPathOf(loader.rgPath)).toBe(packagedRipgrep)
  })
})
