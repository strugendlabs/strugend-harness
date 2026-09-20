/** Real FFmpeg export and ranged preview from a two-clip edit recipe. */
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { AgentOsStore } from '../src/agentos-store.ts'
import { AgentOsMedia } from '../src/agentos-media.ts'
import { resolveMediaExecutable } from '../src/agentos-media-executable.ts'

it('exports edited footage with captions and serves seekable playback while preserving inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-video-'))
  const store = new AgentOsStore(root, { encrypt: v => Buffer.from(v), decrypt: v => v.toString() })
  let observeProgress: (progress: number) => void = () => {}
  const engine = new AgentOsMedia(join(root, 'media'), store, (event) => {
    if (event.type === 'media.progress') observeProgress(event.progress)
  })
  try {
    const input = join(root, 'source.mp4')
    execFileSync(resolveMediaExecutable('ffmpeg', { platform: process.platform, environment: process.env }), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x90:r=30',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      input,
    ])
    const [asset] = await engine.import([input])
    expect(asset!.duration).toBeCloseTo(1)
    const output = await engine.edit({
      clips: [
        { path: asset!.path, start: 0, end: 0.4 },
        { path: asset!.path, start: 0.4, end: 0.8 },
      ],
      format: 'square',
      fit: 'contain',
      captions: [{ start: 0, end: 0.7, text: 'Strugend export' }],
      name: 'Test export',
    })
    expect((await engine.recipe(output.id)).captions?.[0]?.text).toBe('Strugend export')
    expect(output.width).toBe(1080)
    expect(output.height).toBe(1080)
    expect(output.duration).toBeGreaterThan(0.7)
    expect(existsSync(input)).toBe(true)
    const response = await engine.serve(new Request(output.url, { headers: { range: 'bytes=0-99' } }))
    expect(response.status).toBe(206)
    expect((await response.arrayBuffer()).byteLength).toBe(100)
    expect(response.headers.get('content-range')).toMatch(/^bytes 0-99\//)
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'Fixture outside the chat workspace')
    await expect(engine.admit(outside, workspace)).rejects.toThrow('outside')
    await expect(engine.edit({ clips: [{ path: asset!.path, start: 2, end: 3 }], format: 'portrait' })).rejects.toThrow(
      'trim',
    )
    const rendering = new Promise<void>((resolve) => {
      observeProgress = (progress) => {
        if (progress > 0) resolve()
      }
    })
    const cancelled = engine
      .edit({ clips: Array.from({ length: 30 }, () => ({ path: asset!.path })), format: 'square' })
      .catch((error: unknown) => error as Error)
    await rendering
    await engine.dispose()
    expect(await cancelled).toBeInstanceOf(Error)
    expect(engine.list().filter(item => item.kind === 'export')).toHaveLength(1)
    await expect(engine.edit({ clips: [{ path: asset!.path }], format: 'square' })).rejects.toThrow('closing')
  } finally {
    await engine.dispose()
    store.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 90_000)
