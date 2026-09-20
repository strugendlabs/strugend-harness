/** Local video import, FFmpeg editing, durable export inventory, and ranged playback. */
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, realpath, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import type { AgentOsStore } from './agentos-store.ts'
import type { AgentOsEvent, MediaAsset, VideoEdit } from '@deepseek-ai/dsh-agentos-protocol'
import { resolveMediaExecutable } from './agentos-media-executable.ts'

function executable(name: 'ffmpeg' | 'ffprobe'): string {
  return resolveMediaExecutable(name, { platform: process.platform, environment: process.env,
    ...('resourcesPath' in process ? { resources: process.resourcesPath } : {}) })
}

function command(
  binary: string,
  args: string[],
  signal?: AbortSignal,
  progress?: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal === undefined ? {} : { signal }),
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      output = (output + text).slice(-100_000)
      progress?.(text)
    })
    child.stderr.on('data', (data: Buffer) => {
      errors = (errors + data.toString()).slice(-6000)
    })
    let spawnError: Error | undefined
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code) => {
      if (code === 0 && spawnError === undefined) resolve(output)
      else
        reject(
          new Error(
            signal?.aborted
              ? 'Video export cancelled.'
              : `Video processing failed: ${spawnError?.message ?? errors.slice(-1500)}`,
          ),
        )
    })
  })
}

