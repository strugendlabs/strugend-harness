/** Finder must not revive the mock provider environment of a previous QA process. */
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { agentOsLaunchCommand } from '../scripts/agent-os-launch-command.mjs'
import { agentOsIdentity } from '../src/agentos-identity.ts'

it('launches the normal app without inheriting a local provider, fake key, or temporary home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-os-launch-'))
  try {
    const binary = join(root, "Electron's binary")
    const launcher = join(root, 'launch.zsh')
    const appRoot = join(root, "Agent OS's app")
    await writeFile(binary, '#!/bin/sh\nprintf "%s\\n" "$DEEPSEEK_BASE_URL" "$DEEPSEEK_API_KEY" "$DSH_HOME" "$ELECTRON_RUN_AS_NODE" "$DSH_DESKTOP_HOST_PORT" "$AGENT_OS_TEST_MODE" "$DSH_DESKTOP_OPEN_DEVTOOLS" "$@"\n', { mode: 0o700 })
    // Substitute only macOS LaunchServices; run the generated environment cleanup in a real shell.
    await writeFile(launcher, agentOsLaunchCommand(binary, appRoot)
      .replace('exec /usr/bin/open', `exec '${binary.replaceAll("'", "'\\''")}'`))
    const { stdout } = await promisify(execFile)('/bin/zsh', [launcher, 'argument with spaces'], {
      env: {
        PATH: '/usr/bin:/bin', DEEPSEEK_BASE_URL: 'http://127.0.0.1:59270/v1',
        DEEPSEEK_API_KEY: 'local-test-only', DSH_HOME: '/tmp/qa-profile', ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_HOST_PORT: '0', AGENT_OS_TEST_MODE: '1',
      },
    })
    expect(stdout.split('\n')).toEqual(['', '', '', '', '', '', '0', '-n', '-a', resolve(binary, '../../..'),
      '--env', 'DSH_DESKTOP_OPEN_DEVTOOLS=0', '--env', 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      '--args', appRoot, 'argument with spaces', ''])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.each(['http://127.0.0.1:59270/v1', 'http://localhost:1234/v1', 'http://[::1]:1234/v1'])(
  'labels an explicit local provider: %s', (endpoint) => {
    expect(agentOsIdentity(endpoint)).toEqual({ name: 'Strugend Harness (Local API)', badge: 'LOCAL' })
  },
)

it.each([undefined, 'https://api.deepseek.com', 'https://api.deepseek.com/anthropic', 'invalid'])('keeps the normal app identity: %s', (endpoint) => {
  expect(agentOsIdentity(endpoint)).toEqual({ name: 'Strugend Harness', badge: '' })
})
