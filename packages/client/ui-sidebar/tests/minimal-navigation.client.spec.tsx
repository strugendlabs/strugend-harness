// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MinimalNavigation } from '../src/client/MinimalNavigation.tsx'
import type { SidebarRootComponentProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function Harness({ startSession }: { startSession: () => void }) {
  const [collapsed, setCollapsed] = useState(true)
  const props = {
    collapsed, width: 240, startSession, toggleSidebar: () => { setCollapsed(value => !value) }, selectPanel: vi.fn(),
    usePanels: (selector: (value: []) => unknown) => selector([]),
    usePanelInfo: (selector: (value: { activePanelId: null }) => unknown) => selector({ activePanelId: null }),
    useSessions: (selector: (value: { byId: object }) => unknown) => selector({ byId: {} }),
    t: (key: keyof typeof en) => en[key],
    renderSlot: (name: string) => name === 'sidebar.workspaces' ? <button>Project task</button>
      : name === 'sidebar.settings' ? <button>Settings</button> : null,
  } as unknown as SidebarRootComponentProps
  return <MinimalNavigation {...props} />
}

describe('Strugend navigation', () => {
  it('defers history mounting, keeps Settings accessible, and restores focus on Escape', () => {
    render(<Harness startSession={vi.fn()} />)
    expect(screen.queryByText('Project task')).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    const history = screen.getByRole('button', { name: 'History' })
    fireEvent.click(history)
    const drawer = screen.getByRole('complementary', { name: 'History' })
    expect(document.activeElement).toBe(drawer)
    expect(screen.getByText('Project task')).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByText('Project task')).toBeNull()
    expect(document.activeElement).toBe(history)
  })

  it('starts a task from the persistent toolbar without a history rail', () => {
    const startSession = vi.fn()
    render(<Harness startSession={startSession} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[1]!)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
