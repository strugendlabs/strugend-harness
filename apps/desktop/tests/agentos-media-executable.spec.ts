import { expect, it } from 'vitest'
import { resolveMediaExecutable } from '../src/agentos-media-executable.ts'

it('finds Windows video tools in a case-insensitive PATH with spaces', () => {
  const executable = 'C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe'
  expect(resolveMediaExecutable('ffmpeg', { platform: 'win32', environment: { Path: '.;C:\\missing;C:\\Program Files\\FFmpeg\\bin' },
    isFile: path => path === executable })).toBe(executable)
})

it('prefers bundled tools and never searches the current directory', () => {
  const visited: string[] = []
  expect(() => resolveMediaExecutable('ffprobe', { platform: 'win32', resources: 'C:\\Strugend\\resources', environment: { PATH: ';.;relative' },
    isFile: (path) => { visited.push(path); return false } })).toThrow('Install FFmpeg')
  expect(visited).toEqual(['C:\\Strugend\\resources\\media\\ffprobe.exe'])
  expect(resolveMediaExecutable('ffprobe', { platform: 'darwin', resources: '/app/resources', environment: { PATH: '/usr/bin' },
    isFile: () => true })).toBe('/app/resources/media/ffprobe')
})

it('rejects an invalid explicit override instead of falling back', () => {
  expect(() => resolveMediaExecutable('ffmpeg', { platform: 'win32', environment: { AGENT_OS_FFMPEG: 'ffmpeg.exe' },
    isFile: () => true })).toThrow('existing executable file')
  expect(() => resolveMediaExecutable('ffmpeg', { platform: 'darwin', environment: { AGENT_OS_FFMPEG: '/missing' },
    isFile: () => false })).toThrow('existing executable file')
  expect(resolveMediaExecutable('ffmpeg', { platform: 'darwin', environment: { AGENT_OS_FFMPEG: '/opt/video/ffmpeg' },
    isFile: () => true })).toBe('/opt/video/ffmpeg')
})
