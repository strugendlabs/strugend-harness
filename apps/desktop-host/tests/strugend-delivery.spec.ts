/** Real local repositories exercise delivery verification, restart receipts, and cancellation. */
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { DeliveryCoordinator, deliverySpec, assertPublishable, deliveryEnvironment, type DeliveryRuntime, type DeliverySpec } from '../src/strugend-delivery.ts'

const exec = promisify(execFile)
const app: DeliverySpec = { kind: 'app', directory: '.', buildCommand: 'build', checks: ['verify'], repositoryName: 'fixture-app', artifacts: ['app.zip'], production: false }
async function fixture(run: (root: string, runtime: DeliveryRuntime) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'strugend-delivery-'))
  const runtime: DeliveryRuntime = {
    root: join(root, '.state'), workspace: root,
    http: { githubUrl: 'https://api.github.com', vercelUrl: 'https://api.vercel.com', timeoutMs: 1000, maxBytes: 1024 },
    maxFiles: 100, maxFileBytes: 4096, maxTotalBytes: 8192, deploymentTimeoutMs: 1000, pollMs: 10,
    run: async () => { await writeFile(join(root, 'app.zip'), 'built artifact'); return 'Exit code: 0' },
    push: async () => {}, key: async () => undefined, decision: async () => {}, changed: () => {},
  }
  try { await run(root, runtime) } finally { await rm(root, { recursive: true, force: true }) }
}

it('verifies actual app artifacts and restores a completed receipt without rerunning the build', async () => fixture(async (root, runtime) => {
  const commands = vi.fn(runtime.run.bind(runtime)); runtime.run = commands
  const result = await new DeliveryCoordinator(runtime).execute(app, new AbortController().signal)
  expect(result.phase).toBe('complete'); expect(commands).toHaveBeenCalledTimes(2)
  expect(result.artifacts[0]).toEqual({ path: await realpath(join(root, 'app.zip')), size: 14, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) as string })
  expect(await new DeliveryCoordinator(runtime).execute(undefined, new AbortController().signal)).toEqual(result)
  expect(commands).toHaveBeenCalledTimes(2)
}))

it('does not claim delivery after a failed check or missing build output', async () => fixture(async (_root, runtime) => {
  runtime.run = async () => { throw new Error('Test exited 1') }
  expect((await new DeliveryCoordinator(runtime).execute(app, new AbortController().signal))).toMatchObject({ phase: 'failed', error: 'Test exited 1' })
  runtime.run = async () => 'Exit code: 0'
  const result = await new DeliveryCoordinator(runtime).execute(undefined, new AbortController().signal)
  expect(result.phase).toBe('failed'); expect(result.artifacts).toEqual([])
}))

it('verifies a clean website before asking for credentials and resumes the same durable operation', async () => fixture(async (root, runtime) => {
  for (const args of [['init'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'user.name', 'Fixture']]) await exec('git', args, { cwd: root })
  await writeFile(join(root, '.gitignore'), '.state/\n'); await writeFile(join(root, 'index.html'), '<h1>Fixture</h1>')
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'Fixture'], { cwd: root })
  runtime.run = async () => 'Checked the local build.'
  const spec = { ...app, kind: 'website' as const, artifacts: [], production: true }
  const first = await new DeliveryCoordinator(runtime).execute(spec, new AbortController().signal)
  expect(first).toMatchObject({ phase: 'needs-input', connection: 'github', commit: expect.stringMatching(/^[a-f0-9]{40}$/u) as string })
  const second = await new DeliveryCoordinator(runtime).execute(undefined, new AbortController().signal)
  expect(second.id).toBe(first.id); expect(second.phase).toBe('needs-input')
  await writeFile(join(root, 'index.html'), 'changed')
  const dirty = await new DeliveryCoordinator(runtime).execute(undefined, new AbortController().signal)
  expect(dirty.phase).toBe('failed'); expect(dirty.error).toContain('Uncommitted')
}))

it('joins concurrent callers and waits for the build cancellation before persisting cancellation', async () => fixture(async (_root, runtime) => {
  let arrived!: () => void
  const started = new Promise<void>((resolve) => { arrived = resolve })
  runtime.run = async (_command, _cwd, signal) => { arrived(); await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () =>{  reject(new Error('cancelled')) }, { once: true }) }); return '' }
  const coordinator = new DeliveryCoordinator(runtime)
  const first = coordinator.execute(app, new AbortController().signal)
  expect(coordinator.execute(app, new AbortController().signal)).toBe(first)
  await started; await coordinator.dispose()
  expect((await first).phase).toBe('cancelled')
  expect((await coordinator.read())?.phase).toBe('cancelled')
}))

