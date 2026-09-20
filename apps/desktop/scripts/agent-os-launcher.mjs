/** Create a Finder-launchable development app that uses this built checkout. */
import { mkdir, writeFile, chmod, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentOsLaunchCommand } from './agent-os-launch-command.mjs'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repository = resolve(appRoot, '../..')
const electron = createRequire(import.meta.url)('electron')
for (const path of [
  join(appRoot, 'lib/main.js'),
  join(repository, 'apps/desktop-host/lib/index.js'),
  join(appRoot, '.desktop-build/development/project/desktop-runtime.json'),
]) {
  if (!existsSync(path))
    throw new Error(`Build and start the desktop once before creating its launcher. Missing: ${path}`)
}
const destination = join(repository, 'dist', 'Strugend Harness.app', 'Contents')
await mkdir(join(destination, 'MacOS'), { recursive: true })
await mkdir(join(destination, 'Resources'), { recursive: true })
await copyFile(join(appRoot, 'resources/strugend/icon.icns'), join(destination, 'Resources/AgentOS.icns'))
const script = agentOsLaunchCommand(electron, appRoot)
const executable = join(destination, 'MacOS', 'AgentOS')
await writeFile(executable, script)
await chmod(executable, 0o755)
await writeFile(
  join(destination, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.agent-os.local</string>
<key>CFBundleName</key><string>Strugend Harness</string>
<key>CFBundleDisplayName</key><string>Strugend Harness</string>
<key>CFBundleExecutable</key><string>AgentOS</string>
<key>CFBundleIconFile</key><string>AgentOS.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
)
console.log(`Local development app: ${resolve(destination, '..')}`)
