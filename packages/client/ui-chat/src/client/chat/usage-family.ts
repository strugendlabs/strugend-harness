/** Recorded usage for delegated descendants, excluding ordinary conversation forks. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'

/** Available descendant totals and explicit gaps in the cached session catalog. */
export interface DelegatedUsage {
  usage: TokenUsageProjection
  count: number
  missing: number
}

/**
 * Sum each known delegated descendant once without loading its conversation history.
 * @param root - Viewed conversation, excluded from the returned sum.
 * @param summaries - Host catalog with cached projections.
 * @returns Known totals; absent projections increase `missing`, never imply zero usage.
 */
export function delegatedUsage(root: SessionId, summaries: SessionListState['byId']): DelegatedUsage {
  const children = new Map<SessionId, typeof summaries[SessionId][]>()
  for (const row of Object.values(summaries)) {
    if (row.origin !== 'subagent' || row.parentId === undefined) continue
    const siblings = children.get(row.parentId) ?? []
    siblings.push(row)
    children.set(row.parentId, siblings)
  }
  const result: DelegatedUsage = {
    usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    count: 0, missing: 0,
  }
  const visited = new Set([root])
  const pending = [root]
  for (const parent of pending) {
    for (const row of children.get(parent) ?? []) {
      if (visited.has(row.id)) continue
      visited.add(row.id)
      pending.push(row.id)
      result.count++
      const usage = row.projectionValues?.tokenUsage
      if (usage === undefined) { result.missing++; continue }
      result.usage.uncachedInputTokens += usage.uncachedInputTokens
      result.usage.cacheReadTokens += usage.cacheReadTokens
      result.usage.cacheWriteTokens += usage.cacheWriteTokens
      result.usage.outputTokens += usage.outputTokens
    }
  }
  return result
}