/** Media paths admitted through import, prior exports, or the calling chat's workspace. */
export class AgentOsMedia {
  private readonly active = new Map<string, AbortController>()
  private readonly pending = new Set<Promise<unknown>>()
  private disposed = false
  /** @param root - Owned media directory. @param store - Durable metadata. @param emit - Progress events. */
  constructor(
    private readonly root: string,
    private readonly store: AgentOsStore,
    private readonly emit: (event: AgentOsEvent) => void,
  ) {}
  /** @returns Saved inputs and exports, without reading media bytes. */
  list(): MediaAsset[] {
    return this.store.media()
  }
  /** @param assetId - An existing export. @returns Its saved, editable recipe. */
  async recipe(assetId: string): Promise<VideoEdit> {
    const asset = this.list().find(item => item.id === assetId && item.kind === 'export')
    if (asset === undefined) throw new Error('Choose an exported video to reopen its edit.')
    return JSON.parse(await readFile(join(this.root, 'exports', `${asset.id}.edit.json`), 'utf8')) as VideoEdit
  }
  private save(asset: MediaAsset): MediaAsset {
    this.store.saveMedia(asset)
    this.emit({ type: 'media', assets: this.list() })
    return asset
  }
  /** @param path - Proposed media or upload path. @param workspace - Calling chat root. @returns Canonical admitted path. */
  async admit(path: string, workspace?: string): Promise<string> {
    const target = await realpath(path)
    const known = this.list().some(asset => asset.path === target)
    if (!known) {
      if (workspace === undefined) throw new Error('Import this file in Video studio first.')
      const root = await realpath(workspace)
      const part = relative(root, target)
      if (part.startsWith('..') || isAbsolute(part))
        throw new Error('The file is outside this chat’s workspace. Import it first.')
      if (part.split(/[\\/]/u).some(segment => segment.startsWith('.')))
        throw new Error('Hidden files cannot be uploaded through the media workflow.')
    }
    const info = await stat(target)
    if (!info.isFile() || info.size > 4 * 1024 ** 3) throw new Error('Choose a media file smaller than 4 GB.')
    return target
  }
  private async inspect(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ duration: number; width: number; height: number; audio: boolean }> {
    const data = JSON.parse(
      await command(
        executable('ffprobe'),
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
        signal,
      ),
    ) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> }
    const video = data.streams?.find(stream => stream.codec_type === 'video')
    const duration = Number(data.format?.duration)
    if (video === undefined || !Number.isFinite(duration) || duration <= 0)
      throw new Error('This file does not contain a supported video.')
    return {
      duration,
      width: video.width ?? 0,
      height: video.height ?? 0,
      audio: data.streams?.some(stream => stream.codec_type === 'audio') ?? false,
    }
  }
  /** @param paths - Files selected by the user in the native file picker. @returns Imported inventory. */
  import(paths: string[]): Promise<MediaAsset[]> {
    return this.track(() => this.importFiles(paths))
  }
  private track<T>(work: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Agent OS is closing.'))
    const promise = work()
    this.pending.add(promise)
    void promise
      .finally(() => {
        this.pending.delete(promise)
      })
      .catch(() => {
        /* The caller receives the original error. */
      })
    return promise
  }
  private async importFiles(paths: string[]): Promise<MediaAsset[]> {
    await mkdir(join(this.root, 'imports'), { recursive: true, mode: 0o700 })
    for (const path of paths) {
      const source = await realpath(path)
      const details = await this.inspect(source)
      const info = await stat(source)
      if (info.size > 4 * 1024 ** 3) throw new Error('Choose a video smaller than 4 GB.')
      const id = randomUUID()
      const target = join(this.root, 'imports', `${id}${extname(source).toLowerCase()}`)
      await copyFile(source, target)
      this.save({
        id,
        name: basename(source),
        path: await realpath(target),
        url: `dsh-app://app/agent-os-media/${id}`,
        ...details,
        createdAt: Date.now(),
        kind: 'input',
      })
    }
    return this.list()
  }
  /** @param jobId - Export selected for cancellation. */
  cancel(jobId: string): void {
    this.active.get(jobId)?.abort()
  }
  /** Cancel all owned encoders on app shutdown. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const controller of this.active.values()) controller.abort()
    await Promise.allSettled(this.pending)
  }
  /**
   * @param edit - Timeline/export settings.
   * @param workspace - Actual chat root.
   * @param signal - Tool lifetime.
   * @returns Playable exported video.
   */
  edit(edit: VideoEdit, workspace?: string, signal?: AbortSignal): Promise<MediaAsset> {
    return this.track(() => this.exportVideo(edit, workspace, signal))
  }
  private async exportVideo(edit: VideoEdit, workspace?: string, signal?: AbortSignal): Promise<MediaAsset> {
    if (!Array.isArray(edit.clips) || edit.clips.length < 1 || edit.clips.length > 30)
      throw new Error('Choose between 1 and 30 clips.')
    const formats = { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] } as const
    const dimensions = formats[edit.format]
    if (!Object.hasOwn(formats, edit.format)) throw new Error('Choose portrait, square, or landscape output.')
    const [width, height] = dimensions
    const id = randomUUID()
    const controller = new AbortController()
    const abort = (): void => {
      controller.abort(signal?.reason)
    }
    signal?.throwIfAborted()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temp = await mkdtemp(join(this.root, '.export-'))
    const outputDir = join(this.root, 'exports')
    await mkdir(outputDir, { recursive: true, mode: 0o700 })
    const name = (edit.name || 'social-video').replace(/[^a-zA-Z0-9 _-]/gu, '').slice(0, 100) || 'social-video'
    const target = join(outputDir, `${name}-${id.slice(0, 8)}.mp4`)
    const report = (progress: number): void => {
      this.emit({ type: 'media.progress', jobId: id, progress, name })
    }
    try {
      signal?.throwIfAborted()
      if (this.disposed) throw new Error('Agent OS is closing.')
      signal?.addEventListener('abort', abort, { once: true })
      this.active.set(id, controller)
      report(0)
      let totalDuration = 0
      for (const [index, clip] of edit.clips.entries()) {
        const path = await this.admit(clip.path, workspace)
        const info = await this.inspect(path, controller.signal)
        const start = clip.start ?? 0
        const end = clip.end ?? info.duration
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end <= start ||
          end > info.duration + 0.1 ||
          end - start > 3600
        )
          throw new Error('Each trim must fall within the clip and be shorter than one hour.')
        totalDuration += end - start
        const filter =
          edit.fit === 'contain'
            ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`
            : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`
        await command(
          executable('ffmpeg'),
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-ss',
            String(start),
            '-i',
            path,
            '-f',
            'lavfi',
            '-i',
            'anullsrc=r=48000:cl=stereo',
            '-t',
            String(end - start),
            '-map',
            '0:v:0',
            '-map',
            info.audio && !edit.mute ? '0:a:0' : '1:a:0',
            '-vf',
            filter,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '22',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            join(temp, `clip-${index}.mp4`),
          ],
          controller.signal,
        )
        report(Math.round(((index + 1) / edit.clips.length) * 75))
      }
      const manifest = join(temp, 'clips.txt')
      await writeFile(manifest, edit.clips.map((_, index) => `file 'clip-${index}.mp4'`).join('\n'))
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', manifest]
      let nextInput = 1
      if (edit.musicPath) {
        args.push('-stream_loop', '-1', '-i', await this.admit(edit.musicPath, workspace))
        nextInput++
      }
      const overlays: string[] = []
      const cues = edit.captions ?? []
      if (cues.length > 100) throw new Error('Use no more than 100 caption cues per export.')
      const xml = (value: string): string =>
        value.replace(
          /[&<>"']/gu,
          char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
        )
      for (const [index, cue] of cues.entries()) {
        if (
          !Number.isFinite(cue.start) ||
          !Number.isFinite(cue.end) ||
          cue.start < 0 ||
          cue.end <= cue.start ||
          cue.end > totalDuration ||
          typeof cue.text !== 'string' ||
          cue.text.length > 400
        )
          throw new Error('Caption timing or text is invalid; use at most 400 characters per cue.')
        const lines = cue.text.match(/.{1,38}(?:\s|$)|.{1,38}/gu) ?? [cue.text]
        const font = Math.round(width / 25)
        const captionHeight = (lines.length + 2) * Math.round(font * 1.4)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${captionHeight}"><rect x="${width * 0.08}" y="0" width="${width * 0.84}" height="${captionHeight}" rx="18" fill="#101010" fill-opacity=".72"/>${lines.map((line, i) => `<text x="50%" y="${font * 1.6 + i * font * 1.4}" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="600" font-size="${font}">${xml(line.trim())}</text>`).join('')}</svg>`
        const png = join(temp, `caption-${index}.png`)
        await sharp(Buffer.from(svg)).png().toFile(png)
        args.push('-loop', '1', '-i', png)
        overlays.push(
          `${index === 0 ? '[0:v]' : `[v${index - 1}]`}[${nextInput + index}:v]overlay=0:H-h-70:enable='between(t,${cue.start},${cue.end})'[v${index}]`,
        )
      }
      if (overlays.length)
        args.push(
          '-filter_complex',
          overlays.join(';'),
          '-map',
          `[v${overlays.length - 1}]`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
        )
      else args.push('-map', '0:v:0', '-c:v', 'copy')
      args.push('-map', edit.musicPath ? '1:a:0' : '0:a:0', '-t', String(totalDuration))
      args.push('-c:a', 'aac', '-movflags', '+faststart', target)
      await command(executable('ffmpeg'), args, controller.signal)
      const details = await this.inspect(target, controller.signal)
      await writeFile(join(outputDir, `${id}.edit.json`), JSON.stringify(edit, null, 2), { mode: 0o600 })
      const asset = this.save({
        id,
        name: `${name}.mp4`,
        path: await realpath(target),
        url: `dsh-app://app/agent-os-media/${id}`,
        ...details,
        kind: 'export',
        createdAt: Date.now(),
      })
      report(100)
      return asset
    } catch (error) {
      await rm(target, { force: true })
      await rm(join(outputDir, `${id}.edit.json`), { force: true })
      this.emit({
        type: 'media.progress',
        jobId: id,
        progress: 0,
        name,
        error: error instanceof Error ? error.message : 'Export failed.',
      })
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.active.delete(id)
      await rm(temp, { recursive: true, force: true })
    }
  }
  /** @param request - App-owned video playback request. @returns Byte-range response for native HTML video seeking. */
  async serve(request: Request): Promise<Response> {
    const id = new URL(request.url).pathname.split('/').at(-1)
    const asset = this.list().find(item => item.id === id)
    if (asset === undefined) return new Response(null, { status: 404 })
    const info = await stat(asset.path)
    const header = request.headers.get('range')
    let start = 0
    let end = info.size - 1
    if (header) {
      const match = /^bytes=(\d+)-(\d*)$/u.exec(header)
      if (!match) return new Response(null, { status: 416 })
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : end
      if (start > end || end >= info.size)
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } })
    }
    const headers: Record<string, string> = {
      'content-type':
        extname(asset.path) === '.webm'
          ? 'video/webm'
          : extname(asset.path) === '.mov'
            ? 'video/quicktime'
            : 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      'cache-control': 'private, no-store',
    }
    if (header) headers['content-range'] = `bytes ${start}-${end}/${info.size}`
    return new Response(Readable.toWeb(createReadStream(asset.path, { start, end })) as ReadableStream, {
      status: header ? 206 : 200,
      headers,
    })
  }
}
