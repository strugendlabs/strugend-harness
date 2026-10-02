/** Sidebar panes one task opened, so the end of that task can close them again. */
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightCloseHandler } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

/** A Session identity, as the Sidebar face addresses one. */
type SessionKey = Parameters<SidebarRightCloseHandler>[0]

/**
 * The Browser panes a task surfaced through the native desktop bridge, keyed by
 * the Session it opened them in.
 *
 * A native browser-open event is how a task's own pane reaches the sidebar, so
 * a claimed record is one the task put there. The status source keeps that
 * claim honest for the opens that are not a task's: the Video Studio's social
 * buttons drive the same desktop command, and they act while their Session is
 * idle. Eligibility is read once, at the open; `finish` then hands the Session's
 * claims back so the caller closes whichever of them is still the task's.
 */
export class OwnedPanes {
  private readonly bySession = new Map<SessionKey, Set<TabId>>()
  private statuses: HostObservable<SessionStatusSnapshot> | undefined

  /**
   * Attach the Session status source whose `running` fact decides eligibility: a
   * pane opened while its Session is known idle is the user's, not a task's.
   * Claims made before the source arrives stay claims, because an unread status
   * is not evidence of an idle Session.
   * @param statuses - unified Session status source.
   */
  follow(statuses: HostObservable<SessionStatusSnapshot>): void {
    this.statuses = statuses
  }

  /**
   * Claim one pane for the task that opened it; an open while the Session is
   * known idle is left alone.
   * @param sessionId - Session the pane was opened in.
   * @param tabId - the opened tab record.
   */
  claim(sessionId: SessionKey, tabId: TabId): void {
    if (this.statuses?.getSnapshot().get(sessionId)?.running === false) return
    const claimed = this.bySession.get(sessionId)
    if (claimed === undefined) this.bySession.set(sessionId, new Set([tabId]))
    else claimed.add(tabId)
  }

  /**
   * Take one Session's claims, leaving it owning none: the caller closes those
   * still open, so a pane the user has meanwhile closed or taken over simply
   * stops being the task's.
   * @param sessionId - Session whose task ended.
   * @returns every tab record that Session still claimed.
   */
  finish(sessionId: SessionKey): readonly TabId[] {
    const claimed = this.bySession.get(sessionId)
    if (claimed === undefined) return []
    this.bySession.delete(sessionId)
    return [...claimed]
  }
}
