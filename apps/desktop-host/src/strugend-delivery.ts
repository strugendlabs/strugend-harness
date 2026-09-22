/** Resumable delivery of a verified commit to GitHub/Vercel, or local app artifacts. */
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { deliveryHttp, type DeliveryHttpConfig } from './strugend-delivery-http.ts'
import { decisionEvidence } from './strugend-decision.ts'

/** One planned delivery, with explicit verification and platform-specific build commands. */
export interface DeliverySpec {
  kind: 'website' | 'app'
  directory: string
  buildCommand: string
  checks: string[]
  repositoryName: string
  githubOwner?: string
  vercelTeam?: string
  framework?: string
  outputDirectory?: string
  artifacts: string[]
  production: boolean
}
/** A verified file offered to the user after an app build. */
export interface DeliveryArtifact { path: string; sha256: string; size: number }
/** Durable workflow state. Provider IDs are persisted before waiting for subsequent milestones. */
export interface DeliveryRun {
  version: 1
  id: string
  spec: DeliverySpec
  phase: 'ready' | 'verifying' | 'connecting' | 'publishing' | 'deploying' | 'complete' | 'needs-input' | 'failed' | 'cancelled'
  commit?: string
  repository?: { name: string; url: string; cloneUrl: string }
  deployment?: { id: string; url: string }
  projectId?: string
  artifacts: DeliveryArtifact[]
  log: string[]
  error?: string
  connection?: 'github' | 'vercel'
}
/** Dependencies are scoped to one task; process execution retains its sandbox and cancellation. */
export interface DeliveryRuntime {
  root: string
  workspace: string
  http: DeliveryHttpConfig
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  deploymentTimeoutMs: number
  pollMs: number
  run(command: string, cwd: string, signal: AbortSignal): Promise<string>
  push(url: string, commit: string, key: string, cwd: string, signal: AbortSignal): Promise<void>
  key(provider: 'github' | 'vercel'): Promise<string | undefined>
  decision(state: string, signal: AbortSignal): Promise<void>
  changed(run: DeliveryRun): void
}

/** Subprocess environment for fixed Git operations; credentials enter only through private per-process settings. */
export function deliveryEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sensitive = /KEY|SECRET|TOKEN|PASSWORD|^GIT_|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^BASH_ENV$|^ENV$/iu
  return Object.fromEntries(Object.entries(source).filter(([name]) => !sensitive.test(name)))
}

/**
 * Run a fixed git/gh argv with a bounded buffer and a quiescent abort.
 * @param command - Executable selected by the implementation.
 * @param args - Shell-free arguments.
 * @param cwd - Task directory.
 * @param signal - Operation cancellation.
 * @param extraEnv - Private git authentication configuration for this process only.
 * @returns Complete stdout. Failure diagnostics omit argv and credentials.
 */
export function deliveryCommand(
  command: string, args: string[], cwd: string, signal: AbortSignal, extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let output = '', failed = false
    const child = execFile(command, args, { cwd, signal, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      env: { ...deliveryEnvironment(process.env), ...extraEnv }, encoding: 'utf8',
    }, (error, stdout) => {
      failed = error !== null
      output = stdout
    })
    child.once('close', () => {
      if (failed || signal.aborted) { reject(new Error(signal.aborted ? 'Delivery cancelled.' : `${command} operation failed. Check the repository, installed tools, and account permissions.`)); return }
      resolvePromise(output)
    })
  })
}

function jsonRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }

/** Validate a model-supplied delivery recipe and restored state before any execution. */
export function deliverySpec(value: unknown): DeliverySpec {
  if (!jsonRecord(value) || !['website', 'app'].includes(String(value.kind)) || typeof value.directory !== 'string'
    || typeof value.buildCommand !== 'string' || !value.buildCommand.trim() || value.buildCommand.length > 10_000
    || !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 12 || !value.checks.every(x => typeof x === 'string' && x.trim() && x.length < 10_000)
    || typeof value.repositoryName !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,80}$/u.test(value.repositoryName)
    || !Array.isArray(value.artifacts) || value.artifacts.length > 20 || !value.artifacts.every(x => typeof x === 'string' && x.length > 0)
    || typeof value.production !== 'boolean') throw new Error('Provide an app/website recipe with a directory, build command, at least one verification command, repository name, artifact paths and production choice.')
  for (const field of ['githubOwner', 'vercelTeam', 'framework', 'outputDirectory'])
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > 200)) throw new Error(`Invalid delivery ${field}.`)
  if (value.kind === 'app' && value.artifacts.length === 0) throw new Error('Specify the distributable files expected from the app build.')
  return value as unknown as DeliverySpec
}

