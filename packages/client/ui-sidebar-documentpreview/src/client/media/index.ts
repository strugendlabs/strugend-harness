/** Builtin audio and video metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { MediaBody } from './MediaBody.tsx'
import { en, zh } from './locales.ts'

/** Media implementation identity, shared by metadata and the keyed slot. */
export const MEDIA_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/media'

/** Video suffixes presented by the builtin media body. */
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'ogv'] as const

/** Audio suffixes presented by the builtin media body. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac'] as const

/** Every suffix the builtin media body claims. */
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const

/** Media bytes are never readable text, so every claimed suffix is binary. */
export const BINARY_MEDIA_EXTENSIONS = MEDIA_EXTENSIONS

/**
 * Describe the builtin media renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for complete media files.
 */
export function mediaBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: MEDIA_BODY_ID,
    extensions: MEDIA_EXTENSIONS,
    binaryExtensions: BINARY_MEDIA_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'bytes-complete',
    wrap: false,
  }
}

/**
 * Register the media dictionary, metadata, and body with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarMedia')
  ctx.effect(() => ctx.locale.register('sidebarMedia', { zh, en }), 'document-media: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(mediaBodyDefinition(() => t('title'))), 'document-media: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: MEDIA_BODY_ID, locale: 'sidebarMedia' }, MediaBody,
  )), 'document-media: body')
}
