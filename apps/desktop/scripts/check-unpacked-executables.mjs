/**
 * Reject a packaged desktop app whose native executables are still inside app.asar.
 *
 * Electron serves fs reads from inside an archive, but a path inside app.asar is not a real
 * file: child_process.spawn fails on it (ENOTDIR) and the tool that needed the binary fails at
 * run time with a provider error that names nothing. The asarUnpack globs in
 * electron-builder-config.mjs are name based, so a bundler-chosen bare executable name (rg,
 * landlock-run, spawn-helper) is easy to miss, and nothing in the build noticed.
 *
 * This check reads the artifact that actually ships and classifies entries by file content
 * (Mach-O / ELF / PE magic) rather than by file name, so JavaScript shims that carry the
 * executable bit are not reported and an unusual native name still is.
 *
 * @see apps/desktop/scripts/electron-builder-config.mjs (asarUnpack)
 */
import { closeSync, openSync, readSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Leading signature of an executable this check treats as native, longest first. */
const NATIVE_SIGNATURES = [
  ['cffaedfe', 'mach-o 64-bit'],
  ['cefaedfe', 'mach-o 32-bit'],
  ['cafebabe', 'mach-o universal'],
  ['bebafeca', 'mach-o universal (swapped)'],
  ['cafebabf', 'mach-o 64-bit universal'],
  ['7f454c46', 'elf'],
  ['4d5a', 'pe'],
]

/** Bytes that precede the JSON header in every asar electron-builder writes. */
const HEADER_PREFIX_BYTES = 16
/** Byte offset of the JSON header's own length field. */
const JSON_LENGTH_OFFSET = 12

/**
 * The JSON header of an asar archive.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the parsed header, whose files tree describes every entry.
 */
export function readAsarHeader(asarPath) {
  const handle = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(HEADER_PREFIX_BYTES)
    readSync(handle, prefix, 0, HEADER_PREFIX_BYTES, 0)
    const jsonLength = prefix.readUInt32LE(JSON_LENGTH_OFFSET)
    const json = Buffer.alloc(jsonLength)
    readSync(handle, json, 0, jsonLength, HEADER_PREFIX_BYTES)
    return JSON.parse(json.toString('utf8'))
  } finally {
    closeSync(handle)
  }
}

/**
 * The number of bytes between the archive start and its first file payload.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the absolute offset that entry offsets are measured from.
 */
export function asarDataStart(asarPath) {
  const handle = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(8)
    readSync(handle, prefix, 0, 8, 0)
    return 8 + prefix.readUInt32LE(4)
  } finally {
    closeSync(handle)
  }
}

/**
 * Classify a file by its leading bytes.
 *
 * Classification is by content on purpose: the asar executable bit is set for shebang scripts
 * too, and an unpacked native (spawn-helper) does not always carry it, so a name or flag based
 * rule would both miss binaries and report scripts.
 *
 * @param magic - at least the first four bytes of the file.
 * @returns the native format name, or undefined for a script or text file.
 */
export function nativeFormatOf(magic) {
  const hex = magic.subarray(0, 4).toString('hex')
  for (const [signature, format] of NATIVE_SIGNATURES) {
    if (hex.startsWith(signature)) return format
  }
  return undefined
}

/**
 * Every native executable the archive keeps packed, which the app cannot spawn.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the packed native executables, each with its archive path and format.
 */
export function findPackedNativeExecutables(asarPath) {
  const header = readAsarHeader(asarPath)
  const dataStart = asarDataStart(asarPath)
  const handle = openSync(asarPath, 'r')
  const found = []
  try {
    const visit = (node, prefix) => {
      for (const name of Object.keys(node.files ?? {})) {
        const child = node.files[name]
        const path = prefix + '/' + name
        if (child.files !== undefined) {
          visit(child, path)
          continue
        }
        // The header stores offset as a decimal string, so coerce before trusting it.
        const offset = Number(child.offset)
        if (child.unpacked === true || !Number.isSafeInteger(offset)) continue
        const magic = Buffer.alloc(4)
        readSync(handle, magic, 0, 4, dataStart + offset)
        const format = nativeFormatOf(magic)
        if (format !== undefined) found.push({ path, size: child.size, format })
      }
    }
    visit(header, '')
  } finally {
    closeSync(handle)
  }
  return found
}

/**
 * The failure text for packed native executables, naming the artifact and the remedy.
 * @param violations - packed native executables reported by findPackedNativeExecutables.
 * @param source - the artifact path, for the message.
 * @returns a multi-line message suitable for a build failure.
 */
export function describePackedNativeExecutables(violations, source) {
  const lines = violations.map(row => '  ' + row.path + ' (' + row.size + ' bytes, ' + row.format + ')')
  const remedy = 'Add a matching asarUnpack pattern in apps/desktop/scripts/electron-builder-config.mjs'
  return [
    'desktop package: ' + source + ' keeps ' + violations.length + ' native executable(s) inside app.asar:',
    ...lines,
    'A native executable inside the archive cannot be started by child_process.spawn, so the tool that spawns it fails at run time.',
    remedy + '.',
  ].join('\n')
}

/**
 * Fail the build when the archive keeps a native executable packed.
 * @param asarPath - absolute path to a built app.asar.
 * @param source - the artifact path used in the message; defaults to the archive path.
 * @returns the number of packed native executables found, which must be zero.
 */
export function assertUnpackedNativeExecutables(asarPath, source = asarPath) {
  const violations = findPackedNativeExecutables(asarPath)
  if (violations.length > 0) throw new Error(describePackedNativeExecutables(violations, source))
  return violations.length
}

function main() {
  const target = process.argv[2]
  if (target === undefined) {
    process.stderr.write('usage: node check-unpacked-executables.mjs <path-to-app.asar>\n')
    process.exitCode = 2
    return
  }
  const violations = findPackedNativeExecutables(target)
  if (violations.length === 0) {
    process.stdout.write('desktop package: ' + basename(target) + ' keeps no native executable inside the archive\n')
    return
  }
  process.stderr.write(describePackedNativeExecutables(violations, target) + '\n')
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
