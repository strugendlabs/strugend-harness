/** Media metadata, keyed slot, dictionary, and disposal registration. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreviewRegistry } from '../src/client/document/registry.ts'
import { unviewableBinaryPath } from '../src/client/document/unviewable.ts'
import { MediaBody } from '../src/client/media/MediaBody.tsx'
import {
  apply, AUDIO_EXTENSIONS, BINARY_MEDIA_EXTENSIONS, MEDIA_BODY_ID, MEDIA_EXTENSIONS, mediaBodyDefinition, VIDEO_EXTENSIONS,
} from '../src/client/media/index.ts'
import { en, zh } from '../src/client/media/locales.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(async () => { await dispose?.(); dispose = undefined })

describe('media registration', () => {
  it('claims video and audio suffixes as a builtin complete-byte renderer without wrap', () => {
    const title = vi.fn(() => 'localized media')
    const definition = mediaBodyDefinition(title)
    expect(definition).toMatchObject({
      id: MEDIA_BODY_ID,
      extensions: MEDIA_EXTENSIONS,
      binaryExtensions: BINARY_MEDIA_EXTENSIONS,
      priority: 'builtin',
      title,
      loading: 'bytes-complete',
      wrap: false,
    })
    expect(title).not.toHaveBeenCalled()
    expect(definition.title()).toBe('localized media')
    expect([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]).toEqual([...MEDIA_EXTENSIONS])
  })

  it('beats the unsupported binary state for a video the user just created', async () => {
    // TextPreview consults the unviewable list only when no implementation matched
    // (TextPreview.tsx:110), so claiming the suffix is what replaces the empty state.
    expect(unviewableBinaryPath('clip.mp4')).toBe(true)
    const ctx = new Context()
    const registry = new DocumentPreviewRegistry()
    const bodies = new Map<string, unknown>()
    const register = vi.fn((options: { key: string }, body: unknown) => {
      bodies.set(options.key, body)
      return () => { bodies.delete(options.key) }
    })
    ctx.provide('documentPreviews', registry)
    ctx.provide('slots', { inject: (_key: string, callback: () => () => void) => callback(), register } as never)
    ctx.provide('locale', {
      bind: () => (key: keyof typeof en) => en[key],
      register: () => () => undefined,
    } as never)
    const fiber = ctx.plugin({ apply })
    dispose = async () => { await fiber.dispose() }
    await fiber.await()

    expect(registry.candidates('clip.mp4').map(entry => entry.id)).toEqual([MEDIA_BODY_ID])
    expect(registry.candidates('CLIP.MOV').map(entry => entry.id)).toEqual([MEDIA_BODY_ID])
    for (const extension of MEDIA_EXTENSIONS) {
      expect(registry.candidates('ASSET.' + extension.toUpperCase()).map(entry => entry.id)).toEqual([MEDIA_BODY_ID])
    }
    expect(register).toHaveBeenCalledExactlyOnceWith(
      { name: 'sidebar.right.tab.document', key: MEDIA_BODY_ID, locale: 'sidebarMedia' },
      MediaBody,
    )
    await dispose()
    dispose = undefined
    expect(registry.getSnapshot()).toEqual([])
    expect(bodies.size).toBe(0)
  })

  it('keeps a suffix the browser cannot decode on the documented unsupported state', () => {
    // mkv and avi are deliberately unclaimed: a player that cannot play would only
    // move the failure one click later, so the definition must not name them.
    const definition = mediaBodyDefinition(() => 'media')
    expect(definition.extensions).not.toContain('mkv')
    expect(definition.extensions).not.toContain('avi')
    expect(zh.title).toBe('影音')
  })
})
