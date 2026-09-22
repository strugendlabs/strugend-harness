/** Authenticated optional-component operations and application-owned availability. */
import { totalmem } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { ComponentManager } from './optional-components.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional runtime installations owned by this Desktop Host. */
    strugendComponents: ComponentManager
  }
}

/** Desktop composition identity. */
export const name = 'strugend-components'
/** Component mutations are reachable only through the authenticated local application connection. */
export const inject = ['connection']
/** Application-provided paths and deployment download policy. */
export interface Config {
  readonly root: string
  readonly catalog: string
  readonly idleTimeoutMs: number
  readonly minimumDecisionMemoryMiB: number
}

/** Register optional components without initiating downloads.
 * @param ctx - Authenticated Desktop Host context.
 * @param config - Release catalog, storage root and resource limits.
 * @returns After installed markers are read and routes registered.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const manager = new ComponentManager({ ...config, platform: process.platform, arch: process.arch,
    totalMemoryMiB: totalmem() / 1024 ** 2 })
  await manager.initialize()
  const snapshot = () => ({ components: manager.list(), setupComplete: manager.setupComplete,
    localAllowed: totalmem() / 1024 ** 2 >= config.minimumDecisionMemoryMiB,
    localReason: totalmem() / 1024 ** 2 >= config.minimumDecisionMemoryMiB ? '' : 'Local decision support requires at least 8 GiB RAM. The main coding agent works independently.' })
  ctx.effect(() => ctx.reflect.provide('strugendComponents', manager))
  ctx.effect(() => () => manager.dispose())
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/strugend/components', methods: ['GET'], requestBody: 'buffered',
    fetch: () => Promise.resolve(Response.json(snapshot())),
  }))
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/strugend/components/setup', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body: unknown = await request.json()
      if (!body || typeof body !== 'object' || !('decision' in body) || !['install', 'skip'].includes(String(body.decision))) {
        return Response.json({ error: 'Choose install or skip.' }, { status: 400 })
      }
      try { await manager.setup(body.decision === 'install' ? 'install' : 'skip'); return Response.json(snapshot()) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Optional setup failed.' }, { status: 409 }) }
    },
  }))
  for (const id of ['decision', 'documents'] as const) for (const operation of ['install', 'cancel', 'remove'] as const) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/strugend/components/${id}/${operation}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async () => {
        try {
          if (operation === 'install') manager.install(id)
          else if (operation === 'cancel') await manager.cancel(id)
          else await manager.remove(id)
          return Response.json(snapshot())
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : 'Optional component operation failed.' }, { status: 409 })
        }
      },
    }))
  }
}
