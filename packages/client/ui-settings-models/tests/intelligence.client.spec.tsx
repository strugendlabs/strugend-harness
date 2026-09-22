// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntelligenceSettings } from '../src/client/IntelligenceSettings.tsx'
import type { IntelligenceSnapshot } from '../src/client/IntelligenceSettings.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount() {
  const snapshot: IntelligenceSnapshot = {
    enabled: true, installed: true, available: true, graphUrl: '', decisionMode: 'local', adviceMode: 'observe', localAllowed: true, localReason: '', revision: 7,
    credentials: {
      IMPOSSIBL_API_KEY: { configured: false, writable: true },
      STRUGEND_GITHUB_TOKEN: { configured: false, writable: true },
    },
  }
  const access = { load: vi.fn(async () => snapshot), testConnection: vi.fn(async () => ({ available: true })) }
  const operations = {
    storeCredential: vi.fn<ModelsOperations['storeCredential']>(async () => undefined),
    describeCredential: vi.fn<ModelsOperations['describeCredential']>(async () => undefined),
    removeCredential: vi.fn<ModelsOperations['removeCredential']>(async () => undefined),
    writeSettings: vi.fn<ModelsOperations['writeSettings']>(async () => ({ kind: 'conflict' as const, message: 'Revision changed' })),
    discoverModels: vi.fn<ModelsOperations['discoverModels']>(async () => ({ kind: 'found' as const, models: [] })),
  }
  const view = render(<IntelligenceSettings access={access} operations={operations} t={key => en[key]} />)
  return { ...view, access, operations, snapshot }
}

describe('Intelligence settings', () => {
  it('rejects a pasted environment assignment before storing a key', async () => {
    const { operations } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>('Decision API key')
    fireEvent.change(input, { target: { value: 'IMPOSSIBL_API_KEY=synthetic-key' } })
    fireEvent.submit(input.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(en.keyIllegalCharacters)
    expect(operations.storeCredential).not.toHaveBeenCalled()
  })
  it('shows roles and credential metadata without exposing provider IDs or stored keys', async () => {
    const { container } = mount()
    await screen.findByRole('heading', { name: 'Decision' })
    expect(container.textContent).not.toMatch(/deepseek|\bdsh\b|CORE_TEST_KEY|IMPOSSIBL_API_KEY/u)
    expect(screen.queryByLabelText('Core API key')).toBeNull()
    expect(screen.getAllByDisplayValue('')).toHaveLength(3)
    expect(screen.getByText('Coming soon')).toBeTruthy()
  })

  it('stores a replacement once, clears it, and refreshes configured metadata', async () => {
    const { access, operations, snapshot } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>('Decision API key')
    vi.mocked(operations.storeCredential).mockImplementation(async () => {
      snapshot.credentials.IMPOSSIBL_API_KEY = { configured: true, writable: true }
      return undefined
    })
    fireEvent.change(input, { target: { value: '  synthetic-decision-key  ' } })
    fireEvent.submit(input.closest('form')!)
    await screen.findByText(en.intelligenceSaved)
    expect(operations.storeCredential).toHaveBeenCalledExactlyOnceWith('IMPOSSIBL_API_KEY', 'synthetic-decision-key')
    expect(input.value).toBe('')
    expect(access.load).toHaveBeenCalledTimes(2)
    expect(screen.getByText(en.intelligenceLocalReady)).toBeTruthy()
  })

  it('retains a refused key for retry and hides server diagnostics from the form', async () => {
    const { operations } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>('GitHub API key')
    vi.mocked(operations.storeCredential).mockResolvedValue('Internal provider diagnostic')
    fireEvent.change(input, { target: { value: 'synthetic-graph-token' } })
    fireEvent.submit(input.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(en.intelligenceSaveFailed)
    expect(input.value).toBe('synthetic-graph-token')
    expect(screen.queryByText('Internal provider diagnostic')).toBeNull()
  })

  it('keeps graph credentials and address unavailable and explicitly tests the Decision connection', async () => {
    const { access, operations } = mount()
    await screen.findByRole('heading', { name: 'Graph memory' })
    expect(screen.queryByLabelText(en.intelligenceGraphUrl)).toBeNull()
    expect(screen.queryByLabelText('Memory API key')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Test connection' })[0]!)
    await waitFor(() =>{  expect(access.testConnection).toHaveBeenCalledWith('decision') })
    expect(operations.writeSettings).not.toHaveBeenCalled()
  })
})
