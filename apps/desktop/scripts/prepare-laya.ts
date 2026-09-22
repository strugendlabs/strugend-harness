/** Stage the pinned offline Laya payload, using only verified build-cache files. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, copyFile, rename, rm, stat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { layaManifest, verifyLayaAssets } from '../../desktop-host/src/strugend-laya-assets.ts'

/**
 * Download immutable assets at build time and copy them into the offline desktop payload.
 * @param destination - Build-owned runtime/laya directory.
 * @param cache - Shared, verified download cache.
 * @returns After all hashes and the staged copy have been verified.
 */
export async function prepareLaya(destination: string, cache = resolve(import.meta.dirname, '../../../.artifacts/laya-model')): Promise<void> {
  for (const file of layaManifest.files) {
    const cached = join(cache, file.file)
    await mkdir(dirname(cached), { recursive: true })
    let valid = false
    try {
      if ((await stat(cached)).size === file.size) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(cached)) hash.update(chunk)
        valid = hash.digest('hex') === file.sha256
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!valid) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const temp = cached + '.' + randomUUID() + '.partial'
        try {
          const url = `https://huggingface.co/${layaManifest.repository}/resolve/${layaManifest.revision}/${file.source}`
          const response = await fetch(url, { signal: AbortSignal.timeout(900_000) })
          if (!response.ok || !response.body) throw new Error(`Laya download failed: HTTP ${response.status}`)
          let size = 0; const hash = createHash('sha256')
          const guard = new Transform({ transform(chunk: Buffer, _encoding, done) {
            size += chunk.length
            if (size > file.size) { done(new Error('Laya download exceeds pinned size.')); return }
            hash.update(chunk); done(null, chunk)
          } })
          await pipeline(Readable.from(response.body), guard, createWriteStream(temp, { flags: 'wx' }))
          if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('Laya download checksum mismatch.')
          await rename(temp, cached)
          break
        } catch (error) {
          if (attempt === 2) throw error
          await delay(1000 * (attempt + 1))
        } finally { await rm(temp, { force: true }) }
      }
    }
    const target = join(destination, file.file); await mkdir(dirname(target), { recursive: true }); await copyFile(cached, target)
  }
  for (const file of ['LICENSE', 'NOTICE', 'SDK-LICENSE']) await copyFile(join(import.meta.dirname, '../resources/laya', file), join(destination, file))
  await verifyLayaAssets(destination)
}
