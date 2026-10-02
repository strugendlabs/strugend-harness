// @vitest-environment jsdom
/** The Core model card: which route and model new chats start on. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { CoreModelPicker } from '../src/client/CoreModelPicker.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ComponentProps<typeof CoreModelPicker>['t'] = key => en[key]
/** The same placeholder fill the component applies to its own copy. */
const filled = (template: string, value: string): string => template.replace(/\{\w+\}/u, () => value)

const PROVIDERS = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', active: true },
  { provider: 'openrouter', displayName: 'OpenRouter', active: true },
  { provider: 'gone', displayName: 'Retired route', active: false },
]

const FREE = { id: 'z-ai/glm-5.2:free', name: 'Z.ai: GLM 5.2 (free)' }
const PAID = { id: 'qwen/qwen3.8-27b', name: 'Qwen: Qwen3.8 27B' }

function mount(overrides: Partial<ComponentProps<typeof CoreModelPicker>> = {}) {
  const modelsForProvider = vi.fn(async (provider: string) =>
    provider === 'openrouter' ? [PAID, FREE] : [{ id: 'deepseek-flash', name: 'Core' }])
  const setDefaultModel = vi.fn(async () => undefined)
  const view = render(<CoreModelPicker
    providers={PROVIDERS}
    current={{ provider: 'deepseek-official', model: 'deepseek-flash' }}
    modelsForProvider={modelsForProvider}
    setDefaultModel={setDefaultModel}
    readOnly={false}
    t={t}
    {...overrides}
  />)
  return { ...view, modelsForProvider, setDefaultModel }
}

describe('Core model selection', () => {
  it('names the model in use and offers every live route', async () => {
    const { modelsForProvider } = mount()

    expect(screen.getByText(filled(t('coreModelCurrent'), 'DeepSeek · deepseek-flash'))).toBeTruthy()
    const providers = screen.getByLabelText<HTMLSelectElement>(t('coreModelProvider'))
    expect([...providers.options].map(option => option.textContent)).toEqual(['Not set', 'DeepSeek', 'OpenRouter'])
    await waitFor(() => { expect(modelsForProvider).toHaveBeenCalledWith('deepseek-official') })
    const model = screen.getByLabelText<HTMLSelectElement>(t('coreModelModel'))
    await waitFor(() => { expect([...model.options].map(option => option.textContent)).toEqual(['Not set', 'Core']) })
  })

  it('promotes a free OpenRouter model to the Core default and reports it', async () => {
    const { setDefaultModel } = mount()
    fireEvent.change(screen.getByLabelText(t('coreModelProvider')), { target: { value: 'openrouter' } })
    const model = screen.getByLabelText<HTMLSelectElement>(t('coreModelModel'))
    await waitFor(() => { expect([...model.options].map(option => option.textContent)).toContain('Z.ai: GLM 5.2 (free)') })
    fireEvent.change(model, { target: { value: FREE.id } })
    fireEvent.click(screen.getByText(t('coreModelUse')))

    await waitFor(() => { expect(setDefaultModel).toHaveBeenCalledExactlyOnceWith('openrouter', FREE.id) })
    expect((await screen.findByRole('status')).textContent).toBe(t('coreModelSaved'))
  })

  it('keeps a refused write visible and does not claim success', async () => {
    const setDefaultModel = vi.fn(async () => { throw new Error('Revision changed') })
    mount({ setDefaultModel })
    fireEvent.change(screen.getByLabelText(t('coreModelProvider')), { target: { value: 'openrouter' } })
    const model = screen.getByLabelText<HTMLSelectElement>(t('coreModelModel'))
    await waitFor(() => { expect([...model.options].map(option => option.textContent)).toContain('Z.ai: GLM 5.2 (free)') })
    fireEvent.change(model, { target: { value: FREE.id } })
    fireEvent.click(screen.getByText(t('coreModelUse')))

    expect((await screen.findByRole('alert')).textContent).toBe(filled(t('coreModelFailed'), 'Revision changed'))
    expect(screen.queryByText(t('coreModelSaved'))).toBeNull()
  })

  it('says so when a route loads no models instead of offering an empty choice', async () => {
    mount({ modelsForProvider: vi.fn(async () => []) })
    fireEvent.change(screen.getByLabelText(t('coreModelProvider')), { target: { value: 'openrouter' } })

    expect(await screen.findByText(t('coreModelEmpty'))).toBeTruthy()
    expect(screen.getByText(t('coreModelUse')).closest('button')?.disabled).toBe(true)
  })

  it('refuses to write while the settings host is read-only', () => {
    mount({ readOnly: true })
    expect(screen.getByLabelText<HTMLSelectElement>(t('coreModelProvider')).disabled).toBe(true)
    expect(screen.getByText(t('coreModelUse')).closest('button')?.disabled).toBe(true)
  })
})
