/** Generate updater metadata only after all native installers have qualified. */
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const [directory, version] = process.argv.slice(2)
if (!directory || !version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Pass artifact directory and release version.')
const installers = []
for (const target of ['win-x64', 'mac-arm64', 'mac-x64']) {
  const file = `strugend-harness-${version}-${target}.${target.startsWith('win') ? 'exe' : 'dmg'}`
  const path = join(directory, file), info = await stat(path)
  if (!info.isFile() || info.size < 1 || info.size > 400 * 1024 ** 2) throw new Error(`Invalid installer: ${file}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  installers.push({ target, file, bytes: info.size, sha256: hash.digest('hex') })
}
await writeFile(join(directory, 'strugend-update.json'), JSON.stringify({ version, installers }, null, 2) + '\n')
