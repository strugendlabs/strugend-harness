/** Pinned, offline model files shared by packaging and the inference worker. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import manifest from './laya-manifest.json' with { type: 'json' }

/** Exact multilingual model export, license and file digests shipped with the desktop. */
export const layaManifest = manifest

/**
 * Verify every model file before loading native inference code.
 * @param root - Offline model directory.
 * @param signal - Optional build/download cancellation.
 * @returns After every file has the pinned length and SHA-256 digest.
 */
export async function verifyLayaAssets(root: string, signal?: AbortSignal): Promise<void> {
  for (const file of manifest.files) {
    const path = join(root, file.file)
    const info = await stat(path)
    if (!info.isFile() || info.size !== file.size) throw new Error(`Local Laya file size mismatch: ${file.file}`)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer)
    if (hash.digest('hex') !== file.sha256) throw new Error(`Local Laya checksum mismatch: ${file.file}`)
  }
}
