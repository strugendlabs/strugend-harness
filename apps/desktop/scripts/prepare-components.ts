/** Assemble target-specific optional archives outside the core application resources. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { c as createTar } from 'tar'
import { prepareLaya } from './prepare-laya.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { selectOfficeEngine } from '../../../scripts/libreoffice-engine.ts'
import type { ComponentArtifact } from '../../desktop-host/src/optional-components.ts'

async function packageRoot(name: string, require: NodeJS.Require): Promise<string> {
  let root: string
  try { return dirname(require.resolve(`${name}/package.json`)) }
  catch (error) {
    if (!['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(String((error as NodeJS.ErrnoException).code))) throw error
    root = dirname(require.resolve(name))
  }
  while (true) {
    try { await readFile(join(root, 'package.json')); return root }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(root)
    if (parent === root) throw new Error(`Optional component package metadata is missing: ${name}`)
    root = parent
  }
}

async function copyPackages(
  names: string[], resolver: NodeJS.Require, destination: string, platform: NodeJS.Platform, arch: string,
): Promise<void> {
  const copied = new Map<string, string>()
  const visit = async (name: string, from: NodeJS.Require): Promise<void> => {
    const sourceName = name === 'onnxruntime-node' && platform === 'darwin' && arch === 'x64' ? 'onnxruntime-node-intel-mac' : name
    const source = await realpath(await packageRoot(sourceName, sourceName !== name ? resolver : from))
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
      version: string
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const version = copied.get(name)
    if (version) { if (version !== manifest.version) throw new Error(`Optional component has conflicting package versions: ${name}`); return }
    copied.set(name, manifest.version)
    const target = join(destination, 'node_modules', name)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, dereference: true, filter: (path) => {
      const entry = relative(source, path).replaceAll('\\', '/')
      if (entry.split('/').includes('node_modules') || /(?:\.map|\.d\.ts)$/u.test(entry)) return false
      if (name.startsWith('onnxruntime-node') && entry.startsWith('bin/napi-v6/')) {
        const [os, cpu] = entry.slice('bin/napi-v6/'.length).split('/')
        if (os && os !== platform || cpu && cpu !== arch) return false
      }
      return true
    } })
    const next = createRequire(join(source, 'package.json'))
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await visit(dependency, next)
    if (name === '@deepseek-ai/libreoffice-kit') {
      await visit(`@deepseek-ai/libreoffice-kit-${selectOfficeEngine(manifest, { platform, arch })}`, next)
    }
  }
  for (const name of names) await visit(name, resolver)
}

async function inventory(root: string): Promise<{ files: number; installedBytes: number }> {
  let files = 0, installedBytes = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) { const nested = await inventory(path); files += nested.files; installedBytes += nested.installedBytes }
    else if (entry.isFile()) { files++; installedBytes += (await stat(path)).size }
    else throw new Error('Optional component archives may contain only regular files and directories.')
  }
  return { files, installedBytes }
}

/** Build the separately downloadable packs and the catalog pinned into this release.
 * @returns After immutable checksums and target-specific archives are written.
 */
export async function prepareOptionalComponents(): Promise<void> {
  const target = resolveDesktopBuildTarget(), paths = resolveDesktopTargetBuildPaths()
  const platform = target === 'win-x64' ? 'win32' : 'darwin', arch = target === 'mac-arm64' ? 'arm64' : 'x64'
  const { version } = JSON.parse(await readFile(join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }
  const roots = join(paths.root, 'components'), output = join(paths.root, 'component-artifacts')
  await rm(roots, { recursive: true, force: true }); await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const decision = join(roots, 'decision'), documents = join(roots, 'documents')
  await prepareLaya(join(decision, 'model'))
  const hostRequire = createRequire(resolve(import.meta.dirname, '../../desktop-host/package.json'))
  await copyPackages(['@receptron/laya'], hostRequire, decision, platform, arch)
  await preparePrimaryRuntime({ documents: true, destination: join(documents, 'primary-runtime') })
  await rm(join(documents, 'primary-runtime', 'dependencies', 'node'), { recursive: true })
  await rm(join(documents, 'primary-runtime', 'dependencies', 'pnpm'), { recursive: true })
  const documentManifestPath = join(documents, 'primary-runtime', 'runtime.json')
  const documentManifest = JSON.parse(await readFile(documentManifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(documentManifestPath, JSON.stringify({ ...documentManifest, desktopVersion: '0.0.0' }, undefined, 2) + '\n')
  const webRequire = createRequire(resolve(import.meta.dirname, '../../../packages/bundle/web-app/package.json'))
  await copyPackages(['@deepseek-ai/libreoffice-kit'], webRequire, documents, platform, arch)
  const components: ComponentArtifact[] = []
  for (const id of ['decision', 'documents'] as const) {
    const root = join(roots, id)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: `strugend-component-${id}`, version: '1.0.0', private: true, type: 'module' }) + '\n')
    const filename = `strugend-${id}-${version}-${target}.tar.gz`
    const archive = join(output, filename)
    await createTar({ cwd: root, file: archive, gzip: true, portable: true, noMtime: true }, (await readdir(root)).sort())
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    const sha256 = hash.digest('hex')
    components.push({ id, version: `1.0.0-${sha256.slice(0, 16)}`, platform, arch, downloadBytes: (await stat(archive)).size, ...await inventory(root),
      sha256, url: `https://github.com/strugendlabs/strugend-harness/releases/download/strugend-v${version}/${filename}` })
  }
  await writeFile(join(paths.runtime, 'component-catalog.json'), JSON.stringify({ schemaVersion: 1, components }, undefined, 2) + '\n')
  await writeFile(join(output, `components-${target}.json`), JSON.stringify({ schemaVersion: 1, components }, undefined, 2) + '\n')
  console.log(JSON.stringify({
    optionalComponents: components.map(({ id, downloadBytes, installedBytes }) => ({ id, downloadBytes, installedBytes })),
  }))
}
