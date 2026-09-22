/** Compact advisory result with opt-in technical detail. */
import { memo, useState } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './DecisionReviewNodeView.module.css'

/** Display advisory status without implying a successful test or adopted change. */
export const DecisionReviewNodeView = memo(function DecisionReviewNodeView({ node, t }: ChatNodeViewProps<'decision-review'>) {
  const [expanded, setExpanded] = useState(false)
  const data = node.data
  return <section className={css.review} data-decision-review={data.status}>
    <div className={css.heading}>
      <span className={css.symbol} aria-hidden="true">◇</span>
      <strong>{t(data.observedOnly ? 'decision.observedOnly' : `decision.${data.status}`)}</strong>
      {data.elapsedMs !== undefined && <span className={css.elapsed}>{t('duration.milliseconds', { milliseconds: Math.round(data.elapsedMs) })}</span>}
      {data.details !== undefined && <button type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>{t(expanded ? 'decision.hideDetails' : 'decision.details')}</button>}
    </div>
    {data.status === 'suggestion' && <p>{data.suggestion}</p>}
    {(data.status === 'unavailable' || data.status === 'inconclusive') && <p className={css.note}>{t(`decision.${data.status}Hint`)}</p>}
    {data.status === 'suggestion' && <p className={css.note}>{t('decision.advisory')}</p>}
    {expanded && <JsonBlock defaultOpen label={t('decision.details')} payload={data.details} truncatedLabel={total => t('json.truncated', { total })} />}
  </section>
})
