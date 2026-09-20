/** Product roles and write-only credentials; technical model routes stay in the Host. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from './operations.ts'
import type { ModelsKey } from './locales.ts'
import { apiKeyFailure } from './apiKey.ts'
import styles from './ModelsSection.module.css'

/** Data fetched for the product's three service connections. */
export interface IntelligenceSnapshot {
  /** The graph origin; an empty value means disconnected. */
  graphUrl: string
  /** Revision used to prevent overwriting another window's edits. */
  revision: number
  /** Only configured/writable metadata, never credential values. */
  credentials: Record<string, CredentialInfo>
  /** The actual Core credential reference resolved by its settings. */
  coreRef: string
}

/** Registration-owned access to Host settings and credential metadata. */
export interface IntelligenceOperations {
  /** @returns Current connection metadata from the Host. */
  load(): Promise<IntelligenceSnapshot>
}

/**
 * Display role-based configuration without exposing implementation IDs as product labels.
 * @param props - Localized copy and Host callbacks.
 * @returns The Intelligence settings form.
 */
export function IntelligenceSettings({ access, operations, t }: {
  access: IntelligenceOperations
  operations: ModelsOperations
  t: (key: ModelsKey) => string
}): ReactNode {
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot>()
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [graphUrl, setGraphUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let disposed = false
    void access.load().then((value) => {
      if (!disposed) { setSnapshot(value); setGraphUrl(value.graphUrl) }
    }, () => { if (!disposed) setError(t('loadFailed')) })
    return () => { disposed = true }
  }, [access, t])
  const save = async (ref: string): Promise<void> => {
    const invalid = apiKeyFailure(keys[ref] ?? '')
    if (invalid !== undefined) { setError(t(invalid)); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const failure = await operations.storeCredential(ref, (keys[ref] ?? '').trim())
      if (failure !== undefined) throw new Error(failure)
      setKeys(previous => ({ ...previous, [ref]: '' }))
      setSnapshot(await access.load())
      setNotice(t('intelligenceSaved'))
    } catch { setError(t('intelligenceSaveFailed')) }
    finally { setBusy(false) }
  }
  const saveGraph = async (): Promise<void> => {
    if (!snapshot) return
    setBusy(true); setError(''); setNotice('')
    try {
      const outcome = await operations.writeSettings('strugend-intelligence', [{ op: 'set', path: ['graphUrl'], value: graphUrl.trim() }], snapshot.revision)
      if (outcome.kind !== 'written') throw new Error(outcome.message)
      const next = await access.load()
      setSnapshot(next); setGraphUrl(next.graphUrl); setNotice(t('intelligenceSaved'))
    } catch { setError(t('intelligenceGraphFailed')) }
    finally { setBusy(false) }
  }
  const roles = snapshot === undefined ? [] : [
    { labelKey: 'intelligenceCore', hint: 'intelligenceCoreHint', ref: snapshot.coreRef },
    { labelKey: 'intelligenceDecision', hint: 'intelligenceDecisionHint', ref: 'TYPESAFE_API_KEY' },
    { labelKey: 'intelligenceMemory', hint: 'intelligenceMemoryHint', ref: 'CHRONOGRAPH_TOKEN' },
  ] as const
  return <section className={styles.section}>
    <h2 className={styles.title}>{t('intelligenceTitle')}</h2>
    <p className={styles.intro}>{t('intelligenceIntro')}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.savedNotice}>{notice}</p>}
    {!snapshot && !error && <p role="status">{t('intelligenceLoading')}</p>}
    {roles.map((role) => {
      const info = snapshot?.credentials[role.ref]
      return <form className={styles.intelligenceRole} key={role.ref} onSubmit={(event) => { event.preventDefault(); void save(role.ref) }}>
        <h3>{t(role.labelKey)}</h3>
        <p className={styles.intro}>{t(role.hint)}</p>
        <p className={styles.intelligenceStatus}>{info?.configured ? t('credentialConfigured') : t('credentialMissing')}</p>
        <label className={styles.intelligenceKey}>
          <span>{t('keyInput')}</span>
          <input className={styles.input} type="password" autoComplete="off" spellCheck={false}
            aria-label={`${t(role.labelKey)} ${t('keyInput')}`} value={keys[role.ref] ?? ''} disabled={busy || info?.writable === false}
            placeholder={info?.configured ? t('keyStored') : t('keyPlaceholder')}
            onChange={(event) => { const value = event.target.value; setKeys(previous => ({ ...previous, [role.ref]: value })) }} />
        </label>
        {info?.writable === false ? <p>{t('keyEnvLocked')}</p> : <button className={styles.intelligenceSave} disabled={busy || !keys[role.ref]?.trim()} type="submit">{t('apply')}</button>}
      </form>
    })}
    {snapshot && <form className={styles.intelligenceRole} onSubmit={(event) => { event.preventDefault(); void saveGraph() }}>
      <label className={styles.intelligenceKey}><span>{t('intelligenceGraphUrl')}</span><input className={styles.input}
        type="url" value={graphUrl} placeholder={t('intelligenceGraphPlaceholder')} disabled={busy} onChange={(event) => { setGraphUrl(event.target.value) }} /></label>
      <p className={styles.intro}>{t('intelligenceGraphHint')}</p>
      <button className={styles.intelligenceSave} type="submit" disabled={busy || graphUrl === snapshot.graphUrl}>{t('apply')}</button>
    </form>}
  </section>
}
