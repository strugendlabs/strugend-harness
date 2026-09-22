/** Optional capability setup and settings, separate from the selected model connection. */
import { useEffect } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComponentController, ComponentStatus } from './component-controller.ts'
import css from './OptionalTools.module.css'

/** Slot-injected installer operations and observable status. */
export interface OptionalToolsInjected {
  hooks: { components: ComponentController['store'] }
  load(): Promise<void>
  change: ComponentController['change']
  setup: ComponentController['setup']
}

type Shared = InjectFace<OptionalToolsInjected> & PropsLocale<'workspace'>
type PageProps = PropsRuntime<'settings.section'> & Shared
type SetupProps = PropsRuntime<'settings.onboarding'> & Shared

function size(bytes: number): string { return `${Math.ceil(bytes / 1024 / 1024)}` }

function ComponentRow({ row, busy, change, t }: {
  row: ComponentStatus
  busy: boolean
  change: OptionalToolsInjected['change']
  t: Shared['t']
}) {
  const downloading = row.state === 'downloading' || row.state === 'verifying'
  return <section className={css.component}>
    <div className={css.componentHeading}>
      <h3>{t(`components.${row.id}`)}</h3>
      <span className={css.state}>{t(`components.state.${row.state}`)}</span>
    </div>
    <p>{t(`components.${row.id}Description`)}</p>
    {row.downloadBytes > 0 && <small>{t('components.size', { download: size(row.downloadBytes), installed: size(row.installedBytes) })}</small>}
    {downloading && <div className={css.progress}>
      <progress max={Math.max(1, row.downloadBytes)} value={Math.min(row.progressBytes, row.downloadBytes)} aria-label={t(`components.${row.id}`)} />
      <small>{t('components.progress', { downloaded: size(row.progressBytes), total: size(row.downloadBytes) })}</small>
    </div>}
    {row.error && <p role="alert" className={css.error}>{row.error}</p>}
    <div className={css.rowActions}>
      {downloading ? <button disabled={busy} onClick={() => { void change(row.id, 'cancel') }}>{t('components.cancel')}</button>
        : row.state === 'installed' ? <button disabled={busy} onClick={() => { void change(row.id, 'remove') }}>{t('components.remove')}</button>
          : <button className={css.primary} disabled={busy || !row.available} onClick={() => { void change(row.id, 'install') }}>{t(row.state === 'failed' ? 'components.retry' : 'components.install')}</button>}
    </div>
  </section>
}

/**
 * Render download, retry, cancel, and remove controls only for optional packs.
 * @param props - Installer state and localized settings slot.
 * @returns The optional tools settings section.
 */
export function OptionalTools({ useComponents, load, change, t }: PageProps) {
  const state = useComponents(value => value)
  useEffect(() => { void load() }, [load])
  return <div className={css.page}>
    <h2>{t('components.title')}</h2>
    <p className={css.intro}>{t('components.intro')}</p>
    {state.error && <p className={css.error} role="alert">{t('components.failed')} <button onClick={() => { void load() }}>{t('components.retry')}</button></p>}
    {state.value === null ? <p role="status">{t('components.loading')}</p> : <>
      {!state.value.localAllowed && <p className={css.note}>{t('components.lowMemory')}</p>}
      {state.value.components.map(row => <ComponentRow key={row.id} row={row} busy={state.busy} change={change} t={t} />)}
    </>}
  </div>
}

/**
 * Offer an optional model after provider setup; skipping never blocks Core.
 * @param props - Ordered onboarding operations and installer state.
 * @returns The optional setup dialog, or nothing once acknowledged.
 */
export function OptionalToolsSetup({ complete, useComponents, load, setup, t }: SetupProps) {
  const state = useComponents(value => value)
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (state.value?.setupComplete) complete() }, [state.value?.setupComplete, complete])
  const decision = state.value?.components.find(row => row.id === 'decision')
  if (state.value?.setupComplete || state.status === 'idle' || state.status === 'loading') return null
  const choose = (choice: 'install' | 'skip'): void => {
    if (choice === 'skip' && state.value === null && state.status === 'error') { complete(); return }
    void setup(choice)
  }
  return <Modal open headless title={t('components.setupTitle')} onClose={() => { choose('skip') }} className={css.setup as string}>
    <div className={css.setupBody}>
      <div className={css.setupMark} aria-hidden="true">{t('agentos.initial')}</div>
      <span className={css.setupStep}>{t('components.setupStep')}</span>
      <h1>{t('components.setupTitle')}</h1>
      <p>{t('components.setupIntro')}</p>
      <div className={css.benefit}>
        <div className={css.benefitHeading}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2v3m4-3v3m4-3v3M8 19v3m4-3v3m4-3v3M2 8h3m-3 4h3m-3 4h3m14-8h3m-3 4h3m-3 4h3" stroke="currentColor" strokeWidth="1.5" /></svg>
          <div><strong>{t('components.decision')}</strong><p>{t('components.localRequirement')}</p></div>
        </div>
        {decision && decision.downloadBytes > 0 && <small>{t('components.size', { download: size(decision.downloadBytes), installed: size(decision.installedBytes) })}</small>}
      </div>
      <div className={css.benefitHeading}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Z M14 3v5h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <div><strong>{t('components.documents')}</strong><p>{t('components.documentsLater')}</p></div>
      </div>
      {state.value && !state.value.localAllowed && <p className={css.note}>{t('components.lowMemory')}</p>}
      {state.error && <p role="alert" className={css.error}>{t('components.failed')}</p>}
      <div className={css.setupActions}>
        <button type="button" className={css.primary} disabled={state.busy || !decision?.available} onClick={() => { choose('install') }}>{t('components.installDecision')}</button>
        <button type="button" disabled={state.busy} onClick={() => { choose('skip') }}>{t('components.skip')}</button>
      </div>
      <p className={css.note}>{t('components.laterHint')}</p>
    </div>
  </Modal>
}
