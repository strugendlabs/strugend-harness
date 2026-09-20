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
    graphUrl: '', revision: 7, coreRef: 'CORE_TEST_KEY',
    credentials: {
      CORE_TEST_KEY: { configured: true, writable: false },
      TYPESAFE_API_KEY: { configured: false, writable: true },
      CHRONOGRAPH_TOKEN: { configured: false, writable: true },
    },
  }
  const access = { load: vi.fn(async () => snapshot) }
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
    fireEvent.change(input, { target: { value: 'TYPESAFE_API_KEY=synthetic-key' } })
    fireEvent.submit(input.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(en.keyIllegalCharacters)
    expect(operations.storeCredential).not.toHaveBeenCalled()
  })
  it('shows roles and credential metadata without exposing provider IDs or stored keys', async () => {
    const { container } = mount()
    await screen.findByRole('heading', { name: 'Core' })
    expect(container.textContent).not.toMatch(/deepseek|\bdsh\b|CORE_TEST_KEY|TYPESAFE_API_KEY/u)
    expect(screen.getAllByText(en.credentialConfigured)).toHaveLength(1)
    expect(screen.getByLabelText<HTMLInputElement>('Core API key').disabled).toBe(true)
    expect(screen.getAllByDisplayValue('')).toHaveLength(4)
    expect(container.textContent).not.toMatch(/connected|verified/iu)
  })

  it('stores a replacement once, clears it, and refreshes configured metadata', async () => {
    const { access, operations, snapshot } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>('Decision API key')
    vi.mocked(operations.storeCredential).mockImplementation(async () => {
      snapshot.credentials.TYPESAFE_API_KEY = { configured: true, writable: true }
      return undefined
    })
    fireEvent.change(input, { target: { value: '  synthetic-decision-key  ' } })
    fireEvent.submit(input.closest('form')!)
    await screen.findByText(en.intelligenceSaved)
    expect(operations.storeCredential).toHaveBeenCalledExactlyOnceWith('TYPESAFE_API_KEY', 'synthetic-decision-key')
    expect(input.value).toBe('')
    expect(access.load).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText(en.credentialConfigured)).toHaveLength(2)
  })

  it('retains a refused key for retry and hides server diagnostics from the form', async () => {
    const { operations } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>('Memory API key')
    vi.mocked(operations.storeCredential).mockResolvedValue('Internal provider diagnostic')
    fireEvent.change(input, { target: { value: 'synthetic-graph-token' } })
    fireEvent.submit(input.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe(en.intelligenceSaveFailed)
    expect(input.value).toBe('synthetic-graph-token')
    expect(screen.queryByText('Internal provider diagnostic')).toBeNull()
  })

  it('fences graph edits by revision and preserves a rejected draft', async () => {
    const { operations } = mount()
    const input = await screen.findByLabelText<HTMLInputElement>(en.intelligenceGraphUrl)
    fireEvent.change(input, { target: { value: 'https://memory.example.com' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(operations.writeSettings).toHaveBeenCalledExactlyOnceWith('strugend-intelligence', [
      { op: 'set', path: ['graphUrl'], value: 'https://memory.example.com' },
    ], 7) })
    expect((await screen.findByRole('alert')).textContent).toBe(en.intelligenceGraphFailed)
    expect(input.value).toBe('https://memory.example.com')
    expect(screen.queryByText(en.intelligenceSaved)).toBeNull()
  })
})
