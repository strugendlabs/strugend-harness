/** Decision audit events remain readable when a desktop task is reopened. */
import type {} from '@deepseek-ai/dsh-agentos-protocol/decision-events'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { expect, it } from 'vitest'

it('restores a logged local request and unavailable result without losing their sequence relationship', async () => {
  const session = Session.create(SessionId('strugend-persistence'))
  const request = session.append('strugend/decision-request', {
    checkpoint: 'verification', runtime: 'local', payload: {
      model: 'convaiinnovations/laya-multilingual', state: 'The build exited zero.',
      questions: { complete: { type: 'noul', instructions: 'Does this establish the requested result?' } },
    },
  })
  const result = session.append('strugend/decision-result', {
    checkpoint: 'verification', requestSeq: request.seq,
    result: { available: false, runtime: 'local', status: 'unavailable', reason: 'Model file checksum mismatch.' },
  })
  const stored = JSON.parse(JSON.stringify([request, result])) as SessionEvent[]
  const restored = validateStoredEvents(session.header, stored)
  expect(Session.create(session.id, restored, session.header).seq).toBe(3)
  await expect(JSON.stringify(restored.map(event => ({ ...event, time: 0 })), null, 2) + '\n')
    .toMatchFileSnapshot('./expected/strugend-decision-events.json')
  expect(() => validateStoredEvents(session.header, [{ ...restored[0], type: 'strugend/unknown' }] as unknown as SessionEvent[]))
    .toThrow('unknown to this harness')
})
