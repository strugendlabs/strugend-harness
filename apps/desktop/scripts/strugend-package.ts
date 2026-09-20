/** Package an unsigned Strugend BYOK preview on its native build host. */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parseDesktopPackageInvocation } from './package-target.ts'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from './desktop-package-environment.mjs'

const root = resolve(import.meta.dirname, '../../..')
const appRoot = resolve(root, 'apps/desktop')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { version: { type: 'string' }, check: { type: 'boolean', default: false }, dir: { type: 'boolean', default: false } },
})
if (positionals.length !== 1 || !values.version) throw new Error('Usage: pnpm strugend:package <win-x64|mac-arm64|mac-x64> --version <confirmed-version> [--check] [--dir]')
const invocation = parseDesktopPackageInvocation([positionals[0]!, '--unsigned'])
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
if (manifest.version !== values.version) throw new Error('The confirmed preview version must match the repository manifests')
const platform = invocation.target.platform === 'win32' ? 'windows' : 'macos'
const template = readFileSync(resolve(appRoot, `.env.${platform}.strugend.example`), 'utf8')
try { writeFileSync(resolve(appRoot, `.env.${platform}`), template, { flag: 'wx', mode: 0o600 }) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
const environment = loadDesktopPackageEnvironment(invocation.target.platform)
if (environment.DSH_DESKTOP_DISTRIBUTION !== 'strugend-preview') {
  throw new Error(`Existing .env.${platform} selects another distribution; retain that file and configure the Strugend preview explicitly`)
}
validateDesktopPackageEnvironment(environment, invocation.target, invocation)
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('Invoke through pnpm strugend:package')
await new Promise<void>((accept, reject) => {
  const child = spawn(process.execPath, [pnpm, '--dir', 'apps/desktop', 'run', 'package', positionals[0]!, '--unsigned',
    ...(values.check ? ['--check'] : []), ...(values.dir ? ['--dir'] : [])], { cwd: root, stdio: 'inherit', env: process.env })
  child.once('error', reject)
  child.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`Preview packaging exited with ${String(signal ?? code)}`)))
})
