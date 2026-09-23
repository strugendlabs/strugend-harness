/** Product top bar and dismissible history drawer, retaining the workspace slot. */
import { useEffect, useRef } from 'react'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './MinimalNavigation.module.css'

/**
 * Render Strugend navigation while leaving task and project operations with their owners.
 * @param props - Sidebar slot actions, live selection, and declared child slots.
 * @returns Persistent top bar and an on-demand history drawer.
 */
export function MinimalNavigation({
  collapsed, toggleSidebar, startSession, selectPanel, usePanels, useSessions,
  usePanelInfo, renderSlot, t,
}: SidebarRootComponentProps) {
  const panels = usePanels(value => value)
  const panelId = usePanelInfo(value => value.activePanelId)
  const active = useSessions(value => Object.values(value.byId).find(row => (row.retainedBy.mainView ?? 0) > 0))
  const previousSession = useRef(active?.id)
  const historyButton = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const close = (): void => {
    if (!collapsed) toggleSidebar()
    historyButton.current?.focus()
  }
  useEffect(() => {
    if (previousSession.current !== active?.id) {
      previousSession.current = active?.id
      if (!collapsed) toggleSidebar()
    }
  }, [active?.id, collapsed, toggleSidebar])
  useEffect(() => {
    if (!collapsed) drawer.current?.focus()
  }, [collapsed])
  const newChat = (): void => {
    startSession()
    close()
  }
  return (
    <>
      <header className={css.topbar} data-strugend-topbar>
        <button type="button" className={css.brand} onClick={newChat} aria-label={t('session.new.label')}>
          <span className={css.mark} aria-hidden="true">{renderSlot('sidebar.brand.mark', { size: 36 }, {
            fallback: <img src="/assets/strugend/mark-512.png" width={36} height={36} alt="" draggable={false} />,
          })}</span>
          <span>{t('brand.name')}</span>
        </button>
        <button ref={historyButton} type="button" className={css.historyButton} aria-expanded={!collapsed}
          aria-controls="strugend-history" onClick={toggleSidebar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>{t('history.title')}</span>
        </button>
        <div className={css.title} title={active?.displayTitle}>
          {panels.find(panel => panel.id === panelId)?.label ?? active?.displayTitle ?? t('history.empty')}
        </div>
        <button type="button" className={css.iconButton} aria-label={t('session.new.label')} onClick={newChat}>
          <IconNewChatOutline16 size={18} />
        </button>
        <div className={css.settings}>{renderSlot('sidebar.settings', { wide: false })}</div>
      </header>
      {!collapsed && (
        <div className={css.drawerLayer}>
          <button className={css.backdrop} type="button" aria-label={t('history.close')} onClick={close} tabIndex={-1} />
          <aside id="strugend-history" ref={drawer} tabIndex={-1} className={css.drawer} aria-label={t('history.title')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.stopPropagation(); close() }
              if (event.key !== 'Tab') return
              const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')]
              const first = controls[0]
              const last = controls.at(-1)
              if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) {
                event.preventDefault(); last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
            }}>
            <div className={css.drawerHeader}>
              <strong>{t('history.title')}</strong>
              <button type="button" className={css.iconButton} aria-label={t('history.close')} onClick={close}>×</button>
            </div>
            <button type="button" className={css.newChat} onClick={newChat}>
              <IconNewChatOutline16 size={16} />{t('session.new')}
            </button>
            {panels.length > 0 && <nav className={css.panels} aria-label={t('panels.label')}>
              {panels.map(panel => <button key={panel.id} type="button" aria-current={panel.id === panelId ? 'page' : undefined}
                onClick={() => { selectPanel(panel.id); close() }}>
                {renderSlot('sidebar.panellist', { size: 16, active: panel.id === panelId }, { only: panel.id })}
                {panel.label}
              </button>)}
            </nav>}
            <div className={css.workspaces}>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</div>
            <div className={css.footer}>{renderSlot('sidebar.footer.action', { wide: true })}</div>
          </aside>
        </div>
      )}
    </>
  )
}
