/** Delegated billing totals stay separate from ordinary forks and unknown records. */
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { delegatedUsage } from '../src/client/chat/usage-family.ts'

function row(id: string, parent?: string, tokens?: number, origin?: 'subagent'): SessionSummary {
  return {
    id: SessionId(id), displayTitle: id, running: false, blank: false, updatedAt: 0, retainedBy: {},
    ...(parent === undefined ? {} : { parentId: SessionId(parent) }),
    ...(origin === undefined ? {} : { origin }),
    ...(tokens === undefined ? {} : { projectionValues: { tokenUsage: {
      uncachedInputTokens: tokens, outputTokens: tokens, cacheReadTokens: tokens * 10, cacheWriteTokens: 0,
    } } }),
  }
}

describe('delegated usage', () => {
  it('counts nested delegates once and excludes ordinary forks and unrelated tasks', () => {
    const rows = [row('root', 'nested', 100, 'subagent'), row('worker', 'root', 2, 'subagent'),
      row('nested', 'worker', 3, 'subagent'), row('fork', 'root', 999), row('other', undefined, 999)]
    expect(delegatedUsage(SessionId('root'), Object.fromEntries(rows.map(item => [item.id, item])))).toEqual({
      count: 2, missing: 0,
      usage: { uncachedInputTokens: 5, outputTokens: 5, cacheReadTokens: 50, cacheWriteTokens: 0 },
    })
  })

  it('reports missing cached usage without dropping reachable descendants', () => {
    const rows = [row('worker', 'root', undefined, 'subagent'), row('nested', 'worker', 3, 'subagent')]
    const result = delegatedUsage(SessionId('root'), Object.fromEntries(rows.map(item => [item.id, item])))
    expect(result.count).toBe(2)
    expect(result.missing).toBe(1)
    expect(result.usage.outputTokens).toBe(3)
  })
})
