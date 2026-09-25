/** User-owned desktop update consent, with signed-installation eligibility. */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Automations.module.css'

/** @param props - Workspace locale. @returns Desktop update preferences and explicit check action. */
export function UpdateSettings({ t }: PropsLocale<'workspace'>) {
  const [value, setValue] = useState<{ mode: 'ask' | 'automatic'; automaticAvailable: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.agentOS?.request({ type: 'updates.preferences' }).then((result) => {
      if (alive && result && typeof result === 'object' && 'mode' in result && 'automaticAvailable' in result && ['ask', 'automatic'].includes(String(result.mode)) && typeof result.automaticAvailable === 'boolean')
        setValue(result as NonNullable<typeof value>)
    }).catch((cause: unknown) => { if (alive) setError(String(cause)) })
    return () => { alive = false }
  }, [])
  return <div className={css.page}>
    <h2>{t('updates.title')}</h2><p>{t('updates.description')}</p>
    <label>{t('updates.preference')} <select disabled={!value} value={value?.mode ?? 'ask'} onChange={(event) => {
      const mode = event.target.value as 'ask' | 'automatic'
      void window.agentOS?.request({ type: 'updates.preferences', mode }).then(() => { setValue(old => old ? { ...old, mode } : old) }).catch((cause: unknown) => { setError(String(cause)) })
    }}><option value="ask">{t('updates.ask')}</option><option value="automatic" disabled={!value?.automaticAvailable}>{t('updates.automatic')}</option></select></label>
    {value && !value.automaticAvailable && <p>{t('updates.preview')}</p>}
    <div className={css.actions}><button onClick={() => { void window.agentOS?.request({ type: 'updates.check' }).catch((cause: unknown) => { setError(String(cause)) }) }}>{t('updates.check')}</button></div>
    {error && <p role="alert">{error}</p>}
  </div>
}
