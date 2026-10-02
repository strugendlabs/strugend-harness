// @vitest-environment jsdom
/** The studio edits, imports, exports, opens, and cancels through the desktop command surface. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { AgentOsCommand, MediaAsset } from '@deepseek-ai/dsh-agentos-protocol'
import { VideoStudio } from '../src/client/view/VideoStudio.tsx'
import type { VideoStudioState } from '../src/client/view/VideoStudio.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const CLIP: MediaAsset = {
  id: 'clip', name: 'take.mp4', path: '/media/take.mp4', url: 'dsh-app://app/agent-os-media/clip',
  duration: 3, width: 720, height: 1280, audio: true, media: 'video', kind: 'input', createdAt: 1,
}
const TRACK: MediaAsset = {
  id: 'track', name: 'theme.mp3', path: '/media/theme.mp3', url: 'dsh-app://app/agent-os-media/track',
  duration: 30, width: 0, height: 0, audio: true, media: 'audio', kind: 'input', createdAt: 2,
}

/** A host-observable studio state the test can publish into. */
function stateSource(initial: VideoStudioState) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): VideoStudioState => state,
    subscribe: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    publish: (next: VideoStudioState): void => {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

/** Mount the studio with one command surface and the dictionary's own copy. */
function mountStudio(initial: VideoStudioState, respond: (command: AgentOsCommand) => Promise<unknown> = async () => null) {
  const source = stateSource(initial)
  const videoRequest = vi.fn(respond)
  const openSocial = vi.fn()
  const props = {
    useVideoStudio: <S,>(select: (value: VideoStudioState) => S): S =>
      select(useSyncExternalStore(source.subscribe, source.getSnapshot)),
    videoRequest,
    openSocial,
    t: (key: keyof typeof zh) => zh[key],
  }
  render(<VideoStudio {...(props as unknown as Parameters<typeof VideoStudio>[0])} />)
  return { source, videoRequest, openSocial }
}

it('marks audio in the library and refuses to add it to the picture sequence', () => {
  mountStudio({ assets: [CLIP, TRACK] })
  expect(screen.getByText('♪').textContent).toBe('♪')
  const addButtons = screen.getAllByLabelText('添加到序列')
  expect(addButtons).toHaveLength(2)
  expect((addButtons[0] as HTMLButtonElement).disabled).toBe(false)
  expect((addButtons[1] as HTMLButtonElement).disabled).toBe(true)
  expect((addButtons[1] as HTMLButtonElement).title).toBe('音频')
})

it('imports, opens, and reveals through the desktop commands', async () => {
  const { videoRequest } = mountStudio({ assets: [CLIP] })
  fireEvent.click(screen.getByText('导入视频'))
  await waitFor(() => { expect(videoRequest).toHaveBeenCalledWith({ type: 'media.import' }) })
  fireEvent.click(screen.getByText('用系统应用打开'))
  await waitFor(() => {
    expect(videoRequest).toHaveBeenCalledWith({ type: 'location.open', path: '/media/take.mp4' })
  })
  fireEvent.click(screen.getByText('在文件夹中显示'))
  await waitFor(() => {
    expect(videoRequest).toHaveBeenCalledWith({ type: 'location.open', path: '/media/take.mp4', reveal: true })
  })
})

it('exports the sequence with the chosen music track and captions', async () => {
  const { videoRequest } = mountStudio({ assets: [CLIP, TRACK] })
  fireEvent.click(screen.getAllByLabelText('添加到序列')[0] as HTMLButtonElement)
  fireEvent.change(screen.getByLabelText('入点（秒）'), { target: { value: '0.5' } })
  fireEvent.change(screen.getByLabelText('背景音乐'), { target: { value: '/media/theme.mp3' } })
  fireEvent.change(screen.getByLabelText('字幕（每行一条）'), { target: { value: '0 - 2 | Hello' } })
  fireEvent.click(screen.getByText('导出 MP4'))
  await waitFor(() => {
    expect(videoRequest).toHaveBeenCalledWith({
      type: 'media.edit',
      edit: {
        clips: [{ path: '/media/take.mp4', start: 0.5, end: 3 }],
        format: 'portrait',
        fit: 'cover',
        mute: false,
        name: 'social-video',
        captions: [{ start: 0, end: 2, text: 'Hello' }],
        musicPath: '/media/theme.mp3',
      },
    })
  })
})

it('keeps an invalid caption line visible instead of exporting', async () => {
  const { videoRequest } = mountStudio({ assets: [CLIP] })
  fireEvent.click(screen.getAllByLabelText('添加到序列')[0] as HTMLButtonElement)
  fireEvent.change(screen.getByLabelText('字幕（每行一条）'), { target: { value: 'not a cue' } })
  fireEvent.click(screen.getByText('导出 MP4'))
  expect(screen.getByRole('alert').textContent).toContain('0 - 3')
  expect(videoRequest).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'media.edit' }))
})

it('shows render progress and cancels the running job', async () => {
  // The real export resolves only after the encode, so the command stays pending here.
  const { source, videoRequest } = mountStudio({ assets: [CLIP] }, () => new Promise(() => {}))
  fireEvent.click(screen.getAllByLabelText('添加到序列')[0] as HTMLButtonElement)
  fireEvent.click(screen.getByText('导出 MP4'))
  // The encoder's own progress event reaches the running export.
  source.publish({ assets: [CLIP], progress: { jobId: 'job-7', progress: 40, name: 'social-video' } })
  await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('40') })
  await waitFor(() => { expect(screen.getByText('正在渲染视频…').textContent).toBe('正在渲染视频…') })
  fireEvent.click(screen.getByText('取消'))
  await waitFor(() => { expect(videoRequest).toHaveBeenCalledWith({ type: 'media.cancel', jobId: 'job-7' }) })
})

it('opens the social destinations in the owned browser', async () => {
  const published: MediaAsset = { ...CLIP, id: 'export', name: 'social-video.mp4', kind: 'export' }
  const { openSocial } = mountStudio({ assets: [published] })
  fireEvent.click(screen.getByText('LinkedIn'))
  expect(openSocial).toHaveBeenCalledWith('https://www.linkedin.com/feed/')
  fireEvent.click(screen.getByText('Instagram'))
  expect(openSocial).toHaveBeenCalledWith('https://www.instagram.com/')
})

it('reports a failed command without losing the edit', async () => {
  const { videoRequest } = mountStudio({ assets: [CLIP] }, () => Promise.reject(new Error('ffmpeg is missing')))
  fireEvent.click(screen.getByText('导入视频'))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('ffmpeg is missing') })
  expect(videoRequest).toHaveBeenCalledOnce()
})
