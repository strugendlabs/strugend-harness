/** Video library, trim sequence, caption editor, and export preview in the sidebar. */
import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentOsCommand, MediaAsset, VideoEdit } from '@deepseek-ai/dsh-agentos-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VideoStudio.module.css'

export interface VideoStudioState {
  assets: MediaAsset[]
  progress?: { jobId: string; progress: number; name: string; error?: string }
}
export interface VideoStudioInjected {
  hooks: { videoStudio: HostObservable<VideoStudioState> }
  videoRequest(command: AgentOsCommand): Promise<unknown>
  openSocial(url: string): void
}
type Props = InjectFace<VideoStudioInjected> & PropsLocale<'sidebarBrowser'>

/** Editing affects only the export; original clips remain in the media library. */
export function VideoStudio({ useVideoStudio, videoRequest, openSocial, t }: Props): ReactNode {
  const state = useVideoStudio(value => value)
  const [selected, setSelected] = useState<string>()
  const [clips, setClips] = useState<VideoEdit['clips']>([])
  const [format, setFormat] = useState<VideoEdit['format']>('portrait')
  const [fit, setFit] = useState<'cover' | 'contain'>('cover')
  const [mute, setMute] = useState(false)
  const [musicPath, setMusicPath] = useState<string>()
  const [captions, setCaptions] = useState('')
  const [name, setName] = useState('social-video')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = state.assets.find(asset => asset.id === selected) ?? state.assets.at(-1)
  const request = async (command: AgentOsCommand): Promise<unknown> => {
    setError('')
    setBusy(true)
    try {
      return await videoRequest(command)
    } catch (reason) {
      setError(String(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }
  const add = (asset: MediaAsset): void => {
    setSelected(asset.id)
    setClips(previous => [...previous, { path: asset.path, start: 0, end: Number(asset.duration.toFixed(2)) }])
  }
  const reopen = (assetId: string): void => {
    void request({ type: 'media.recipe', assetId })
      .then((value) => {
        const edit = value as VideoEdit
        setClips(edit.clips)
        setFormat(edit.format)
        setFit(edit.fit ?? 'cover')
        setMute(edit.mute ?? false)
        setMusicPath(edit.musicPath)
        setName(edit.name ?? 'social-video')
        setCaptions((edit.captions ?? []).map(cue => `${cue.start} - ${cue.end} | ${cue.text}`).join('\n'))
      })
      .catch(() => {
        /* Preserve the current edit if the recipe cannot be loaded. */
      })
  }
  const exportVideo = (): void => {
    let cues: NonNullable<VideoEdit['captions']> = []
    try {
      cues = captions.trim()
        ? captions
          .trim()
          .split('\n')
          .map((line) => {
            const match = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\|\s*(.+)$/u.exec(line)
            if (!match || match[3] === undefined) throw new Error(t('video.captionFormat'))
            return { start: Number(match[1]), end: Number(match[2]), text: match[3] }
          })
        : []
    } catch (reason) {
      setError(String(reason))
      return
    }
    void request({
      type: 'media.edit',
      edit: { clips, format, fit, mute, name, captions: cues, ...(musicPath === undefined ? {} : { musicPath }) },
    })
      .then((value) => {
        setSelected((value as MediaAsset).id)
      })
      .catch(() => {
        /* The visible error retains the user's edit recipe. */
      })
  }
  return (
    <div className={css.root} data-agent-os-video>
      <header>
        <div>
          <span>{t('video.workspace')}</span>
          <h2>{t('video.title')}</h2>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            void request({ type: 'media.import' }).catch(() => {
              /* Error appears above the library. */
            })
          }}
        >
          {t('video.import')}
        </button>
      </header>
      <div className={css.preview}>
        {active ? (
          <video key={active.id} controls preload="metadata" src={active.url} aria-label={active.name} />
        ) : (
          <div>
            <span>▷</span>
            <p>{t('video.empty')}</p>
          </div>
        )}
      </div>
      {active && (
        <div className={css.facts}>
          <span>{active.name}</span>
          <small>
            {active.width}×{active.height} · {active.duration.toFixed(1)}{t('video.seconds')}
          </small>
        </div>
      )}
      {(error || state.progress?.error) && (
        <p className={css.error} role="alert">
          {error || state.progress?.error}
        </p>
      )}
      <section>
        <h3>{t('video.library')}</h3>
        <div className={css.library}>
          {state.assets.map(asset => (
            <div key={asset.id} className={css.asset}>
              <button
                onClick={() => {
                  setSelected(asset.id)
                }}
              >
                <span>{asset.kind === 'export' ? '↗' : '▷'}</span>
                <span>{asset.name}</span>
                <small>{asset.duration.toFixed(1)}{t('video.seconds')}</small>
              </button>
              <button
                aria-label={t('video.add')}
                onClick={() => {
                  add(asset)
                }}
              >
                +
              </button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>
          {t('video.sequence')}
          <small>{clips.length}</small>
        </h3>
        {clips.length === 0 && <p className={css.hint}>{t('video.addHint')}</p>}
        {clips.map((clip, index) => (
          <div key={`${clip.path}-${index}`} className={css.clip}>
            <strong>{index + 1}</strong>
            <span>{state.assets.find(asset => asset.path === clip.path)?.name ?? clip.path.split('/').at(-1)}</span>
            <label>
              {t('video.in')}
              <input
                type="number"
                min="0"
                step="0.1"
                value={clip.start ?? 0}
                onChange={(event) => {
                  setClips(value =>
                    value.map((item, i) => (i === index ? { ...item, start: Number(event.target.value) } : item)),
                  )
                }}
              />
            </label>
            <label>
              {t('video.out')}
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={clip.end ?? ''}
                onChange={(event) => {
                  setClips(value =>
                    value.map((item, i) => (i === index ? { ...item, end: Number(event.target.value) } : item)),
                  )
                }}
              />
            </label>
            <button
              disabled={index === 0}
              aria-label={t('video.moveUp')}
              onClick={() => {
                setClips((value) => {
                  const copy = [...value]
                  const current = copy[index]
                  const previous = copy[index - 1]
                  if (current !== undefined && previous !== undefined) { copy[index - 1] = current; copy[index] = previous }
                  return copy
                })
              }}
            >
              ↑
            </button>
            <button
              aria-label={t('video.remove')}
              onClick={() => {
                setClips(value => value.filter((_, i) => i !== index))
              }}
            >
              ×
            </button>
          </div>
        ))}
      </section>
      <section className={css.settings}>
        <h3>{t('video.export')}</h3>
        <div className={css.grid}>
          <label>
            {t('video.name')}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          </label>
          <label>
            {t('video.format')}
            <select
              aria-label={t('video.format')}
              value={format}
              onChange={(event) => {
                setFormat(event.target.value as VideoEdit['format'])
              }}
            >
              <option value="portrait">{t('video.portrait')}</option>
              <option value="square">{t('video.square')}</option>
              <option value="landscape">{t('video.landscape')}</option>
            </select>
          </label>
          <label>
            {t('video.fit')}
            <select
              aria-label={t('video.fit')}
              value={fit}
              onChange={(event) => {
                setFit(event.target.value as 'cover' | 'contain')
              }}
            >
              <option value="cover">{t('video.cover')}</option>
              <option value="contain">{t('video.contain')}</option>
            </select>
          </label>
          <label className={css.check}>
            <input
              type="checkbox"
              checked={mute}
              onChange={(event) => {
                setMute(event.target.checked)
              }}
            />
            {t('video.mute')}
          </label>
        </div>
        <label>
          {t('video.captions')}
          <textarea
            rows={3}
            placeholder={t('video.captionFormat')}
            value={captions}
            onChange={(event) => {
              setCaptions(event.target.value)
            }}
          />
        </label>
        {busy && state.progress && (
          <div className={css.progress} role="status">
            <progress max={100} value={state.progress.progress} />
            <span>{state.progress.progress}%</span>
            <button
              onClick={() => {
                if (state.progress !== undefined) void videoRequest({ type: 'media.cancel', jobId: state.progress.jobId })
              }}
            >
              {t('video.cancel')}
            </button>
          </div>
        )}
        <button className={css.export} disabled={busy || clips.length === 0} onClick={exportVideo}>
          {busy ? t('video.rendering') : t('video.render')}
        </button>
      </section>
      {active?.kind === 'export' && (
        <section>
          <button
            disabled={busy}
            onClick={() => {
              reopen(active.id)
            }}
          >
            {t('video.reopen')}
          </button>
          <h3>{t('video.publish')}</h3>
          <p className={css.hint}>{t('video.publishHint')}</p>
          <div className={css.social}>
            <button
              onClick={() => {
                openSocial('https://www.linkedin.com/feed/')
              }}
            >
              {t('video.linkedin')}
            </button>
            <button
              onClick={() => {
                openSocial('https://www.instagram.com/')
              }}
            >
              {t('video.instagram')}
            </button>
          </div>
          <code className={css.path}>{active.path}</code>
        </section>
      )}
    </div>
  )
}
