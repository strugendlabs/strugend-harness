/** Video import admits audio tracks and converts containers a media element cannot play. */
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { AgentOsStore } from '../src/agentos-store.ts'
import { AgentOsMedia } from '../src/agentos-media.ts'
import { resolveMediaExecutable } from '../src/agentos-media-executable.ts'

const ffmpeg = resolveMediaExecutable('ffmpeg', { platform: process.platform, environment: process.env })
const ffprobe = resolveMediaExecutable('ffprobe', { platform: process.platform, environment: process.env })

/** Render one fixture file with the real encoder and return its path. */
function render(root: string, name: string, args: readonly string[]): string {
  const path = join(root, name)
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, path])
  return path
}

/** The first video stream's codec name, as the stored file really carries it. */
function codecOf(path: string): string {
  const probed = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8' })) as {
    streams: Array<{ codec_type?: string; codec_name?: string }>
  }
  return probed.streams.find(stream => stream.codec_type === 'video')?.codec_name ?? 'none'
}

/** One engine over a private root, with its store closed by the caller's cleanup. */
function engineAt(root: string, observe: (progress: number) => void = () => {}): { engine: AgentOsMedia; store: AgentOsStore } {
  const store = new AgentOsStore(root, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  return {
    store,
    engine: new AgentOsMedia(join(root, 'media'), store, (event) => {
      if (event.type === 'media.progress') observe(event.progress)
    }),
  }
}

it('imports an audio-only file and serves it as playable audio', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-audio-'))
  const { engine, store } = engineAt(root)
  try {
    const track = render(root, 'theme.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame'])
    const [asset] = await engine.import([track])
    expect(asset!.media).toBe('audio')
    expect(asset!.width).toBe(0)
    expect(asset!.height).toBe(0)
    expect(asset!.duration).toBeCloseTo(1, 0)
    expect(asset!.path.endsWith('.mp3')).toBe(true)
    const response = await engine.serve(new Request(asset!.url))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    // The library holds exactly the one file the import created.
    expect(readdirSync(join(root, 'media', 'imports'))).toHaveLength(1)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 60_000)

it('converts a container a media element cannot play into seekable MP4 and reports progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-convert-'))
  const progress: number[] = []
  const { engine, store } = engineAt(root, (value) => { progress.push(value) })
  try {
    const legacy = render(root, 'legacy.avi', [
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30', '-t', '1', '-c:v', 'mpeg4',
    ])
    expect(codecOf(legacy)).toBe('mpeg4')
    const [asset] = await engine.import([legacy])
    expect(asset!.media).toBe('video')
    expect(asset!.path.endsWith('.mp4')).toBe(true)
    expect(codecOf(asset!.path)).toBe('h264')
    expect(asset!.duration).toBeCloseTo(1, 0)
    expect(progress.at(-1)).toBe(100)
    const response = await engine.serve(new Request(asset!.url, { headers: { range: 'bytes=0-99' } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect((await response.arrayBuffer()).byteLength).toBe(100)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 90_000)

it('names the file when the chosen one carries no media at all', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-junk-'))
  const { engine, store } = engineAt(root)
  try {
    const notes = join(root, 'notes.txt')
    writeFileSync(notes, 'not a video')
    await expect(engine.import([notes])).rejects.toThrow('notes.txt is not a media file')
    expect(engine.list()).toHaveLength(0)
    // A refused import leaves no bytes behind in the library.
    expect(readdirSync(join(root, 'media', 'imports'))).toHaveLength(0)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 60_000)

it('converts an audio container the player cannot decode and answers suffix ranges', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-aiff-'))
  const { engine, store } = engineAt(root)
  try {
    const legacy = render(root, 'voice.aiff', [
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16be',
    ])
    const [asset] = await engine.import([legacy])
    expect(asset!.media).toBe('audio')
    expect(asset!.path.endsWith('.m4a')).toBe(true)
    const whole = await engine.serve(new Request(asset!.url))
    expect(whole.headers.get('content-type')).toBe('audio/mp4')
    const size = statSync(asset!.path).size
    // The suffix form asks for the last 100 bytes of a seekable response.
    const tail = await engine.serve(new Request(asset!.url, { headers: { range: 'bytes=-100' } }))
    expect(tail.status).toBe(206)
    expect(tail.headers.get('content-range')).toBe(`bytes ${size - 100}-${size - 1}/${size}`)
    expect((await tail.arrayBuffer()).byteLength).toBe(100)
    const past = await engine.serve(new Request(asset!.url, { headers: { range: `bytes=${size}-` } }))
    expect(past.status).toBe(416)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 90_000)

it('names the file and says why when the chosen one has no usable duration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-empty-'))
  const { engine, store } = engineAt(root)
  try {
    const empty = render(root, 'zero.wav', ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '0'])
    await expect(engine.import([empty])).rejects.toThrow(/zero\.wav is not a media file this application can read/u)
    expect(engine.list()).toHaveLength(0)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 60_000)

it('names a clip that moved before an export instead of leaking a filesystem error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-moved-'))
  const { engine, store } = engineAt(root)
  try {
    const source = render(root, 'take.mp4', [
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ])
    const [asset] = await engine.import([source])
    rmSync(asset!.path, { force: true })
    await expect(engine.edit({ clips: [{ path: asset!.path, start: 0, end: 0.5 }], format: 'square' }))
      .rejects.toThrow(/has moved or been deleted/u)
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 60_000)
