/** A native executable an asar archive still keeps packed. */
export interface PackedNativeExecutable {
  /** Archive-relative path, for example /dsh/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg. */
  readonly path: string
  /** Size in bytes, from the archive header. */
  readonly size: number
  /** Detected native format, for example mach-o 64-bit. */
  readonly format: string
}

/**
 * Read an asar archive's JSON header.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the parsed header, whose files tree describes every entry.
 */
export function readAsarHeader(asarPath: string): { files?: Record<string, unknown> }

/**
 * The absolute offset inside the archive that entry offsets are measured from.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the first file payload's absolute byte offset.
 */
export function asarDataStart(asarPath: string): number

/**
 * Classify a file by its leading bytes.
 * @param magic - at least the first four bytes of the file.
 * @returns the native format name, or undefined for a script or text file.
 */
export function nativeFormatOf(magic: Uint8Array): string | undefined

/**
 * Every native executable the archive keeps packed, which the app cannot spawn.
 * @param asarPath - absolute path to a built app.asar.
 * @returns the packed native executables.
 */
export function findPackedNativeExecutables(asarPath: string): PackedNativeExecutable[]

/**
 * The failure text for packed native executables, naming the artifact and the remedy.
 * @param violations - packed native executables to report.
 * @param source - the artifact path shown in the message.
 * @returns a multi-line message suitable for a build failure.
 */
export function describePackedNativeExecutables(violations: readonly PackedNativeExecutable[], source: string): string

/**
 * Fail when the archive keeps a native executable packed.
 * @param asarPath - absolute path to a built app.asar.
 * @param source - the artifact path used in the message; defaults to the archive path.
 * @returns the number of packed native executables found, which must be zero.
 */
export function assertUnpackedNativeExecutables(asarPath: string, source?: string): number
