// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Automations } from '../src/client/Automations.tsx'
import { en } from '../src/client/locales.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('previews exact dates before saving and defaults to review permission', async () => {
  const requests: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') { if (typeof init.body !== 'string') throw new Error('Expected JSON text'); const body = JSON.parse(init.body) as Record<string, unknown>; requests.push(body); return Response.json({ result: body.action === 'preview' ? { dates: ['2026-10-01T07:00:00Z'] } : {}, automations: [], runs: [] }) }
    return Response.json({ automations: [], runs: [], pausedForUpdate: false })
  }))
  const view = render(<Automations workspace="/workspace" openTask={vi.fn()} t={makeTranslate(en)} />)
  await act(async () => {})
  fireEvent.click(view.getByRole('button', { name: 'Job search' }))
  expect((view.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByLabelText('Submission permission') as HTMLSelectElement).value).toBe('review')
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Preview next times' })) })
  expect((view.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => { fireEvent.submit(view.getByLabelText('What should Strugend do?').closest('form')!) })
  expect(requests.map(r => r.action)).toEqual(['preview', 'create'])
  expect(requests[1]!.spec).toMatchObject({ mode: 'job', submission: 'review', workspace: '/workspace', maxRunMinutes: 30 })
})
it('shows run outcomes and opens the durable task', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ automations: [], pausedForUpdate: false, runs: [{ id: 'run', sessionId: 'task', status: 'needs_attention', scheduledAt: Date.now(), summary: 'Sign in to the employer portal.', spec: { name: 'Jobs', rule: { timeZone: 'Europe/Berlin' } } }] })))
  const openTask = vi.fn(), view = render(<Automations workspace="/workspace" openTask={openTask} t={makeTranslate(en)} />)
  await act(async () => {})
  expect(view.getByText('Needs attention')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Open run' }))
  expect(openTask).toHaveBeenCalledWith('task')
})
