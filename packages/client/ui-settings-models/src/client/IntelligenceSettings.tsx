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
  /** Selected local/hosted inference strategy. */
  decisionMode: 'local' | 'auto' | 'remote'
  /** Background judgments are recorded in Observe mode; Assist may offer ready advice to Core. */
  adviceMode: 'observe' | 'assist'
  /** Device admission is read from the Host without loading the model. */
  enabled: boolean
  installed: boolean
  available: boolean
  localAllowed: boolean
  localReason: string
  /** Revision used to prevent overwriting another window's edits. */
  revision: number
  /** Only configured/writable metadata, never credential values. */
  credentials: Record<string, CredentialInfo>
}

/** Registration-owned access to Host settings and credential metadata. */
export interface IntelligenceOperations {
  /** @returns Current connection metadata from the Host. */
  load(): Promise<IntelligenceSnapshot>
  /** @returns Validated connection result without secret values. */
  testConnection(provider: 'decision' | 'github' | 'vercel'): Promise<{ available: boolean; reason?: string }>
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
  const [tested, setTested] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let disposed = false
    void access.load().then((value) => {
      if (!disposed) { setSnapshot(value) }
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
      setTested(previous => ({ ...previous, [ref]: false }))
      setKeys(previous => ({ ...previous, [ref]: '' }))
      setSnapshot(await access.load())
      setNotice(t('intelligenceSaved'))
    } catch { setError(t('intelligenceSaveFailed')) }
    finally { setBusy(false) }
  }
  const test = async (ref: string, provider: 'decision' | 'github' | 'vercel'): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await access.testConnection(provider)
      setTested(previous => ({ ...previous, [ref]: result.available }))
      if (!result.available) { setError(result.reason ?? t('intelligenceTestFailed')); return }
      setNotice(t('intelligenceTestPassed'))
    } catch { setError(t('intelligenceTestFailed')) }
    finally { setBusy(false) }
  }
  const setMode = async (value: string, field: 'decisionMode' | 'adviceMode' = 'decisionMode'): Promise<void> => {
    if (!snapshot || !(field === 'decisionMode' ? ['local', 'auto', 'remote'] : ['observe', 'assist']).includes(value)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await operations.writeSettings('strugend-intelligence', [{ op: 'set', path: [field], value }], snapshot.revision)
      if (result.kind !== 'written') throw new Error('Settings changed.')
      setSnapshot(await access.load()); setTested({})
    } catch { setError(t('intelligenceModeFailed')) }
    finally { setBusy(false) }
  }
  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (!snapshot) return
    setBusy(true); setError('')
    try {
      const result = await operations.writeSettings('strugend-intelligence', [{ op: 'set', path: ['enabled'], value: enabled }], snapshot.revision)
      if (result.kind !== 'written') throw new Error('Settings changed.')
      setSnapshot(await access.load())
    } catch { setError(t('intelligenceModeFailed')) }
    finally { setBusy(false) }
  }
  const roles = snapshot === undefined ? [] : [
    { labelKey: 'intelligenceDecision', hint: 'intelligenceDecisionHint', ref: 'IMPOSSIBL_API_KEY', provider: 'decision' },
    { labelKey: 'intelligenceGitHub', hint: 'intelligenceGitHubHint', ref: 'STRUGEND_GITHUB_TOKEN', provider: 'github' },
    { labelKey: 'intelligenceVercel', hint: 'intelligenceVercelHint', ref: 'STRUGEND_VERCEL_TOKEN', provider: 'vercel' },
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
        {role.provider === 'decision' && <label className={styles.intelligenceKey}>
          <input type="checkbox" checked={snapshot?.enabled ?? false} disabled={busy}
            onChange={(event) => { void setEnabled(event.target.checked) }} />
          <span>{t('intelligenceEnabled')}</span>
        </label>}
        {role.provider === 'decision' && <label className={styles.intelligenceKey}>
          <span>{t('intelligenceRuntime')}</span>
          <select className={styles.input} aria-label={t('intelligenceRuntime')} value={snapshot?.decisionMode} disabled={busy}
            onChange={(event) => { void setMode(event.target.value) }}>
            <option value="local" disabled={snapshot?.localAllowed === false}>{t('intelligenceLocal')}</option>
            <option value="auto">{t('intelligenceAuto')}</option>
            <option value="remote">{t('intelligenceRemote')}</option>
          </select>
        </label>}
        {role.provider === 'decision' && <>
          <label className={styles.intelligenceKey}>
            <span>{t('intelligenceAdvice')}</span>
            <select className={styles.input} aria-label={t('intelligenceAdvice')} value={snapshot?.adviceMode} disabled={busy}
              onChange={(event) => { void setMode(event.target.value, 'adviceMode') }}>
              <option value="observe">{t('intelligenceObserve')}</option>
              <option value="assist">{t('intelligenceAssist')}</option>
            </select>
          </label>
          {snapshot?.localAllowed === false && <p role="status">{snapshot.localReason || t('intelligenceLowMemory')}</p>}
          <p className={styles.intro}>{t('intelligenceResourceHint')}</p>
        </>}
        <p className={styles.intelligenceStatus}>{tested[role.ref] ? t('intelligenceTestPassed') : role.provider === 'decision' && !snapshot?.enabled ? t('intelligenceDisabled')
          : role.provider === 'decision' && snapshot?.decisionMode === 'local'
            ? t(snapshot.installed ? 'intelligenceLocalReady' : 'intelligenceLocalMissing') : info?.configured ? t('credentialConfigured') : t('credentialMissing')}</p>
        <label className={styles.intelligenceKey}>
          <span>{t('keyInput')}</span>
          <input className={styles.input} type="password" autoComplete="off" spellCheck={false}
            aria-label={`${t(role.labelKey)} ${t('keyInput')}`} value={keys[role.ref] ?? ''} disabled={busy || info?.writable === false}
            placeholder={info?.configured ? t('keyStored') : t('keyPlaceholder')}
            onChange={(event) => { const value = event.target.value; setKeys(previous => ({ ...previous, [role.ref]: value })) }} />
        </label>
        {info?.writable === false ? <p>{t('keyEnvLocked')}</p> : <button className={styles.intelligenceSave} disabled={busy || !keys[role.ref]?.trim()} type="submit">{t('apply')}</button>}
        {<button className={styles.intelligenceSave} type="button" disabled={busy} onClick={() => { void test(role.ref, role.provider) }}>{t('intelligenceTest')}</button>}
      </form>
    })}
    <section className={styles.intelligenceRole} aria-disabled="true">
      <h3>{t('intelligenceMemory')}</h3>
      <p>{t('intelligenceComingSoon')}</p>
      <p className={styles.intro}>{t('intelligenceMemoryHint')}</p>
    </section>
  </section>
}
