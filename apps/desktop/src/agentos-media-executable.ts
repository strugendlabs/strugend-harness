/** Resolve the native video tools without a shell or current-directory PATH lookup. */
import { posix, win32 } from 'node:path'
import { statSync } from 'node:fs'

/**
 * Find a configured, bundled, or installed FFmpeg tool on the selected platform.
 * @param name - Required video executable.
 * @param options - Environment and resources in the selected platform's path syntax, with injectable file lookup.
 * @returns Absolute executable path; an invalid explicit override fails before fallback.
 */
export function resolveMediaExecutable(name: 'ffmpeg' | 'ffprobe', options: {
  platform: NodeJS.Platform
  environment: NodeJS.ProcessEnv
  resources?: string
  isFile?: (path: string) => boolean
}): string {
  const windows = options.platform === 'win32'
  const paths = windows ? win32 : posix
  const isFile = options.isFile ?? ((path: string) => {
    try { return statSync(path).isFile() }
    catch { return false }
  })
  const variable = `AGENT_OS_${name.toUpperCase()}`
  const configured = options.environment[variable]
  if (configured !== undefined) {
    if (!paths.isAbsolute(configured) || !isFile(configured)) throw new Error(`${variable} must point to an existing executable file.`)
    return configured
  }
  const filename = windows ? `${name}.exe` : name
  const searchPath = Object.entries(options.environment).find(([key]) => windows ? key.toUpperCase() === 'PATH' : key === 'PATH')?.[1] ?? ''
  const directories = searchPath.split(paths.delimiter).filter(path => paths.isAbsolute(path))
  if (options.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin')
  const candidates = [
    ...(options.resources ? [paths.join(options.resources, 'media', filename)] : []),
    ...directories.map(directory => paths.join(directory, filename)),
  ]
  const executable = candidates.find(isFile)
  if (executable) return executable
  throw new Error(windows
    ? `Install FFmpeg and add its bin folder to PATH, or set ${variable} to its .exe file. Restart Strugend after changing PATH.`
    : `Install FFmpeg, or set ${variable} to its executable. Restart Strugend after changing PATH.`)
}
