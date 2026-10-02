// @vitest-environment jsdom
/** Explicit file actions preserve their destination, availability, and independent failure state. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PresentedFileCard } from '../src/client/PresentedFileCard.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const props = () => ({
  cwd: undefined,
  file: { path: 'out/report.pdf', description: 'Final report', seq: 4, index: 1 },
  host: { name: 'remote-desktop', available: true, fileManager: 'finder' as const },
  phase: undefined,
  onPreview: vi.fn(),
  onAction: vi.fn(),
  t: makeTranslate(en),
})

const OPEN = 'Open out/report.pdf in the default app'
const REVEAL = 'Show out/report.pdf in the file manager'

it.each([
  ['finder', 'Show in Finder'], ['explorer', 'Show in File Explorer'], ['directory', 'Open containing folder'],
] as const)('reveals the file in one click through the Host %s action', (fileManager, label) => {
  const p = props()
  const view = render(<PresentedFileCard {...p} host={{ ...p.host, fileManager }} />)
  const reveal = view.getByRole('button', { name: REVEAL })
  expect(reveal.getAttribute('title')).toBe(label)
  fireEvent.click(reveal)
  expect(p.onAction).toHaveBeenCalledWith('reveal')
  expect(p.onAction).toHaveBeenCalledTimes(1)
})

it('opens the file in the Host default application in one click, with no menu in between', () => {
  const p = props()
  const view = render(<PresentedFileCard {...p} />)
  expect(view.queryByRole('menu')).toBeNull()
  const open = view.getByRole('button', { name: OPEN })
  expect(open.getAttribute('title')).toBe('Open in default app')
  fireEvent.click(open)
  expect(p.onAction).toHaveBeenCalledWith('open')
  expect(p.onAction).toHaveBeenCalledTimes(1)
})

it.each(['opening', 'revealing'] as const)('disables both native actions while one is %s and keeps sidebar previews available', (phase) => {
  const p = props()
  const view = render(<PresentedFileCard {...p} phase={phase} />)
  expect((view.getByRole('button', { name: OPEN }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: REVEAL }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Preview out/report.pdf in sidebar' }))
  fireEvent.click(view.getByRole('button', { name: 'Open out/report.pdf in sidebar' }))
  expect(p.onPreview).toHaveBeenCalledTimes(2)
  expect(p.onAction).not.toHaveBeenCalled()
})

it('keeps both native actions disabled until a desktop is available, and re-enables them after a settlement', () => {
  const p = props()
  const view = render(<PresentedFileCard {...p} host={null} />)
  expect((view.getByRole('button', { name: OPEN }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: REVEAL }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: 'Open out/report.pdf in sidebar' }) as HTMLButtonElement).disabled).toBe(false)
  view.rerender(<PresentedFileCard {...p} host={{ ...p.host, available: false, fileManager: null }} />)
  expect((view.getByRole('button', { name: OPEN }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: REVEAL }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<PresentedFileCard {...p} phase="opening" />)
  expect((view.getByRole('button', { name: REVEAL }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<PresentedFileCard {...p} phase="opened" />)
  expect((view.getByRole('button', { name: OPEN }) as HTMLButtonElement).disabled).toBe(false)
  expect((view.getByRole('button', { name: REVEAL }) as HTMLButtonElement).disabled).toBe(false)
})

it('opens the right sidebar from either the card or its primary button', () => {
  const p = props()
  const view = render(<PresentedFileCard {...p} />)
  fireEvent.click(view.getByRole('button', { name: 'Preview out/report.pdf in sidebar' }))
  fireEvent.click(view.getByRole('button', { name: 'Open out/report.pdf in sidebar' }))
  expect(p.onPreview).toHaveBeenCalledTimes(2)
  expect(p.onAction).not.toHaveBeenCalled()
})

it('localizes reveal failures and accurately reports a directory-only action', () => {
  const p = props()
  const view = render(<PresentedFileCard {...p} phase="revealError" t={makeTranslate(zh)} />)
  expect(view.getByText(zh['presented.revealError'])).toBeTruthy()
  view.rerender(<PresentedFileCard {...p} phase="revealed" host={{ ...p.host, fileManager: 'directory' }} />)
  expect(view.getByText(en['presented.directoryOpened'])).toBeTruthy()
  view.rerender(<PresentedFileCard {...p} phase="revealed" />)
  expect(view.getByText(en['presented.revealed'])).toBeTruthy()
})

it.each(['error', 'revealError'] as const)('keeps a failed %s visible on the status line and retries it with the same click', (phase) => {
  const p = props()
  const view = render(<PresentedFileCard {...p} phase={phase} />)
  expect(view.getByRole('status').getAttribute('data-error')).toBe('true')
  expect(view.getByText(en[`presented.${phase}`])).toBeTruthy()
  const button = view.getByRole('button', { name: phase === 'error' ? OPEN : REVEAL }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  expect(p.onAction).toHaveBeenCalledWith(phase === 'error' ? 'open' : 'reveal')
})

it.each([en, zh])('names the whole path in both localized action labels', (dictionary) => {
  const t = makeTranslate(dictionary)
  const view = render(<PresentedFileCard {...props()} t={t} />)
  expect(view.getByRole('button', { name: t('presented.openAria', { name: 'out/report.pdf' }) })).toBeTruthy()
  expect(view.getByRole('button', { name: t('presented.revealAria', { name: 'out/report.pdf' }) })).toBeTruthy()
})

it('returns focus to the available preview button after a native action', () => {
  const p = props()
  const view = render(<PresentedFileCard {...p} />)
  const reveal = view.getByRole('button', { name: REVEAL })
  reveal.focus()
  fireEvent.click(reveal)
  view.rerender(<PresentedFileCard {...p} phase="revealing" />)
  const preview = view.getByRole('button', { name: 'Open out/report.pdf in sidebar' })
  expect(document.activeElement).toBe(preview)
  view.rerender(<PresentedFileCard {...p} phase="revealed" />)
  expect(document.activeElement).toBe(preview)
})

it('shows the basename while retaining the full location for hover and actions', () => {
  const p = props()
  const path = '/work/reports/result.pdf'
  const view = render(<PresentedFileCard {...p} cwd="/work" file={{ ...p.file, path }} />)
  expect(view.getByTitle(path)).toBeTruthy()
  expect(view.getByText('result.pdf')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: `Open ${path} in the default app` }))
  expect(p.onAction).toHaveBeenCalledWith('open')
  fireEvent.click(view.getByRole('button', { name: `Show ${path} in the file manager` }))
  expect(p.onAction).toHaveBeenLastCalledWith('reveal')
  view.rerender(<PresentedFileCard {...p} cwd="/work" />)
  expect(view.getByTitle('/work/out/report.pdf')).toBeTruthy()
  expect(view.getByText('report.pdf')).toBeTruthy()
})

it.each([
  ['Quarterly summary (.pdf)', 'Quarterly summary'],
  ['季度总结（PDF）', '季度总结'],
] as const)('omits a trailing parenthesized file suffix from %s', (description, expected) => {
  const p = props()
  const view = render(<PresentedFileCard {...p} file={{ ...p.file, description }} />)
  expect(view.getByText(expected)).toBeTruthy()
  expect(view.queryByText(description)).toBeNull()
})

it.each([en, zh])('distinguishes directory-only progress and errors in each locale', (dictionary) => {
  const p = { ...props(), t: makeTranslate(dictionary) }
  const view = render(<PresentedFileCard {...p} phase="revealing" />)
  expect(view.getByText(dictionary['presented.revealing'])).toBeTruthy()
  view.rerender(<PresentedFileCard {...p} phase="revealing" host={{ ...p.host, fileManager: 'directory' }} />)
  expect(view.getByText(dictionary['presented.directoryOpening'])).toBeTruthy()
  view.rerender(<PresentedFileCard {...p} phase="revealError" host={{ ...p.host, fileManager: 'directory' }} />)
  expect(view.getByText(dictionary['presented.directoryError'])).toBeTruthy()
})
