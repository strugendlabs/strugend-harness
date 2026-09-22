/** Provider-neutral desktop setup; credentials and model selection remain separate choices. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WelcomeNoticeStore } from './welcome-store.ts'
import type { DeepSeekOnboardingInjected } from './DeepSeekOnboardingDialog.tsx'
import { providerUsable, protocolChoices } from './store.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './ModelsSection.module.css'

/** Registration-owned model listing and default selection. */
export interface ProviderOnboardingInjected extends DeepSeekOnboardingInjected {
  hooks: DeepSeekOnboardingInjected['hooks'] & { providerSetup: WelcomeNoticeStore['store'] }
  /** Persistent or process-local deferral of automatic provider setup. */
  setupController: WelcomeNoticeStore
  /** @returns Advertised model IDs for the selected provider; no inference is dispatched. */
  models(provider: string): Promise<readonly { id: string; name: string }[]>
  /** Save the user's explicit provider/model choice for subsequent tasks. */
  select(provider: string, model: string): Promise<void>
}

/**
 * Offer any available provider or compatible endpoint without requiring a particular vendor.
 * @param props - Setup state and authenticated settings operations.
 * @returns Optional setup dialog, with a skip action that leaves task drafts intact.
 */
export function ProviderOnboardingDialog(props: PropsRuntime<'settings.onboarding'> & InjectFace<ProviderOnboardingInjected>): ReactNode {
  const { complete, controller, useModels, useProviderSetup, setupController, operations, schema, t } = props
  const setup = useProviderSetup(value => value)
  const finished = useRef(false)
  const finish = (): void => { if (!finished.current) { finished.current = true; complete() } }
  const state = useModels(value => value)
  const [provider, setProvider] = useState('')
  const [editing, setEditing] = useState(true)
  const [candidates, setCandidates] = useState<readonly { id: string; name: string }[]>([])
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  useEffect(() => { void setupController.load() }, [setupController])
  useEffect(() => { if (setup.acknowledged) finish() }, [setup.acknowledged, complete])
  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
  useEffect(() => {
    if (started || state.status !== 'ready') return
    if (state.rows.some(providerUsable)) finish()
    else setStarted(true)
  }, [started, state, complete])
  const row = state.rows.find(value => value.entry.provider === provider)
  const namespace = row ? state.namespaces.get(row.entry.settingsNs) : undefined
  useEffect(() => {
    let disposed = false
    setCandidates([]); setModel('')
    if (!row || !providerUsable(row)) return
    void props.models(provider).then((value) => {
      if (!disposed) { setCandidates(value); setModel(value[0]?.id ?? '') }
    }, () => { if (!disposed) setError(t('loadFailed')) })
    return () => { disposed = true }
  }, [provider, row?.entry.active, row?.credential?.configured, props.models, t])
  if (setup.acknowledged || setup.status === 'idle' || setup.status === 'loading' || !started || state.status === 'idle' || state.status === 'loading') return null
  const saved = (changed: boolean): void => {
    if (!changed) { setEditing(false); return }
    void controller.load().then(() => { setEditing(false) })
  }
  const useModel = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await props.select(provider, model.trim()); finish() }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('loadFailed')) }
    finally { setBusy(false) }
  }
  return <OnboardingModal title={t('providerSetupTitle')}>
    <p className={styles.intro}>{t('providerSetupDescription')}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <label className={styles.field}>
      <span>{t('provider')}</span>
      <select className={styles.input} value={provider} onChange={(event) => { setProvider(event.target.value); setEditing(true); setError('') }}>
        <option value="">{t('providerChoose')}</option>
        {state.rows.filter(value => state.namespaces.has(value.entry.settingsNs)).map(value =>
          <option key={value.entry.provider} value={value.entry.provider}>{value.entry.displayName}</option>)}
        {state.namespaces.has('llm-pi-ai') && <option value="custom">{t('customAdd')}</option>}
      </select>
    </label>
    {row && namespace && editing && <ProviderEditor key={provider} provider={provider} displayName={row.entry.displayName}
      namespace={namespace} settingsPath={row.entry.settingsPath} schema={schema} operations={operations} t={t}
      readOnly={!state.writable} onClose={saved} />}
    {provider === 'custom' && editing && <CustomProviderCard taken={state.rows.map(value => value.entry.provider)}
      protocols={protocolChoices(state.namespaces.get('llm-pi-ai'), schema)} revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
      operations={operations} t={t} readOnly={!state.writable} onClose={saved} />}
    {row && providerUsable(row) && <>
      <label className={styles.field}><span>{t('modelId')}</span>
        <input className={styles.input} aria-label={t('modelId')} list="setup-models" value={model} onChange={(event) =>{  setModel(event.target.value) }} />
        <datalist id="setup-models">{candidates.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</datalist>
      </label>
      <button className={styles.intelligenceSave} disabled={busy || !model.trim()} onClick={() => { void useModel() }}>{t('providerUse')}</button>
    </>}
    {setup.error !== null && <p role="alert" className={styles.error}>{t('providerSetupSaveFailed')}</p>}
    <button className={styles.intelligenceSave} disabled={busy || setup.status === 'saving'} onClick={() => { void setupController.acknowledge() }}>{t('onboardingLater')}</button>
  </OnboardingModal>
}
