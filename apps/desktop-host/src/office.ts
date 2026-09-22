/** Desktop Office skills and bundled authoring dependencies. */

import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import OfficeToPdf from '@deepseek-ai/dsh-office-to-pdf'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from './workspace-dependencies.ts'
import type {} from './optional-components-plugin.ts'
import { existsSync } from 'node:fs'

/** Loader identity for the application-owned Office composition. */
export const name = 'desktop-office'
/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled coding runtime directory; optional document assets load independently. */
  readonly source: string
  /** Harness-home directory where workspace dependencies are installed. */
  readonly root: string
}

/**
 * Enable offline Office authoring and structural checks in the Desktop profile.
 * @param ctx - Profile scope; child plugins declare their own service requirements.
 * @param config - Bundled payload source and Harness-home installation root.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config)
  const components = ctx.get('strugendComponents')
  const legacyAssets = join(dirname(config.source), 'office-skills')
  let mounted: ReturnType<Context['plugin']> | undefined
  let renderer: ReturnType<Context['plugin']> | undefined
  let activeRoot: string | undefined
  let update = Promise.resolve()
  const refresh = async () => {
    const installed = components?.installedPath('documents')
    if (activeRoot === installed && mounted) return
    await renderer?.dispose(); renderer = undefined
    await mounted?.dispose(); mounted = undefined
    activeRoot = installed
    if (installed) renderer = ctx.plugin(OfficeToPdf, { moduleRoot: installed, maxBackgroundConversions: 0 })
    const assetRoot = installed ? join(installed, 'office-skills') : !components && existsSync(legacyAssets) ? legacyAssets : undefined
    if (assetRoot) mounted = ctx.plugin(officeSkills, { assetRoot })
  }
  await refresh()
  if (components) ctx.effect(() => components.onBeforeRemove(async (id) => {
    if (id !== 'documents') return
    await update
    await renderer?.dispose(); renderer = undefined
    await mounted?.dispose(); mounted = undefined
    activeRoot = undefined
  }))
  if (components) ctx.effect(() => components.onChange((id) => {
    if (id === 'documents') update = update.then(refresh).catch((error: unknown) => { console.error('Optional document skills failed to load.', error) })
  }))
  ctx.effect(() => async () => { await update; await renderer?.dispose(); await mounted?.dispose() })
}
