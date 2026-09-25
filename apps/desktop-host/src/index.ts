/** Launch the Desktop profile through the Web application and report its URL to Electron. */

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as automations from './automations.ts'
import * as agentOsVision from './agentos-vision.ts'
import * as agentOsTools from './agentos-tools.ts'
import * as agentOsPersonalContext from './agentos-personal-context.ts'
import * as agentOsTeam from './agentos-team.ts'
import * as agentOsWorkflow from './agentos-workflow.ts'
import * as agentOsPower from './agentos-power.ts'
import * as strugendIntelligence from './strugend-intelligence.ts'
import { agentOsProfilePatch } from './agentos-profile.ts'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { desktopRequest } from './agentos-bridge.ts'
import { delimiter, join, dirname } from 'node:path'
import { loadLayeredEnv, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopOffice from './office.ts'
import * as optionalComponents from './optional-components-plugin.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  const overlay = join(resolveDshHome(), 'agent-os-desktop.patch.yml')
  const catalogPath = join(dirname(process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime')), 'component-catalog.json')
  await mkdir(resolveDshHome(), { recursive: true, mode: 0o700 })
  try { await writeFile(join(resolveDshHome(), 'settings.yaml'), JSON.stringify({ 'ui-theme': { preference: 'dark', fontSize: 14 } }), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await writeFile(overlay, JSON.stringify([...agentOsProfilePatch(
    fileURLToPath(new URL('./agentos-credentials.js', import.meta.url)), projectDir, process.env.DSH_PERMISSION_MODE,
  ), { id: 'office-to-pdf', disabled: true }]), { mode: 0o600 })
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolutionMode: process.argv[5] === 'runtime' ? 'runtime' : 'link',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [overlay],
    args: ['--no-open', '--port', process.env.DSH_DESKTOP_HOST_PORT ?? '19387'],
    ...(process.argv[6] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[6]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[7] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: { updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl> } = {}
  const send = (message: object): Promise<void> => new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) { resolve(); return }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
  })
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  await ctx.plugin(optionalComponents, {
    root: join(resolveDshHome(), 'strugend-components'),
    catalog: catalogPath,
    idleTimeoutMs: 60_000, minimumDecisionMemoryMiB: 8192,
  })
  await ctx.plugin(agentOsWorkflow)
  await ctx.plugin(agentOsTeam)
  await ctx.plugin(agentOsPower)
  await ctx.plugin(agentOsTools)
  await ctx.plugin(agentOsPersonalContext, agentOsPersonalContext.Config({ memoryChars: 4000, deadlineMs: 1500 }))
  await ctx.plugin(agentOsVision, agentOsVision.Config({ maxTokens: 4096, timeoutMs: 20000 }))
  await ctx.plugin(strugendIntelligence, strugendIntelligence.Config({ localModelDir: '' } as strugendIntelligence.Config))
  const skillRoot = await desktopRequest<string>({ method: 'skill-root' })
  await ctx.plugin(skillFilesystem, { providerName: 'agent-os-recordings', includeDefaultRoots: false, customSkillDirs: [skillRoot] })
  await ctx.plugin(automations, automations.Config({ root: join(resolveDshHome(), 'strugend-automations'), idlePollMs: 5000, clockCheckMs: 60000 }))
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  await ctx.plugin(desktopOffice, {
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  if (process.connected) process.send?.({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() }, (error) => { if (error !== null) console.error(error) })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (process.connected) process.send?.({ type: 'fatal', message }, (error) => { if (error !== null) console.error(error) })
    console.error(error)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
