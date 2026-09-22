/** Opt-in paired task scaffold; uses the supported ACP profile and never activates production review recipes. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-session-snapshot'
import { pairedDecisionTasks } from './fixtures/decision-paired-tasks.ts'

it('scores task artifacts rather than trusting agent success text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'strugend-paired-verifiers-'))
  try {
    for (const task of pairedDecisionTasks) {
      const directory = join(root, task.id)
      await mkdir(directory)
      for (const [path, data] of Object.entries(task.files)) await writeFile(join(directory, path), data)
      expect(await task.verify(directory)).toBe(false)
      if (task.id === 'signed-sum') await writeFile(join(directory, 'sum.mjs'), 'export function sum(numbers) { return numbers.reduce((a,b)=>a+b,0) }\n')
      if (task.id === 'expense-summary') await writeFile(join(directory, 'summary.json'), '{"currency":"EUR","totalCents":2100,"byCategory":{"Travel":1000,"Meals":1100}}')
      expect(await task.verify(directory)).toBe(true)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.env.STRUGEND_PAIRED_TEST !== '1')('runs isolated Core-only and candidate-assist tasks through dsh acp', async (context) => {
  const baseline = process.env.STRUGEND_PAIRED_BASELINE_PATCH, assist = process.env.STRUGEND_PAIRED_ASSIST_PATCH
  const coreRef = process.env.STRUGEND_PAIRED_CORE_KEY_REF ?? 'DEEPSEEK_API_KEY'
  await mkdir('.artifacts/strugend', { recursive: true })
  const artifact = '.artifacts/strugend/decision-paired-tasks.json'
  if (!baseline || !assist || !process.env[coreRef] || !process.env.IMPOSSIBL_API_KEY) {
    await writeFile(artifact, JSON.stringify({ status: 'skipped-missing-qualification-inputs', qualified: false,
      required: ['STRUGEND_PAIRED_BASELINE_PATCH', 'STRUGEND_PAIRED_ASSIST_PATCH', coreRef, 'IMPOSSIBL_API_KEY'] }, null, 2) + '\n')
    context.skip('Reviewed baseline/assist ACP overlays and both provider credentials are required.')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'strugend-paired-tasks-'))
  const results: { task: string; mode: string; passed: boolean; elapsedMs: number; tools: number; patchDigest: string }[] = []
  try {
    for (const [index, task] of pairedDecisionTasks.entries()) {
      // Reverse the order between tasks to avoid giving one variant all warmed provider requests.
      const variants = index % 2 === 0 ? [['baseline', baseline], ['assist', assist]] : [['assist', assist], ['baseline', baseline]]
      for (const [mode, patch] of variants) {
        if (!mode || !patch) throw new Error('Missing paired-task variant.')
        const directory = join(root, `${task.id}-${mode}`)
        await mkdir(directory)
        for (const [path, data] of Object.entries(task.files)) await writeFile(join(directory, path), data)
        const launched = launchAcpTestAgent({ agent: { binScript: resolve('apps/cli/src/bin.ts'), libBinScript: resolve('apps/cli/lib/bin.js'),
          configPath: resolve(patch), profile: 'acp', tsconfigPath: resolve('tsconfig.base.json') }, cwd: directory,
        requestPermission: async (params) => {
          const allowed = params.options.find(option => option.kind === 'allow_once')
          return allowed ? { outcome: { outcome: 'selected', optionId: allowed.optionId } } : { outcome: { outcome: 'cancelled' } }
        } })
        const started = performance.now()
        const watchdog = setTimeout(() => { void launched.close().catch(() => undefined) }, 120_000)
        try {
          await launched.client.initialize({ protocolVersion: 1, clientCapabilities: {} })
          const { sessionId } = await launched.client.newSession({ cwd: directory, mcpServers: [] })
          await launched.client.prompt({ sessionId, prompt: [{ type: 'text', text: task.prompt }] })
          const elapsedMs = performance.now() - started
          await launched.close()
          results.push({ task: task.id, mode, passed: await task.verify(directory), elapsedMs,
            tools: launched.updates.filter(update => update.sessionUpdate === 'tool_call').length,
            patchDigest: createHash('sha256').update(await readFile(resolve(patch))).digest('hex') })
        } finally { clearTimeout(watchdog); await launched.close() }
      }
    }
    await writeFile(artifact, JSON.stringify({ status: 'measured-scaffold', qualified: false, results,
      limitations: 'Two tasks establish runner plumbing only. Reviewed equal provider/tool/budget settings, recorded advice use, broader held-out outcomes, tokens, and memory measurements are still required.' }, null, 2) + '\n')
    expect(results).toHaveLength(pairedDecisionTasks.length * 2)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 600_000)
