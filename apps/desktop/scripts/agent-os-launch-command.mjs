/** Finder launches use the normal profile and saved credentials, never a QA process environment. */
import { resolve } from 'node:path'

export function agentOsLaunchCommand(electron, appRoot) {
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  return `#!/bin/zsh
# Local development launcher: keep the Agent OS checkout in place.
unset ELECTRON_RUN_AS_NODE DEEPSEEK_BASE_URL DEEPSEEK_API_KEY DSH_HOME DSH_DESKTOP_HOST_PORT AGENT_OS_TEST_MODE
export DSH_DESKTOP_OPEN_DEVTOOLS=0
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
exec /usr/bin/open -n -a ${quote(resolve(electron, '../../..'))} --env DSH_DESKTOP_OPEN_DEVTOOLS=0 --env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin --args ${quote(appRoot)} "$@"
`
}
