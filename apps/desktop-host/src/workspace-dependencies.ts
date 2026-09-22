/** Desktop tool exposing bundled interpreters without modifying command resolution. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { installPrimaryRuntime, readPrimaryRuntime, workspaceDependencyPaths, type WorkspaceDependencies } from './primary-runtime.ts'
import type {} from './optional-components-plugin.ts'

export const name = 'desktop-workspace-dependencies'
export const inject = ['tools']

/** Application-selected payload and installation directories. */
export interface Config {
  readonly source: string
  readonly root: string
}

/**
 * Register the read-only path query, preparing bundled files on its first invocation.
 * @param ctx - Desktop tool registry owner.
 * @param config - Application payload and fixed installation paths.
 */
export function apply(ctx: Context, config: Config): void {
  let installation: Promise<WorkspaceDependencies> | undefined
  ctx.effect(() => async () => {
    // Tool execution reports installation failures; disposal only waits for filesystem work to settle.
    await installation?.catch(() => undefined)
  })
  ctx.tools.register(defineTool({
    name: 'load_workspace_dependencies',
    description: 'Get absolute paths to bundled Node.js and pnpm, and to Python/document libraries when the optional Documents & data component is installed. If documents.state is absent, ask the user to install it in Settings > Optional tools before tasks that require its Python libraries; do not invent interpreter paths or install it without their choice. Coding works without this component. Run pnpm with the returned Node executable and pnpm script path. This does not change PATH or package-manager settings.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          python: { type: 'string' },
          node: { type: 'string', required: true },
          pnpm: { type: 'string', required: true },
          pythonPackages: { type: 'string' },
          nodePackages: { type: 'string', required: true },
          pythonDistributions: { type: 'object', additionalProperties: true, description: 'Bundled distribution names and versions recorded in runtime.json; excludes user-installed additions.' },
          documents: { type: 'object', additionalProperties: true, description: 'Optional Documents & data availability and installation guidance.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, undefined, 2) }],
    },
    execute: async () => {
      const metadata: unknown = JSON.parse(await readFile(join(config.source, 'runtime.json'), 'utf8'))
      if (typeof metadata === 'object' && metadata !== null && 'kind' in metadata && metadata.kind === 'core') {
        const dependencies = join(config.source, 'dependencies')
        const node = join(dependencies, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
        const pnpm = join(dependencies, 'pnpm', 'bin', 'pnpm.mjs')
        await Promise.all([stat(node), stat(pnpm)])
        const base = { node, pnpm, nodePackages: join(dependencies, 'node', 'node_modules') }
        const documents = ctx.get('strugendComponents')?.installedPath('documents')
        if (!documents) return { ...base, documents: { state: 'absent', action: 'Install Documents & data in Settings > Optional tools when needed.' } }
        const root = join(documents, 'primary-runtime')
        const paths = workspaceDependencyPaths(root, await readPrimaryRuntime(root))
        await Promise.all([stat(paths.python), stat(paths.pythonPackages)])
        return { ...base, python: paths.python, pythonPackages: paths.pythonPackages,
          pythonDistributions: paths.pythonDistributions, documents: { state: 'installed' } }
      }
      installation ??= installPrimaryRuntime(config.source, config.root).catch((error: unknown) => {
        installation = undefined
        throw error
      })
      return installation
    },
    presentCall: () => ({ card: 'generic', title: 'Load workspace dependencies', kind: 'read' }),
  }))
}
