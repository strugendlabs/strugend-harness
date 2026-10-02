/**
 * The unpacked-executable check is the only thing standing between a correct-looking build and
 * a shipped app whose grep and glob tools cannot start ripgrep. These specs build real asar
 * archives, so the header offsets, the content classification and the pass/fail decision are
 * all exercised against bytes rather than against a mock.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertUnpackedNativeExecutables,
  describePackedNativeExecutables,
  findPackedNativeExecutables,
  nativeFormatOf,
} from '../scripts/check-unpacked-executables.mjs'

const CHECKER = fileURLToPath(new URL('../scripts/check-unpacked-executables.mjs', import.meta.url))

/** Leading bytes of each format the check understands, plus a JavaScript shebang. */
const MACHO_64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01])
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])
const PE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
const SHEBANG = Buffer.from('#!/usr/bin/env node\nconsole.log(1)\n')

interface FixtureFile {
  readonly path: string
  readonly content: Buffer
  readonly executable?: boolean
  readonly unpacked?: boolean
}

let workspace: string | undefined

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  workspace = undefined
})

/**
 * Write an asar archive with the layout electron-builder produces: a four-byte pickle size, the
 * header pickle size, its payload size, the JSON length, then the JSON and the file payloads.
 */
function writeAsar(files: readonly FixtureFile[]): string {
  workspace = mkdtempSync(join(tmpdir(), 'dsh-asar-'))
  const root: { files: Record<string, unknown> } = { files: {} }
  const payloads: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    let node = root as { files: Record<string, { files?: Record<string, unknown> }> }
    for (const segment of segments.slice(0, -1)) {
      node.files[segment] ??= { files: {} }
      node = node.files[segment] as typeof node
    }
    const entry: Record<string, unknown> = { size: file.content.length }
    if (file.unpacked === true) entry.unpacked = true
    else {
      entry.offset = String(offset)
      payloads.push(file.content)
      offset += file.content.length
    }
    if (file.executable === true) entry.executable = true
    node.files[segments[segments.length - 1] ?? ''] = entry
  }
  const json = Buffer.from(JSON.stringify(root))
  const padding = (4 - ((4 + json.length) % 4)) % 4
  const payloadSize = 4 + json.length + padding
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(payloadSize + 4, 4)
  prefix.writeUInt32LE(payloadSize, 8)
  prefix.writeUInt32LE(json.length, 12)
  const target = join(workspace, 'app.asar')
  writeFileSync(target, Buffer.concat([prefix, json, Buffer.alloc(padding), ...payloads]))
  return target
}

const RIPGREP = '/dsh/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg'

describe('packaged native executables', () => {
  it('classifies content, not file names', () => {
    expect(nativeFormatOf(MACHO_64)).toBe('mach-o 64-bit')
    expect(nativeFormatOf(ELF)).toBe('elf')
    expect(nativeFormatOf(PE)).toBe('pe')
    expect(nativeFormatOf(SHEBANG)).toBeUndefined()
  })

  it('reports a native executable left inside the archive', () => {
    const asar = writeAsar([{ path: RIPGREP, content: MACHO_64, executable: true }])
    expect(findPackedNativeExecutables(asar)).toEqual([
      { path: RIPGREP, size: MACHO_64.length, format: 'mach-o 64-bit' },
    ])
    expect(() => { assertUnpackedNativeExecutables(asar) })
      .toThrow(/ripgrep-darwin-arm64\/bin\/rg/u)
  })

  it('accepts the same executable once it is marked unpacked', () => {
    const asar = writeAsar([{ path: RIPGREP, content: MACHO_64, executable: true, unpacked: true }])
    expect(findPackedNativeExecutables(asar)).toEqual([])
    expect(assertUnpackedNativeExecutables(asar)).toBe(0)
  })

  it('does not report JavaScript shims that carry the executable bit', () => {
    // The shipped archive flags many *.js and shebang files executable; only real binaries
    // fail to spawn from inside an archive, so a checker that named them would be noise.
    const asar = writeAsar([
      { path: '/dsh/node_modules/js-yaml/bin/js-yaml.js', content: SHEBANG, executable: true },
      { path: '/dsh/node_modules/which/bin/node-which', content: SHEBANG, executable: true },
      { path: '/dsh/node_modules/@aws-sdk/types/package.json', content: Buffer.from('{\n  "a": 1\n}'), executable: true },
    ])
    expect(findPackedNativeExecutables(asar)).toEqual([])
  })

  it('reports every packed native format and names each one', () => {
    const asar = writeAsar([
      { path: RIPGREP, content: MACHO_64, executable: true },
      { path: '/dsh/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run', content: ELF },
      { path: '/dsh/node_modules/example/tool.exe', content: PE },
    ])
    const violations = findPackedNativeExecutables(asar)
    expect(violations.map(row => row.format).sort()).toEqual(['elf', 'mach-o 64-bit', 'pe'])
    const message = describePackedNativeExecutables(violations, 'app.asar')
    for (const row of violations) expect(message).toContain(row.path)
    expect(message).toContain('asarUnpack')
  })

  it('reports usage instead of passing when it is given no archive', () => {
    // A caller that forgets the argument must not look like a clean build.
    const usage = spawnSync(process.execPath, [CHECKER], { encoding: 'utf8' })
    expect(usage.status).toBe(2)
    expect(usage.stderr).toContain('usage:')
  })

  it('fails the command line for a packed executable and passes for a clean archive', () => {
    const packed = writeAsar([{ path: RIPGREP, content: MACHO_64, executable: true }])
    const failed = spawnSync(process.execPath, [CHECKER, packed], { encoding: 'utf8' })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain(RIPGREP)

    const clean = writeAsar([{ path: RIPGREP, content: MACHO_64, executable: true, unpacked: true }])
    const passed = spawnSync(process.execPath, [CHECKER, clean], { encoding: 'utf8' })
    expect(passed.status).toBe(0)
    expect(passed.stdout).toContain('keeps no native executable')
  })
})
