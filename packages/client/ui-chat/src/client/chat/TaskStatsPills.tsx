/** Adds available delegated-agent usage to the viewed conversation's recorded usage. */
import { useCallback, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatsPills, type StatsPillsProps } from './StatsPills.tsx'
import { delegatedUsage } from './usage-family.ts'

/** Catalog refresh supplied by the session controller owner. */
export interface TaskStatsInjected {
  refreshUsage: () => Promise<void>
}

type Props = StatsPillsProps & TaskStatsInjected
  & Pick<PropsRuntime<'conversation.composer.dock'>, 'sessionId' | 'useSessions'>

/**
 * Read catalog metadata without retaining or activating child agents.
 * @param props - Viewed session, catalog selector, locale and refresh callback.
 * @returns Composer statistics with separate main-agent and delegated totals.
 */
export function TaskStatsPills({ sessionId, useSessions, refreshUsage, ...props }: Props) {
  const summaries = useSessions(state => state.byId)
  const family = useMemo(() => delegatedUsage(sessionId, summaries), [sessionId, summaries])
  const [status, setStatus] = useState<'cached' | 'loading' | 'ready' | 'failed'>('cached')
  const refresh = useCallback(() => {
    setStatus('loading')
    void refreshUsage().then(() => { setStatus('ready') }, () => { setStatus('failed') })
  }, [refreshUsage])
  return <StatsPills {...props} delegated={family} onUsageOpen={refresh} usageStatus={status} />
}