function field(value: Record<string, JsonValue>, key: string): string {
  if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Delivery provider omitted ${key}.`)
  return value[key]
}

/** Paths and credential patterns excluded from every uploaded source manifest. */
export function assertPublishable(path: string, bytes: Buffer): void {
  if (/(^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|\.git|\.npmrc|\.pypirc|[^/]+\.(?:pem|key|p12|pfx))$/iu.test(path)
    || /\b(?:imp-rt-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(bytes.toString('utf8')))
    throw new Error(`Remove credentials or private configuration from the committed upload: ${path}`)
}

/** One session-owned durable delivery with serialized execution and retryable milestones. */
export class DeliveryCoordinator {
  private active: Promise<DeliveryRun> | undefined
  private controller: AbortController | undefined
  constructor(private readonly runtime: DeliveryRuntime) {}

  /** @returns The latest validated saved run, or undefined before any delivery. */
  async read(): Promise<DeliveryRun | undefined> {
    let text: string
    try { text = await readFile(join(this.runtime.root, 'run.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    const value: unknown = JSON.parse(text)
    if (!jsonRecord(value) || value.version !== 1 || typeof value.id !== 'string' || !/^[\w-]{1,80}$/u.test(value.id)
      || !['ready', 'verifying', 'connecting', 'publishing', 'deploying', 'complete', 'needs-input', 'failed', 'cancelled'].includes(String(value.phase))
      || !Array.isArray(value.log) || !value.log.every(x => typeof x === 'string') || !Array.isArray(value.artifacts)) throw new Error('Saved delivery is invalid.')
    deliverySpec(value.spec)
    if (value.projectId !== undefined && typeof value.projectId !== 'string') throw new Error('Saved project is invalid.')
    if (!value.artifacts.every(item => jsonRecord(item) && typeof item.path === 'string' && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(item.sha256) && Number.isSafeInteger(item.size) && Number(item.size) > 0)) throw new Error('Saved artifacts are invalid.')
    if (value.commit !== undefined && (typeof value.commit !== 'string' || !/^[a-f0-9]{40,64}$/u.test(value.commit))) throw new Error('Saved commit is invalid.')
    for (const key of ['repository', 'deployment']) {
      const item = value[key]
      if (item !== undefined && (!jsonRecord(item) || (key === 'repository' ? ['name', 'url', 'cloneUrl'] : ['id', 'url']).some(field => typeof item[field] !== 'string' || !item[field]))) throw new Error('Saved delivery receipt is invalid.')
    }
    return value as unknown as DeliveryRun
  }

  /**
   * Start or resume one delivery. Concurrent callers share the same operation.
   * @param spec - New recipe; omitted resumes the saved recipe.
   * @param signal - Plugin/job lifetime, independent of the returned tool call.
   * @returns Final completed, failed, or needs-input receipt.
   */
  execute(spec: DeliverySpec | undefined, signal: AbortSignal): Promise<DeliveryRun> {
    if (this.active) return this.active
    this.controller = new AbortController()
    const combined = AbortSignal.any([signal, this.controller.signal])
    const task = this.perform(spec, combined)
    this.active = task
    void task.finally(() => { if (this.active === task) { this.active = undefined; this.controller = undefined } }).catch(() => undefined)
    return task
  }

  /** Stop active work; execute settles only after owned requests/processes stop. */
  cancel(): void { this.controller?.abort(new Error('Delivery cancelled.')) }
  /** Cancel and await the active operation before disposing its owner. */
  async dispose(): Promise<void> { this.cancel(); await this.active }

  private async save(run: DeliveryRun): Promise<void> {
    await mkdir(this.runtime.root, { recursive: true, mode: 0o700 })
    const tmp = join(this.runtime.root, randomUUID() + '.tmp')
    await writeFile(tmp, JSON.stringify(run) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(tmp, join(this.runtime.root, 'run.json'))
    this.runtime.changed(structuredClone(run))
  }

  private async directory(spec: DeliverySpec): Promise<string> {
    const root = await realpath(this.runtime.workspace)
    const target = await realpath(resolve(root, spec.directory))
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Delivery directory must belong to this task’s workspace.')
    return target
  }

  private async sources(cwd: string, commit: string, signal: AbortSignal): Promise<Array<{ file: string; data: Buffer }>> {
    const rows = (await deliveryCommand('git', ['ls-tree', '-rz', '--full-tree', commit], cwd, signal)).split('\0').filter(Boolean)
    if (rows.length > this.runtime.maxFiles) throw new Error('Source manifest exceeds the delivery file limit.')
    const files: Array<{ file: string; data: Buffer }> = []; let total = 0
    for (const row of rows) {
      const at = row.indexOf('\t'), file = row.slice(at + 1), mode = row.slice(0, 6)
      if (at < 0 || !['100644', '100755'].includes(mode) || !file || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Delivery needs regular committed files; symlinks and submodules require an explicit export.')
      const blob = row.slice(12, at)
      if (!/^[a-f0-9]{40,64}$/u.test(blob)) throw new Error('Invalid committed source blob.')
      const size = Number((await deliveryCommand('git', ['cat-file', '-s', blob], cwd, signal)).trim())
      if (size > this.runtime.maxFileBytes || total + size > this.runtime.maxTotalBytes) throw new Error('Source upload exceeds the delivery byte limit.')
      const data = await new Promise<Buffer>((resolveBytes, reject) => {
        execFile('git', ['cat-file', 'blob', blob], { cwd, signal, encoding: 'buffer', timeout: 30_000, maxBuffer: this.runtime.maxFileBytes, env: deliveryEnvironment(process.env) }, (error, bytes) => {
          if (error) reject(new Error('Unable to read the committed source.'))
          else resolveBytes(bytes)
        })
      }); total += data.length
      if (data.length > this.runtime.maxFileBytes || total > this.runtime.maxTotalBytes) throw new Error('Source upload exceeds the delivery byte limit.')
      assertPublishable(file, data)
      files.push({ file, data })
    }
    return files
  }

  private async cleanCommit(cwd: string, signal: AbortSignal): Promise<string> {
    const root = (await deliveryCommand('git', ['rev-parse', '--show-toplevel'], cwd, signal)).trim()
    if (await realpath(root) !== cwd) throw new Error('Delivery must start at the project repository root.')
    const status = await deliveryCommand('git', ['status', '--porcelain', '--untracked-files=normal'], cwd, signal)
    if (status.trim()) throw new Error('Commit task-owned source files and ignore generated output before delivery. Uncommitted changes are never uploaded.')
    const commit = (await deliveryCommand('git', ['rev-parse', 'HEAD'], cwd, signal)).trim()
    if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw new Error('Commit the project before delivery.')
    return commit
  }

  private async perform(input: DeliverySpec | undefined, signal: AbortSignal): Promise<DeliveryRun> {
    const saved = await this.read()
    const recipe = input ? deliverySpec(input) : saved?.spec
    if (!recipe) throw new Error('There is no saved delivery. Start with a recipe.')
    const sameDestination = saved && ['kind', 'directory', 'repositoryName', 'githubOwner'].every(key =>
      saved.spec[key as keyof DeliverySpec] === (key === 'githubOwner' && !recipe.githubOwner ? saved.spec.githubOwner : recipe[key as keyof DeliverySpec]))
    if (saved && !sameDestination && saved.phase !== 'complete' && saved.phase !== 'cancelled')
      throw new Error('Cancel this delivery before changing its destination.')
    if (saved?.repository && sameDestination && saved.spec.vercelTeam && recipe.vercelTeam && saved.spec.vercelTeam !== recipe.vercelTeam)
      throw new Error('A delivery already attached to a team cannot move teams.')
    const resume = saved && sameDestination && (saved.phase !== 'complete' || !input)
    const run: DeliveryRun = resume ? saved : {
      version: 1, id: randomUUID(), spec: recipe, phase: 'ready', artifacts: [], log: [],
      ...(sameDestination && saved.repository ? { repository: saved.repository } : {}),
      ...(sameDestination && saved.projectId ? { projectId: saved.projectId } : {}),
    }
    if (!input && run.phase === 'complete') return run
    run.spec = { ...recipe, ...(sameDestination && saved.spec.vercelTeam ? { vercelTeam: saved.spec.vercelTeam } : {}) }
    delete run.error; delete run.connection
    const advance = async (phase: DeliveryRun['phase'], message: string): Promise<void> => {
      run.phase = phase; run.log.push(message); run.log = run.log.slice(-60); await this.save(run)
    }
    try {
      signal.throwIfAborted()
      const cwd = await this.directory(run.spec)
      await advance('verifying', 'Building and checking the project.')
      const before = run.spec.kind === 'website' ? await this.cleanCommit(cwd, signal) : undefined
      for (const command of [run.spec.buildCommand, ...run.spec.checks]) {
        const output = await this.runtime.run(command, cwd, signal)
        run.log.push(decisionEvidence(output, 1800)); await this.save(run)
      }
      if (run.spec.kind === 'app') {
        run.artifacts = []
        for (const path of run.spec.artifacts) {
          const absolute = await realpath(resolve(cwd, path)); const rel = relative(cwd, absolute)
          if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Build artifacts must remain in the project directory.')
          const info = await stat(absolute)
          if (!info.isFile() || info.size === 0) throw new Error('The build did not produce a nonempty distributable file.')
          const { createReadStream } = await import('node:fs')
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(absolute, { signal })) hash.update(chunk as Buffer)
          run.artifacts.push({ path: absolute, sha256: hash.digest('hex'), size: info.size })
        }
        await this.runtime.decision(JSON.stringify({ kind: 'app', checks: run.log, artifacts: run.artifacts }), signal)
        await advance('complete', 'Build checks passed and distributable files were verified.')
        return run
      }
      const commit = await this.cleanCommit(cwd, signal)
      if (commit !== before) throw new Error('Source changed during verification. Run delivery again on the new commit.')
      if (run.commit && run.commit !== commit) {
        run.id = randomUUID(); delete run.deployment
      }
      run.commit = commit
      const sources = await this.sources(cwd, commit, signal)
      await this.runtime.decision(JSON.stringify({ kind: 'website', commit, files: sources.map(x => x.file).slice(0, 30), checks: run.log }), signal)
      await advance('connecting', 'Checking GitHub and Vercel access.')
      const github = await this.runtime.key('github')
      if (!github) { run.connection = 'github'; throw new Error('Connect GitHub in Settings → Connections, then resume this delivery.') }
      const vercel = await this.runtime.key('vercel')
      if (!vercel) { run.connection = 'vercel'; throw new Error('Connect Vercel in Settings → Connections, then resume this delivery.') }
      const request = (provider: 'github' | 'vercel', path: string, method: 'GET' | 'POST', body?: JsonValue | Uint8Array) =>
        deliveryHttp(provider === 'github' ? this.runtime.http.githubUrl : this.runtime.http.vercelUrl, path, provider === 'github' ? github : vercel, method, body, this.runtime.http, signal)
      const user = await request('github', '/user', 'GET')
      const login = field(user, 'login'), owner = run.spec.githubOwner || login
      run.spec.githubOwner = owner
      if (!/^[\w-]+$/u.test(owner)) throw new Error('Choose a valid GitHub owner.')
      if (!run.spec.vercelTeam) {
        const teams = await request('vercel', '/v2/teams', 'GET')
        if (!Array.isArray(teams.teams)) throw new Error('Vercel did not return account teams.')
        if (teams.teams.length !== 1) { run.connection = 'vercel'; throw new Error('Select a Vercel team ID in the delivery recipe, then resume.') }
        const team = teams.teams[0]
        if (!team || typeof team !== 'object' || Array.isArray(team)) throw new Error('Invalid Vercel team.')
        run.spec.vercelTeam = field(team, 'id'); await this.save(run)
      }
      const teamQuery = '?teamId=' + encodeURIComponent(run.spec.vercelTeam)
      await advance('publishing', 'Publishing the verified commit to a private GitHub repository.')
      if (!run.repository) {
        const marker = `Created by Strugend delivery ${run.id}`
        let repo: Record<string, JsonValue>
        try { repo = await request('github', `/repos/${owner}/${run.spec.repositoryName}`, 'GET') }
        catch (error) {
          if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error
          repo = await request('github', owner === login ? '/user/repos' : `/orgs/${owner}/repos`, 'POST', { name: run.spec.repositoryName, private: true, description: marker })
        }
        if (repo.description !== marker) throw new Error('This repository name already exists. Choose another name; existing repositories are never adopted automatically.')
        if (repo.private !== true || repo.full_name !== `${owner}/${run.spec.repositoryName}`) throw new Error('GitHub did not confirm the requested private repository.')
        run.repository = { name: field(repo, 'full_name'), url: field(repo, 'html_url'), cloneUrl: field(repo, 'clone_url') }
        await this.save(run)
      }
      const clone = new URL(run.repository.cloneUrl)
      if (clone.protocol !== 'https:' || clone.hostname !== 'github.com' || clone.username || clone.password || clone.search || clone.hash) throw new Error('GitHub returned an invalid clone address.')
      await this.runtime.push(run.repository.cloneUrl, commit, github, cwd, signal)
      await advance('deploying', 'Publishing to Vercel and waiting for the build.')
      if (!run.deployment) {
        // Reconcile an ambiguous create response before considering another deployment.
        const prior = await request('vercel', `/v6/deployments${teamQuery}&meta-strugendRun=${encodeURIComponent(run.id)}`, 'GET')
        const matching = Array.isArray(prior.deployments) ? prior.deployments.find(item => item && typeof item === 'object' && !Array.isArray(item) && item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) && item.meta.strugendRun === run.id && item.meta.strugendCommit === commit) : undefined
        let deployed: Record<string, JsonValue>
        if (matching && typeof matching === 'object' && !Array.isArray(matching)) deployed = matching
        else {
          const files = []
          for (const source of sources) {
            const sha = createHash('sha1').update(source.data).digest('hex')
            await request('vercel', '/v2/files' + teamQuery, 'POST', source.data)
            files.push({ file: source.file, sha, size: source.data.length })
          }
          deployed = await request('vercel', '/v13/deployments' + teamQuery, 'POST', {
            name: run.spec.repositoryName.toLowerCase().replaceAll('_', '-'), files,
            ...(run.projectId ? { project: run.projectId } : {}),
            ...(run.spec.production ? { target: 'production' } : {}),
            projectSettings: {
              framework: run.spec.framework ?? null, ...(run.spec.outputDirectory ? { outputDirectory: run.spec.outputDirectory } : {}) },
            meta: { strugendRun: run.id, strugendCommit: commit, strugendRepository: run.repository.name },
          })
        }
        if (typeof deployed.projectId === 'string') run.projectId = deployed.projectId
        run.deployment = { id: typeof deployed.id === 'string' ? deployed.id : field(deployed, 'uid'), url: 'https://' + field(deployed, 'url') }
        await this.save(run)
      }
      const deadline = Date.now() + this.runtime.deploymentTimeoutMs
      for (;;) {
        signal.throwIfAborted()
        const deployed = await request('vercel', '/v13/deployments/' + encodeURIComponent(run.deployment.id) + teamQuery, 'GET')
        const state = deployed.readyState ?? deployed.status
        if (state === 'READY') break
        if (state === 'ERROR' || state === 'CANCELED') throw new Error('Vercel build failed. Inspect the deployment logs, fix the source, then start a new delivery.')
        if (Date.now() >= deadline) throw new Error('Vercel is still building. Resume to continue checking this deployment.')
        await delay(this.runtime.pollMs, undefined, { signal })
      }
      const publicUrl = new URL(run.deployment.url)
      if (publicUrl.protocol !== 'https:' || !publicUrl.hostname.endsWith('.vercel.app')) throw new Error('Unexpected deployment URL.')
      const page = await fetch(publicUrl, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(this.runtime.http.timeoutMs)]) })
      await page.body?.cancel()
      if (!page.ok) throw new Error(`Deployment is ready but public access returned HTTP ${page.status}. Check deployment protection and inspect the site before claiming completion.`)
      await advance('complete', 'Verified commit published; Vercel is ready and publicly reachable. Inspect the live site in the sidebar before the final response.')
    } catch (error) {
      run.error = decisionEvidence(error instanceof Error ? error.message : 'Delivery failed.')
      await advance(signal.aborted ? 'cancelled' : run.connection ? 'needs-input' : 'failed', run.error)
    }
    return run
  }
}
