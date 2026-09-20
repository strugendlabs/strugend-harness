/** Native browser titles share the same source as the address bar and agent observations. */
import type { ReactNode } from 'react'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopTabId, type DesktopBrowserInjected } from '../browser/DesktopBrowser.ts'
import css from './Browser.module.css'

type Props = PropsRuntime<'sidebar.right.pane.tab.title'> & InjectFace<DesktopBrowserInjected>

/** Display the loaded page title on the native browser's sidebar tab. */
export function DesktopBrowserTitle({ useTabInfo, useDesktopBrowser, desktopSessionId }: Props): ReactNode {
  const { tab } = useTabInfo()
  const params = tab.navigation.params
  const nativeTabId = params !== undefined && 'nativeTabId' in params ? params.nativeTabId : undefined
  const tabId = desktopTabId(desktopSessionId, tab.id, nativeTabId)
  const title = useDesktopBrowser(state => state[tabId]?.title)
  return <><IconGlobeOutline14 className={css.titleIcon} />{title || tab.title}</>
}
