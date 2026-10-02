// @vitest-environment jsdom
/** The preview header hands the opened file to the desktop application and the file manager. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextPreview } from '../src/client/TextPreview.tsx'
import { ABSOLUTE_PATH, harness, page, settle } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  delete (window as { agentOS?: unknown }).agentOS
})

/** Publish the application bridge the desktop renderer always has. */
function withDesktop(request: (command: unknown) => Promise<unknown>): void {
  (window as { agentOS?: unknown }).agentOS = { request, subscribe: () => () => {} }
}

it('offers no native opener where the application bridge is absent', async () => {
  const h = harness({ 1: page(1, ['held'], true) })
  const view = render(<TextPreview {...h.props()} />)
  await settle()
  expect(view.queryByRole('button', { name: 'openInSystem' })).toBeNull()
  expect(view.queryByRole('button', { name: 'showInFolder' })).toBeNull()
})

it('opens the previewed file in its system application and reveals it in the folder', async () => {
  const request = vi.fn(async () => null)
  withDesktop(request)
  const h = harness({ 1: page(1, ['held'], true) })
  render(<TextPreview {...h.props()} />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'openInSystem' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith({ type: 'location.open', path: ABSOLUTE_PATH })
  })
  fireEvent.click(screen.getByRole('button', { name: 'showInFolder' }))
  await waitFor(() => {
    expect(request).toHaveBeenLastCalledWith({ type: 'location.open', path: ABSOLUTE_PATH, reveal: true })
  })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('states the refusal of a file the operating system no longer has', async () => {
  const request = vi.fn(async () => { throw new Error('This file or folder has moved or is no longer accessible.') })
  withDesktop(request)
  const h = harness({ 1: page(1, ['held'], true) })
  render(<TextPreview {...h.props()} />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'showInFolder' }))
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('openFailed(message=This file or folder has moved or is no longer accessible.)')
  })
})
