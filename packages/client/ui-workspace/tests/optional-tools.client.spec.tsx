// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OptionalTools, OptionalToolsSetup } from '../src/client/OptionalTools.tsx'
import type { ComponentViewState } from '../src/client/component-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const store = createSnapshotStore<ComponentViewState>({ status: 'ready', error: null, busy: false, value: {
    setupComplete: false, localAllowed: false, localReason: 'Low memory', components: [
      { id: 'decision', state: 'incompatible', available: false, version: '1', downloadBytes: 100, installedBytes: 200, progressBytes: 0 },
      { id: 'documents', state: 'absent', available: true, version: '1', downloadBytes: 300, installedBytes: 400, progressBytes: 0 },
    ],
  } })
  const complete = vi.fn()
  const setup = vi.fn(async () => {
    const current = store.getSnapshot()
    store.set({ ...current, value: { ...current.value!, setupComplete: true } })
    return true
  })
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props = {
    complete, close: vi.fn(), stepId: 'optional-tools', openSection: vi.fn(),
    usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook, useResource: unusedHook, useWorkspaces: unusedHook,
    useComponents: bindSnapshotSelector(store), load: vi.fn(async () => {}),
    setup, change: vi.fn(async () => true), t: makeTranslate(en),
  }
  return { store, props }
}

it('allows skipping an incompatible optional model without downloading it', async () => {
  const { props } = fixture()
  const view = render(<OptionalToolsSetup {...props} />)
  expect((view.getByRole('button', { name: 'Install decision support' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Skip for now' })) })
  expect(props.setup).toHaveBeenCalledWith('skip')
  expect(props.complete).toHaveBeenCalledOnce()
  expect(props.change).not.toHaveBeenCalled()
  expect(view.queryByRole('dialog')).toBeNull()
})

it('retains independent document installation controls on a low-memory computer', () => {
  const { props } = fixture()
  const view = render(<OptionalTools {...props} />)
  const installs = view.getAllByRole('button', { name: 'Install' }) as HTMLButtonElement[]
  expect(installs.map(button => button.disabled)).toEqual([true, false])
  fireEvent.click(installs[1]!)
  expect(props.change).toHaveBeenCalledWith('documents', 'install')
})
