// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { decisionReviewDefinition, type DecisionReviewData } from '../src/client/conversation-nodes/decision-review.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { DecisionReviewNodeView } from '../src/client/chat/DecisionReviewNodeView.tsx'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)
const t = makeTranslate(en)
function entry(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 100, type, data } as SessionEvent }
}
function project(result?: Record<string, unknown>): DecisionReviewData | undefined {
  const events = [entry(1, 'strugend/decision-request', { checkpoint: 'verification', runtime: 'local', payload: {
    model: 'review', state: 'No test evidence', questions: { review: { type: 'choice', instructions: 'Choose a check', criteria: { test: 'Run the focused test before shipping.', inspect: 'Inspect the changed file.' } } },
  } })]
  if (result) events.push(entry(2, 'strugend/decision-result', { checkpoint: 'verification', requestSeq: 1, result }))
  const assembler = new ConversationNodeAssembler(
    { entries: () => [decisionReviewDefinition], fallbackEntry: () => undefined }, { entries: () => [chatViewDefinition] },
  )
  assembler.replaceWindow(events, false)
  assembler.activateTarget('chat')
  const nodes = (assembler.snapshot('chat') as ChatSnapshot).nodes.values()
  expect(nodes).toHaveLength(1)
  return nodes[0]?.data as DecisionReviewData
}

describe('Decision review presentation', () => {
  it('correlates completion with its request and renders the selected criterion', () => {
    expect(project()?.status).toBe('pending')
    expect(project({ available: true, status: 'checked', latencyMs: 23, answers: { review: { type: 'choice', choice: 'test', confidence: .9 } } })).toMatchObject({ status: 'suggestion', elapsedMs: 23, suggestion: 'Run the focused test before shipping.' })
  })

  it('does not present unavailable or unrecognized answers as successful reviews', () => {
    expect(project({ available: false, status: 'unavailable' })?.status).toBe('unavailable')
    expect(project({ available: true, status: 'inconclusive', answers: { review: { type: 'choice', choice: 'test' } } })?.status).toBe('inconclusive')
    expect(project({ available: true, status: 'checked', answers: { review: { type: 'choice', choice: 'missing' } } })?.status).toBe('inconclusive')
  })

  it('keeps technical fields out of the initial DOM and labels suggestions as advisory', () => {
    const data = project({ available: true, status: 'checked', model: 'technical-model-id', answers: { review: { type: 'choice', choice: 'test' } } })!
    const props = { node: { kind: 'decision-review', data }, t } as ChatNodeViewProps<'decision-review'>
    const view = render(<DecisionReviewNodeView {...props} />)
    expect(view.getByText('Review suggestion')).toBeTruthy()
    expect(view.getByText('Advisory only; tests and direct verification still apply.')).toBeTruthy()
    expect(view.queryByText(/technical-model-id/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Details' }))
    expect(view.getByText(/technical-model-id/)).toBeTruthy()
  })
})
