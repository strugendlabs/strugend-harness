/**
 * The Core model choice: which registered route and model every new chat, task
 * and background run starts on.
 *
 * The composer's model seat switches the chat in front of the user; this card
 * is the deployment-level answer to the same question, and the only place a
 * hand-configured route can be promoted to the default without opening a chat.
 * The list is the page's own directory joined with the Host catalog, so a route
 * with no key still appears and its models are simply not offered.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './ModelsSection.module.css'

/** One route offered as a Core model home. */
export interface CoreModelProvider {
  /** Registered route id, e.g. `openrouter`. */
  readonly provider: string
  /** Display name the directory gives the route. */
  readonly displayName: string
  /** Whether the route currently resolves and can serve a request. */
  readonly active: boolean
}

/** One selectable model of a route. */
export interface CoreModelOption {
  readonly id: string
  readonly name: string
}

/** Copy keys this card renders. */
export type CoreModelPickerKey =
  | 'coreModelTitle' | 'coreModelHint' | 'coreModelProvider' | 'coreModelModel'
  | 'coreModelUse' | 'coreModelCurrent' | 'coreModelNone' | 'coreModelSaved'
  | 'coreModelFailed' | 'coreModelLoading' | 'coreModelEmpty'

/**
 * Fill this card's one placeholder, the way the section's own copy helper does,
 * rather than depending on the binding's parameter support.
 */
function fill(template: string, name: string, value: string): string {
  return template.replace(`{${name}}`, () => value)
}

/** Props for {@link CoreModelPicker}. */
export interface CoreModelPickerProps {
  /** Every route the page knows, in directory order. */
  readonly providers: readonly CoreModelProvider[]
  /** The currently saved default, when the settings document carries one. */
  readonly current: { readonly provider: string; readonly model: string } | undefined
  /** Read one route's models from the Host catalog. */
  readonly modelsForProvider: (provider: string) => Promise<readonly CoreModelOption[]>
  /** Persist one route and model as the Core default. */
  readonly setDefaultModel: (provider: string, model: string) => Promise<void>
  /** Whether the settings provider refuses writes. */
  readonly readOnly: boolean
  /** Section copy; placeholders are filled by {@link fill}. */
  readonly t: (key: CoreModelPickerKey) => string
}

/**
 * Render the Core model card.
 * @param props - routes, the saved default, the two Host operations, and copy.
 * @returns the selector, its progress line, and its result notice.
 */
export function CoreModelPicker({ providers, current, modelsForProvider, setDefaultModel, readOnly, t }: CoreModelPickerProps): ReactNode {
  const routable = useMemo(() => providers.filter(provider => provider.active), [providers])
  const [provider, setProvider] = useState(current?.provider ?? '')
  const [model, setModel] = useState(current?.model ?? '')
  const [options, setOptions] = useState<readonly CoreModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [saved, setSaved] = useState('')
  const [writing, setWriting] = useState(false)

  // The saved default can arrive after the first render (the page loads it from
  // the settings document), so the selection follows it until the user picks.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched || current === undefined) return
    setProvider(current.provider)
    setModel(current.model)
  }, [current, touched])

  useEffect(() => {
    if (provider === '') { setOptions([]); return undefined }
    let active = true
    setLoading(true)
    setFailure('')
    void modelsForProvider(provider).then(
      (models) => { if (active) { setOptions(models); setLoading(false) } },
      (reason: unknown) => {
        if (!active) return
        setOptions([])
        setLoading(false)
        setFailure(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { active = false }
  }, [provider, modelsForProvider])

  const save = async (): Promise<void> => {
    if (provider === '' || model === '') return
    setWriting(true)
    setFailure('')
    setSaved('')
    try {
      await setDefaultModel(provider, model)
      setSaved(t('coreModelSaved'))
    } catch (reason: unknown) {
      setFailure(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWriting(false)
    }
  }

  const currentLabel = current === undefined
    ? t('coreModelNone')
    : `${providers.find(entry => entry.provider === current.provider)?.displayName ?? current.provider} · ${current.model}`

  return (
    <section className={styles['coreModel']} data-core-model aria-label={t('coreModelTitle')}>
      <h3 className={styles['coreModelTitle']}>{t('coreModelTitle')}</h3>
      <p className={styles['coreModelHint']}>{t('coreModelHint')}</p>
      <p className={styles['coreModelCurrent']} data-core-model-current>{fill(t('coreModelCurrent'), 'model', currentLabel)}</p>
      <div className={styles['coreModelRow']}>
        <label className={styles['coreModelField']}>
          {t('coreModelProvider')}
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            aria-label={t('coreModelProvider')}
            value={provider}
            disabled={readOnly || routable.length === 0}
            onChange={(event) => {
              setTouched(true)
              setSaved('')
              setProvider(event.target.value)
              setModel('')
            }}
          >
            <option value="">{t('coreModelNone')}</option>
            {routable.map(entry => <option key={entry.provider} value={entry.provider}>{entry.displayName}</option>)}
          </select>
        </label>
        <label className={styles['coreModelField']}>
          {t('coreModelModel')}
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            aria-label={t('coreModelModel')}
            value={model}
            disabled={readOnly || provider === '' || loading}
            onChange={(event) => { setTouched(true); setSaved(''); setModel(event.target.value) }}
          >
            <option value="">{loading ? t('coreModelLoading') : t('coreModelNone')}</option>
            {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={readOnly || writing || provider === '' || model === ''}
          data-core-model-use
          onClick={() => { void save() }}
        >
          {t('coreModelUse')}
        </button>
      </div>
      {provider !== '' && !loading && options.length === 0 && failure === ''
        ? <p className={styles['notice']} data-core-model-empty>{t('coreModelEmpty')}</p>
        : null}
      {failure === '' ? null : <p className={styles['error']} role="alert">{fill(t('coreModelFailed'), 'message', failure)}</p>}
      {saved === '' ? null : <p className={styles['savedNotice']} role="status" aria-live="polite">{saved}</p>}
    </section>
  )
}
