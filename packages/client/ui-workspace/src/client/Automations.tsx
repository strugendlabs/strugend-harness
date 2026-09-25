/** On-demand schedule management; no polling or model process survives this view. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Automation, AutomationRule, AutomationSnapshot, AutomationRun } from '@deepseek-ai/dsh-agentos-protocol'
import css from './Automations.module.css'

type Props = PropsLocale<'workspace'> & { workspace: string; openTask: (id: SessionId) => void }
type Draft = { id?: string; revision?: number; name: string; instructions: string; workspace: string; mode: Automation['mode']; submission: Automation['submission']; rule: AutomationRule; maxRunMinutes: number; catchUpHours: number; model?: Automation['model'] }

/** @param props - Workspace, navigation and locale. @returns Persistent schedule editor and recent run history. */
export function Automations({ workspace, openTask, t }: Props) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot | null>(null)
  const [older, setOlder] = useState<{ runs: AutomationRun[]; cursor: number | null } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const initial = (): Draft => ({ name: '', instructions: '', workspace, mode: 'normal', submission: 'review', maxRunMinutes: 30, catchUpHours: 24,
    rule: { kind: 'calendar', cron: '0 9 * * 1-5', timeZone } })
  const load = async (signal: AbortSignal): Promise<void> => {
    const response = await fetch('/api/strugend/automations', { signal })
    if (!response.ok) throw new Error(t('automations.loadError'))
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('automations' in value) || !Array.isArray(value.automations) || !('runs' in value) || !Array.isArray(value.runs)) throw new Error(t('automations.loadError'))
    if (!signal.aborted) setSnapshot(value as AutomationSnapshot)
  }
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      try { await load(abort.signal) } catch (cause) { if (!abort.signal.aborted) setError(String(cause)) }
      if (!abort.signal.aborted) timer = setTimeout(() => { void refresh() }, 5000)
    }
    void refresh()
    void window.agentOS?.request({ type: 'background.read' }).then((value) => { if (!abort.signal.aborted && value && typeof value === 'object' && 'openAtLogin' in value) setLogin(value.openAtLogin === true) }).catch((cause: unknown) => { if (!abort.signal.aborted) setError(String(cause)) })
    return () => { abort.abort(); clearTimeout(timer); controller.current = null }
  }, [])
  const mutate = async (body: unknown): Promise<void> => {
    const signal = controller.current?.signal
    if (!signal || busy) return
    const alive = (): boolean => !signal.aborted
    if (!alive()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/strugend/automations', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal })
      const value = await response.json() as { error?: string; result?: { dates?: string[] } }
      if (!response.ok) throw new Error(value.error ?? t('automations.loadError'))
      if (!alive()) return
      if (value.result?.dates) setPreview(value.result.dates)
      else { setDraft(null); setPreview([]); await load(signal) }
    } catch (cause) { if (alive()) setError(String(cause)) }
    finally { if (alive()) setBusy(false) }
  }
  const moreHistory = async (): Promise<void> => {
    const cursor = older ? older.cursor : snapshot?.nextRunCursor
    const signal = controller.current?.signal
    if (!cursor || !signal || busy) return
    setBusy(true)
    try {
      const response = await fetch(`/api/strugend/automations?before=${cursor}`, { signal })
      if (!response.ok) throw new Error(t('automations.loadError'))
      const page = await response.json() as AutomationSnapshot
      if (!signal.aborted) setOlder(previous => ({ runs: [...(previous?.runs ?? []), ...page.runs], cursor: page.nextRunCursor }))
    } catch (cause) { if (!signal.aborted) setError(String(cause)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const history = [...new Map([...(older?.runs ?? []), ...(snapshot?.runs ?? [])].map(run => [run.id, run])).values()]
    .sort((a, b) => b.scheduledAt - a.scheduledAt)
  const change = (patch: Partial<Draft>): void => { setDraft(current => current ? { ...current, ...patch } : null); setPreview([]) }
  const dates = (at: number, zone: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(at)
  return <div className={css.page}>
    <p className={css.hint}>{t('automations.local')}</p>
    <label className={css.inline}><input type="checkbox" checked={login} onChange={(event) => {
      const checked = event.target.checked
      void window.agentOS?.request({ type: 'background.login', enabled: checked }).then((value) => { if (controller.current && value && typeof value === 'object' && 'openAtLogin' in value) { setLogin(value.openAtLogin === true); if (checked && !value.openAtLogin) setError(t('automations.loginUnavailable')) } }).catch((cause: unknown) => { if (controller.current) setError(String(cause)) })
    }} />{t('automations.login')}</label>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {snapshot?.pausedForUpdate && <p role="status">{t('automations.updatePause')}</p>}
    {!draft && <div className={css.actions}>
      <button onClick={() => { setDraft(initial()); setPreview([]) }}>{t('automations.create')}</button>
      {(['jobs', 'exams', 'forms'] as const).map(template => <button key={template} onClick={() => {
        setDraft({ ...initial(), name: t(`automations.template.${template}`), instructions: t(`automations.prompt.${template}`), mode: template === 'jobs' ? 'job' : 'normal' }); setPreview([])
      }}>{t(`automations.template.${template}`)}</button>)}
    </div>}
    {draft && <form className={css.editor} onSubmit={(event) => { event.preventDefault(); void mutate({ action: draft.id ? 'update' : 'create', id: draft.id, revision: draft.revision, spec: draft }) }}>
      <label>{t('agentos.name')}<input required value={draft.name} maxLength={160} onChange={(e) => { change({ name: e.target.value }) }} /></label>
      <label>{t('automations.instructions')}<textarea required rows={4} value={draft.instructions} maxLength={32000} onChange={(e) => { change({ instructions: e.target.value }) }} /></label>
      <label>{t('automations.workspace')}<input required value={draft.workspace} onChange={(e) => { change({ workspace: e.target.value }) }} /></label>
      <div className={css.columns}>
        <label>{t('automations.mode')}<select value={draft.mode} onChange={(e) => { change({ mode: e.target.value as Draft['mode'] }) }}>{(['coding', 'job', 'normal', 'repair'] as const).map(mode => <option key={mode} value={mode}>{t(`automations.mode.${mode}`)}</option>)}</select></label>
        <label>{t('automations.permission')}<select value={draft.submission} onChange={(e) => { change({ submission: e.target.value as Draft['submission'] }) }}><option value="review">{t('automations.review')}</option><option value="automatic">{t('automations.automatic')}</option></select></label>
        <label>{t('automations.frequency')}<select value={draft.rule.kind} onChange={(e) => {
          change({ rule: e.target.value === 'once' ? { kind: 'once', at: new Date(Date.now() + 3600_000).toISOString(), timeZone: draft.rule.timeZone }
            : e.target.value === 'interval' ? { kind: 'interval', minutes: 60, timeZone: draft.rule.timeZone } : { kind: 'calendar', cron: '0 9 * * 1-5', timeZone: draft.rule.timeZone } })
        }}>{(['once', 'interval', 'calendar'] as const).map(kind => <option key={kind} value={kind}>{t(`automations.frequency.${kind}`)}</option>)}</select></label>
        <label>{t('automations.timezone')}<input required value={draft.rule.timeZone} onChange={(e) => { change({ rule: { ...draft.rule, timeZone: e.target.value } }) }} /></label>
      </div>
      {draft.rule.kind === 'calendar' && <label>{t('automations.calendar')}<select value={draft.rule.cron} onChange={(e) => { change({ rule: { kind: 'calendar', cron: e.target.value, timeZone: draft.rule.timeZone } }) }}>
        <option value={draft.rule.cron}>{draft.rule.cron}</option><option value="0 9 * * *">{t('automations.daily')}</option><option value="0 9 * * 1-5">{t('automations.weekdays')}</option><option value="0 9 * * 1">{t('automations.weekly')}</option><option value="0 9 1 * *">{t('automations.monthly')}</option>
      </select><input aria-label={t('automations.calendar')} value={draft.rule.cron} onChange={(e) => { change({ rule: { kind: 'calendar', cron: e.target.value, timeZone: draft.rule.timeZone } }) }} /><small>{t('automations.cronHint')}</small></label>}
      {draft.rule.kind === 'once' && <label>{t('automations.date')}<input required value={draft.rule.at} onChange={(e) => { change({ rule: { kind: 'once', at: e.target.value, timeZone: draft.rule.timeZone } }) }} /><small>{t('automations.dateHint')}</small></label>}
      {draft.rule.kind === 'interval' && <label>{t('automations.minutes')}<input type="number" min={5} max={525600} value={draft.rule.minutes} onChange={(e) => { change({ rule: { kind: 'interval', minutes: Number(e.target.value), timeZone: draft.rule.timeZone } }) }} /></label>}
      <div className={css.columns}><label>{t('automations.runLimit')}<input type="number" min={1} max={240} value={draft.maxRunMinutes} onChange={(e) => { change({ maxRunMinutes: Number(e.target.value) }) }} /></label><label>{t('automations.catchup')}<input type="number" min={1} max={168} value={draft.catchUpHours} onChange={(e) => { change({ catchUpHours: Number(e.target.value) }) }} /></label></div>
      <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void mutate({ action: 'preview', spec: draft }) }}>{t('automations.preview')}</button><button type="submit" disabled={busy || preview.length === 0}>{t('agentos.save')}</button><button type="button" onClick={() => { setDraft(null) }}>{t('automations.cancelEdit')}</button></div>
      {preview.length > 0 && <ul>{preview.map(at =>
        <li key={at}>{dates(Date.parse(at), draft.rule.timeZone)} · {draft.rule.timeZone}</li>)}</ul>}
    </form>}
    {snapshot?.automations.length === 0 && !draft && <p>{t('automations.empty')}</p>}
    {snapshot?.automations.map(row => <article key={row.id} className={css.card}>
      <div className={css.heading}><strong>{row.name}</strong><span>{t(row.enabled ? 'automations.enabled' : 'automations.paused')}</span></div>
      <p>{row.nextAt === null ? t('automations.noNext') : `${dates(row.nextAt, row.rule.timeZone)} · ${row.rule.timeZone}`}</p>
      <small>{t(row.submission === 'automatic' ? 'automations.automatic' : 'automations.review')}</small>
      <div className={css.actions}><button disabled={busy} onClick={() => { setDraft(row); setPreview([]) }}>{t('automations.edit')}</button>
        {(['run', row.enabled ? 'pause' : 'resume', 'duplicate', 'delete'] as const).map(action => <button key={action} disabled={busy} onClick={() => { void mutate({ action, id: row.id }) }}>{t(`automations.${action}`)}</button>)}
      </div>
    </article>)}
    <h3>{t('automations.history')}</h3>
    {history.map(run => <article key={run.id} className={css.card}>
      <div className={css.heading}><strong>{run.spec.name}</strong><span>{t(`automations.status.${run.status}`)}</span></div>
      <small>{dates(run.scheduledAt, run.spec.rule.timeZone)}</small>
      {run.summary && <p className={css.summary}>{run.summary}</p>}
      <div className={css.actions}>{run.sessionId && <button onClick={() => { openTask(run.sessionId as SessionId) }}>{t('automations.openRun')}</button>}{['queued', 'running'].includes(run.status) && <button disabled={busy} onClick={() => { void mutate({ action: 'cancel', id: run.id }) }}>{t('automations.cancelRun')}</button>}</div>
    </article>)}
    {(older ? older.cursor : snapshot?.nextRunCursor) && <button disabled={busy} onClick={() => { void moreHistory() }}>{t('automations.moreHistory')}</button>}
  </div>
}
