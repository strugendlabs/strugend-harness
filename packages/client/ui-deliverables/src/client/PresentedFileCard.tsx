/** File identity and explicit default-application or file-manager actions for one delivery. */
import { useRef } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  FileTypeIcon, fileExtension, IconRightUpOutline16, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresentedAction, PresentedHost } from '../presented.ts'
import type { PresentedOpenPhase } from './present-open.ts'
import { basename, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render independent file actions without nesting buttons inside a clickable card.
 *
 * The two Host actions are single-click buttons rather than menu entries: the
 * default application opens the file itself and the file-manager action
 * locates it, which is the gesture a delivery card exists to offer. Both share
 * one gesture state per file, so a pending request disables both, and a failure
 * stays visible in the card's status line and is retried by the same button.
 * @param props - durable file metadata, Sidebar preview, Host capabilities, gesture status, and localized copy.
 * @returns the file card and its native action buttons.
 */
export function PresentedFileCard({ file, cwd, phase, host, onPreview, onAction, t }: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  onAction: (action: PresentedAction) => void
} & PropsLocale<typeof NS>) {
  const previewRef = useRef<HTMLButtonElement>(null)
  const pending = phase === 'opening' || phase === 'revealing'
  const nativeDisabled = pending || host === null || !host.available
  const reveal = host?.fileManager ?? 'directory'
  const revealLabel = t(`presented.${reveal}`)
  const act = (action: PresentedAction) => {
    // A native request disables its own button while it is pending, so focus moves to the action that stays available.
    previewRef.current?.focus()
    onAction(action)
  }
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const status = phase === undefined
    ? cardDescription(file.description, metadata)
    : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
      : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
        : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  return <div className={css.file} data-presented-file>
    <button type="button" className={css.cardPreview} title={resolveWorkspacePath(cwd, file.path)}
      aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview} />
    <span className={css.fileIcon}><FileTypeIcon path={file.path} size={20} /></span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{name}</span>
        <span className={css.description} role={phase === undefined ? undefined : 'status'}
          data-error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? true : undefined}>
          <span className={css.secondaryText}>{status}</span>
          <span className={css.previewHint}>{t('presented.preview')}</span>
        </span>
      </div>
      <div className={css.split}>
        <button ref={previewRef} type="button" className={css.open}
          aria-label={t('presented.previewButton', { name: file.path })}
          onClick={onPreview}>{t('presented.action')}</button>
        <button type="button" className={css.native} disabled={nativeDisabled} data-presented-action="open"
          title={t('presented.defaultApp')} aria-label={t('presented.openAria', { name: file.path })}
          onClick={() => { act('open') }}>
          <IconRightUpOutline16 size={14} />
        </button>
        <button type="button" className={css.native} disabled={nativeDisabled} data-presented-action="reveal"
          title={revealLabel} aria-label={t('presented.revealAria', { name: file.path })}
          onClick={() => { act('reveal') }}>
          <IconFolderOpenOutline16 size={14} />
        </button>
      </div>
    </div>
  </div>
}
