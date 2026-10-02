// @vitest-environment jsdom
/** Media Blob ownership, element choice, transport controls, and failure states. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MediaBody, mediaTypeOf, type MediaBodyProps } from '../src/client/media/MediaBody.tsx'
import { en } from '../src/client/media/locales.ts'
import { AUDIO_EXTENSIONS, MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '../src/client/media/index.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))
let createDescriptor: PropertyDescriptor | undefined
let revokeDescriptor: PropertyDescriptor | undefined
const create = vi.fn<(blob: Blob) => string>()
const revoke = vi.fn<(url: string) => void>()

beforeEach(() => {
  createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  create.mockReset().mockImplementation(() => 'blob:https://preview.invalid/' + String(create.mock.calls.length))
  revoke.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
})

afterEach(() => {
  try { cleanup() } finally {
    if (createDescriptor === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
    else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
    if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
    else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
  }
})

function props(path = 'clip.mp4', data: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3])): MediaBodyProps {
  return {
    resourceAddress: 'dsh-resource://file/session/media/' + path,
    content: { kind: 'bytes', data },
    wrap: false,
    sessionId: 'media' as SessionId,
    useTabInfo: () => ({ tab: { signal: new AbortController().signal } }),
    useResource: () => ({ value: undefined }),
    t: (key, params) => {
      const value = translations.get(key) ?? key
      return params === undefined ? value : value.replace('{name}', String(params.name))
    },
  } as MediaBodyProps
}

describe('MediaBody', () => {
  it('renders a created video with the browser transport controls', async () => {
    const view = render(<MediaBody {...props('screen-recording.mp4')} />)
    const video = await view.findByLabelText('Media preview: screen-recording.mp4')
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe('blob:https://preview.invalid/1')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(create.mock.calls[0]?.[0].type).toBe('video/mp4')
    view.unmount()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:https://preview.invalid/1')
  })

  it.each(VIDEO_EXTENSIONS)('presents .%s as a video', async (extension) => {
    const view = render(<MediaBody {...props('asset.' + extension)} />)
    const element = await view.findByLabelText('Media preview: asset.' + extension)
    expect(element.tagName).toBe('VIDEO')
    expect(create.mock.calls[0]?.[0].type).toMatch(/^video\//u)
  })

  it.each(AUDIO_EXTENSIONS)('presents .%s as audio', async (extension) => {
    const view = render(<MediaBody {...props('asset.' + extension)} />)
    const element = await view.findByLabelText('Media preview: asset.' + extension)
    expect(element.tagName).toBe('AUDIO')
    expect(element.hasAttribute('controls')).toBe(true)
    expect(create.mock.calls[0]?.[0].type).toMatch(/^audio\//u)
  })

  it('reports a decode failure the player itself detects', async () => {
    const view = render(<MediaBody {...props('asset.mp4')} />)
    fireEvent.error(await view.findByLabelText('Media preview: asset.mp4'))
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
  })

  it('revokes replaced bytes and reports a Blob creation failure', async () => {
    const view = render(<MediaBody {...props()} />)
    await view.findByLabelText('Media preview: clip.mp4')
    view.rerender(<MediaBody {...props('clip.mp4', new Uint8Array([4, 5, 6]))} />)
    await view.findByLabelText('Media preview: clip.mp4')
    expect(revoke).toHaveBeenCalledWith('blob:https://preview.invalid/1')
    create.mockImplementationOnce(() => { throw new Error('Blob unavailable') })
    view.rerender(<MediaBody {...props('changed.mp4', new Uint8Array([7]))} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
  })

  it('rejects text delivery and a suffix outside the readable set without creating a Blob', () => {
    const view = render(<MediaBody {...props()} content={{ kind: 'text', text: 'plain', pages: [], eof: true }} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    view.rerender(<MediaBody {...props('archive.mkv')} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    view.rerender(<MediaBody {...props('notes.txt')} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    expect(create).not.toHaveBeenCalled()
  })

  it('resolves media types case-insensitively and claims every registered suffix', () => {
    expect(mediaTypeOf('folder/RECORDING.MP4')).toEqual({ kind: 'video', mediaType: 'video/mp4' })
    expect(mediaTypeOf('folder/take.mov')).toEqual({ kind: 'video', mediaType: 'video/quicktime' })
    expect(mediaTypeOf('folder/song.mp3')).toEqual({ kind: 'audio', mediaType: 'audio/mpeg' })
    expect(mediaTypeOf('folder/no-extension')).toBeUndefined()
    for (const extension of MEDIA_EXTENSIONS) expect(mediaTypeOf('folder/file.' + extension)).toBeDefined()
  })
})
