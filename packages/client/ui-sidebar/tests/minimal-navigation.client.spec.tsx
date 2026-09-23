// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MinimalNavigation } from '../src/client/MinimalNavigation.tsx'
import type { SidebarRootComponentProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function Harness({ startSession }: { startSession: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState(false)
  const props = {
    collapsed, width: 360, startSession, toggleSidebar: () => { setCollapsed(value => !value) }, selectPanel: vi.fn(),
    usePanels: (selector: (value: []) => unknown) => selector([]),
    usePanelInfo: (selector: (value: { activePanelId: null }) => unknown) => selector({ activePanelId: null }),
    useSessions: (selector: (value: { byId: object }) => unknown) => selector({ byId: selected ? { task: { id: 'task', displayTitle: 'Selected project', retainedBy: { mainView: 1 } } } : {} }),
    t: (key: keyof typeof en) => en[key],
    renderSlot: (name: string) => name === 'sidebar.workspaces' ? <button onClick={() => { setSelected(true) }}>Project task</button>
      : name === 'sidebar.settings' ? <button>Settings</button> : null,
  } as unknown as SidebarRootComponentProps
  return <MinimalNavigation {...props} />
}

describe('Strugend navigation', () => {
  it('starts open without taking focus and lets the user close and reopen it', () => {
    render(<Harness startSession={vi.fn()} />)
    expect(screen.getByText('Project task')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    const history = screen.getByRole('button', { name: 'History' })
    expect(history.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).not.toBe(screen.getByRole('complementary'))
    fireEvent.click(screen.getByRole('button', { name: 'Close history' }))
    expect(screen.queryByText('Project task')).toBeNull()
    expect(document.activeElement).toBe(history)
    fireEvent.click(history)
    const sidebar = screen.getByRole('complementary', { name: 'History' })
    expect(document.activeElement).toBe(sidebar)
    expect(fireEvent.keyDown(sidebar, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(sidebar, { key: 'Escape' })
    expect(screen.queryByText('Project task')).toBeNull()
    expect(document.activeElement).toBe(history)
  })

  it('keeps history visible when selecting a conversation', () => {
    render(<Harness startSession={vi.fn()} />)
    fireEvent.click(screen.getByText('Project task'))
    expect(screen.getByText('Selected project')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
  })

  it('starts a task without closing history', () => {
    const startSession = vi.fn()
    render(<Harness startSession={startSession} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[1]!)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledWith()
    expect(screen.getByRole('complementary')).toBeTruthy()
  })
})
