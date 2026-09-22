/** Native archive installation uses the exact release artifacts, without a model request. */
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, totalmem } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { ComponentManager, parseComponentCatalog, type ComponentId } from '../src/optional-components.ts'

const execute = promisify(execFile)
const enabled = process.env.STRUGEND_COMPONENT_TEST === '1'

it.skipIf(!enabled)('downloads and installs the native decision and document archives through the shipping manager', async () => {
  const buildRoot = resolve(process.env.LAYA_PACKAGED_ROOT ?? `apps/desktop/.desktop-build/targets/${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`)
  const packaged = parseComponentCatalog(JSON.parse(await readFile(join(buildRoot, 'runtime', 'component-catalog.json'), 'utf8')))
  const root = await mkdtemp(join(tmpdir(), 'strugend-native-components-'))
  const server = createServer((request, response) => {
    const artifact = packaged.find(item => `/${basename(new URL(item.url).pathname)}` === request.url)
    if (!artifact) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'content-length': artifact.downloadBytes })
    createReadStream(join(buildRoot, 'component-artifacts', basename(new URL(artifact.url).pathname))).pipe(response)
  })
  let manager: ComponentManager | undefined
  try {
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Native component fixture listener is unavailable.')
    const catalog = join(root, 'catalog.json')
    await writeFile(catalog, JSON.stringify({ schemaVersion: 1, components: packaged.map(artifact => ({ ...artifact,
      url: `http://127.0.0.1:${address.port}/${basename(new URL(artifact.url).pathname)}` })) }))
    manager = new ComponentManager({ root: join(root, 'installed'), catalog, idleTimeoutMs: 30_000,
      minimumDecisionMemoryMiB: 8192, totalMemoryMiB: totalmem() / 1024 ** 2, platform: process.platform, arch: process.arch })
    await manager.initialize()
    expect(manager.list().every(component => component.state === 'absent' || component.state === 'incompatible')).toBe(true)
    const install = async (id: ComponentId): Promise<string> => {
      const completion = new Promise<void>((resolve, reject) => {
        const off = manager!.onChange((changed) => {
          if (changed !== id) return
          const status = manager!.list().find(component => component.id === id)!
          if (status.state === 'installed') { off(); resolve() }
          if (status.state === 'failed') { off(); reject(new Error(status.error)) }
        })
      })
      manager!.install(id); await completion
      return manager!.installedPath(id)!
    }
    if (totalmem() >= 8192 * 1024 ** 2) {
      const decision = await realpath(await install('decision'))
      const sdk = createRequire(join(decision, 'package.json')).resolve('@receptron/laya')
      expect(sdk.startsWith(decision)).toBe(true)
      expect(createRequire(sdk).resolve('onnxruntime-node').startsWith(decision)).toBe(true)
      expect((await stat(join(decision, 'model', 'laya.onnx'))).isFile()).toBe(true)
    }
    const documents = await install('documents')
    const python = join(documents, 'primary-runtime', 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3')
    const inputPath = join(root, 'component-check.docx'), outputPath = join(root, 'component-check.pdf')
    const result = await execute(python, ['-c', 'import sys, numpy, pandas, docx, pptx, openpyxl; document = docx.Document(); document.add_paragraph("Optional component check"); document.save(sys.argv[1]); print(numpy.add(20, 22))', inputPath], { timeout: 30_000 })
    expect(result.stdout.trim()).toBe('42')
    const kit = await import(pathToFileURL(join(documents, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')).href) as typeof import('@deepseek-ai/libreoffice-kit')
    const converter = await kit.createConverter()
    try {
      await converter.render({ inputPath, outputPath })
      expect((await readFile(outputPath)).subarray(0, 5).toString()).toBe('%PDF-')
    } finally { await converter.dispose() }
    await manager.remove('documents')
    expect(manager.installedPath('documents')).toBeUndefined()
  } finally {
    await manager?.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)
