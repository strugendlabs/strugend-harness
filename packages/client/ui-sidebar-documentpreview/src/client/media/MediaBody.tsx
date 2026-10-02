/** Complete audio or video bytes played inline, so a created recording opens in the pane. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { hostFileOf } from '../rpc.ts'
import type {} from './locales.ts'
import css from './MediaBody.module.css'

/**
 * Containers the browser engine itself can decode. A suffix outside this table
 * keeps the documented unsupported state instead of showing a player that
 * cannot play, which would only move the failure one click later.
 */
const VIDEO_MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
}

const AUDIO_MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
}

/** Which element presents a media suffix. */
export type MediaKind = 'video' | 'audio'

/** A suffix resolved to the element and Blob media type that present it. */
export interface ResolvedMediaType {
  readonly kind: MediaKind
  readonly mediaType: string
}

/** Standard document props plus the media renderer's dictionary. */
export type MediaBodyProps = DocumentPreviewProps & PropsLocale<'sidebarMedia'>

type MediaSource =
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer>; readonly url: string }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer> }

/**
 * Resolve a supported filename to its element kind and Blob media type.
 * @param path - decoded workspace file path.
 * @returns the resolved media type, or undefined for an unclaimed suffix.
 */
export function mediaTypeOf(path: string): ResolvedMediaType | undefined {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  const extension = name.slice(name.lastIndexOf('.') + 1)
  const video = VIDEO_MEDIA_TYPES[extension]
  if (video !== undefined) return { kind: 'video', mediaType: video }
  const audio = AUDIO_MEDIA_TYPES[extension]
  return audio === undefined ? undefined : { kind: 'audio', mediaType: audio }
}

/**
 * Present complete audio or video bytes with the browser's own transport controls.
 *
 * The whole file is read before playback because the resource provider streams
 * frames rather than serving a range-capable URL; seeking then works inside the
 * Blob. A large media file therefore costs its size in pane memory, which is the
 * same trade the builtin image and PDF renderers already make.
 *
 * @param props - document bytes, resource identity, and locale.
 * @returns a video or audio player, or a visible status line while loading or on failure.
 */
export function MediaBody({ content, resourceAddress, t }: MediaBodyProps): ReactNode {
  const path = useMemo(() => hostFileOf(resourceAddress).path, [resourceAddress])
  // Memoized on the path: a fresh result object every render would restart the
  // Blob effect forever, which hangs the pane instead of showing the player.
  const resolved = useMemo(() => mediaTypeOf(path), [path])
  const data = content.kind === 'bytes' ? content.data : undefined
  const [source, setSource] = useState<MediaSource>()

  useEffect(() => {
    if (data === undefined || resolved === undefined) return
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([data], { type: resolved.mediaType }))
      setSource({ kind: 'ready', data, url })
    } catch {
      setSource({ kind: 'failed', data })
    }
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, resolved])

  if (data === undefined || resolved === undefined) {
    return <p className={css.status} role="alert">{t('unsupported')}</p>
  }
  if (source?.data !== data) return <LoadingIndicator className={css.status} label={t('loading')} />
  if (source.kind === 'failed') return <p className={css.status} role="alert">{t('failed')}</p>
  const { name } = pathPartsOf(path)
  return <LoadedMedia key={source.url} url={source.url} kind={resolved.kind} name={name} t={t} />
}

/** The player reports its own decode failure: a claimable suffix can still hold an unplayable codec. */
function LoadedMedia({ url, kind, name, t }: {
  readonly url: string
  readonly kind: MediaKind
  readonly name: string
  readonly t: MediaBodyProps['t']
}): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className={css.status} role="alert">{t('failed')}</p>
  const label = t('preview', { name })
  if (kind === 'audio') {
    return <div className={css.frame} data-media-preview="audio">
      <audio
        className={css.audio}
        src={url}
        controls
        preload="metadata"
        aria-label={label}
        onError={() => { setFailed(true) }}
      />
    </div>
  }
  return <div className={css.frame} data-media-preview="video">
    <video
      className={css.video}
      src={url}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onError={() => { setFailed(true) }}
    />
  </div>
}