it('refuses a corrupted receipt and paths outside the task workspace', async () => fixture(async (root, runtime) => {
  const coordinator = new DeliveryCoordinator(runtime)
  const result = await coordinator.execute({ ...app, directory: '..' }, new AbortController().signal)
  expect(result.phase).toBe('failed'); expect(result.error).toContain('workspace')
  const saved = JSON.parse(await readFile(join(runtime.root, 'run.json'), 'utf8')) as Record<string, unknown>; saved.repository = { unexpected: 'value' }
  await writeFile(join(runtime.root, 'run.json'), JSON.stringify(saved))
  await expect(coordinator.read()).rejects.toThrow('receipt')
  expect(root).not.toBe(runtime.root)
}))

it('rejects invalid recipes and excludes credential files and inherited provider keys', () => {
  expect(() => deliverySpec({ ...app, checks: [] })).toThrow('verification')
  expect(() => deliverySpec({ ...app, artifacts: [] })).toThrow('distributable')
  expect(() =>{  assertPublishable('.env', Buffer.from('private')) }).toThrow('credentials')
  expect(() =>{  assertPublishable('source.ts', Buffer.from('ghp_' + 'a'.repeat(30))) }).toThrow('credentials')
  expect(() =>{  assertPublishable('.env.example', Buffer.from('PORT=3000')) }).not.toThrow()
  expect(deliveryEnvironment({ PATH: '/bin', IMPOSSIBL_API_KEY: 'private', STRUGEND_VERCEL_TOKEN: 'private', GIT_CONFIG_COUNT: '1', BASH_ENV: '/tmp/inject' })).toEqual({ PATH: '/bin' })
})

it('uploads exactly the verified commit and recovers a lost deployment response without duplicates', async () => fixture(async (root, runtime) => {
  for (const args of [['init'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'user.name', 'Fixture']]) await exec('git', args, { cwd: root })
  await writeFile(join(root, '.gitignore'), '.state/\n'); await writeFile(join(root, 'index.html'), '<h1>Verified</h1>')
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'Fixture'], { cwd: root })
  runtime.run = async () => 'Exit code: 0'; runtime.key = async () => 'synthetic-token'
  const pushed = vi.fn(runtime.push.bind(runtime)); runtime.push = pushed
  let repository: Record<string, unknown> | undefined, deployment: Record<string, unknown> | undefined
  let creates = 0, uploads = 0
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString()), route = url.pathname
    if (url.hostname === 'fixture.vercel.app') return new Response('Verified')
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-token')
    if (route === '/user') return Response.json({ login: 'fixture' })
    if (route === '/v2/teams') return Response.json({ teams: [{ id: 'team-fixture' }] })
    if (route.startsWith('/repos/')) return repository ? Response.json(repository) : new Response('{}', { status: 404 })
    if (route === '/user/repos') {
      const body = JSON.parse(options?.body as string) as Record<string, unknown>; expect(body.private).toBe(true)
      repository = { ...body, full_name: 'fixture/fixture-app', html_url: 'https://github.com/fixture/fixture-app', clone_url: 'https://github.com/fixture/fixture-app.git' }
      return Response.json(repository)
    }
    if (route === '/v6/deployments') return Response.json({ deployments: deployment ? [deployment] : [] })
    if (route === '/v2/files') { uploads++; expect((options?.headers as Record<string, string>)['x-vercel-digest']).toMatch(/^[a-f0-9]{40}$/u); expect(url.searchParams.get('teamId')).toBe('team-fixture'); return Response.json({}) }
    if (route === '/v13/deployments') {
      creates++; const body = JSON.parse(options?.body as string) as Record<string, unknown>; expect(body.target).toBe('production')
      deployment = { id: 'deployment-fixture', url: 'fixture.vercel.app', projectId: 'project-fixture', meta: body.meta }
      throw new TypeError('Response lost after provider accepted the deployment')
    }
    if (route === '/v13/deployments/deployment-fixture') return Response.json({ readyState: 'READY' })
    throw new Error('Unexpected route: ' + route)
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    const first = await new DeliveryCoordinator(runtime).execute({ ...app, kind: 'website', artifacts: [], production: true }, new AbortController().signal)
    expect(first.phase).toBe('failed'); expect(creates).toBe(1); expect(uploads).toBe(2)
    const resumed = await new DeliveryCoordinator(runtime).execute(undefined, new AbortController().signal)
    expect(resumed.phase).toBe('complete'); expect(resumed.deployment?.url).toBe('https://fixture.vercel.app'); expect(resumed.projectId).toBe('project-fixture')
    expect(creates).toBe(1); expect(uploads).toBe(2)
    expect(pushed.mock.calls[0]?.[1]).toBe(resumed.commit)
  } finally { vi.unstubAllGlobals() }
}))
