/** Opt-in real Impossibl qualification; credentials stay in memory and never enter artifacts. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { expect, it } from 'vitest'
import { compileReview } from '../src/strugend-review.ts'
import { decisionEvidence, evaluateDecision, prepareDecision } from '../src/strugend-decision.ts'
import { decisionQualityCases } from './fixtures/decision-quality.ts'
import { decisionQualityReport, type QualityObservation } from './fixtures/decision-quality-report.ts'

async function configuredKey(): Promise<string | undefined> {
  if (process.env.IMPOSSIBL_API_KEY) return process.env.IMPOSSIBL_API_KEY
  let source: string
  try { source = await readFile(new URL('../../../.env', import.meta.url), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  return parseEnv(source).IMPOSSIBL_API_KEY
}

it.skipIf(process.env.LAYA_REMOTE_MODEL_TEST !== '1')('measures the production review recipes against real remote inference', async (context) => {
  const key = await configuredKey()
  await mkdir('.artifacts/strugend', { recursive: true })
  const artifact = '.artifacts/strugend/remote-laya-quality.json'
  if (!key) {
    await writeFile(artifact, JSON.stringify({ status: 'skipped-missing-credential', credential: 'IMPOSSIBL_API_KEY', qualified: false }, null, 2) + '\n')
    context.skip('IMPOSSIBL_API_KEY is absent from the process environment and root .env.')
    return
  }
  const settings = { decisionUrl: 'https://api.impossibl.com/v1/systemone', decisionModels: ['convaiinnovations/laya-multilingual'], timeoutMs: 2000, maxBytes: 1_048_576, maxQuestions: 5 }
  const observations: QualityObservation[] = []
  const models = new Set<string>()
  for (const fixture of decisionQualityCases) {
    const started = performance.now()
    try {
      const request = prepareDecision(compileReview(fixture.input), settings)
      const result = await evaluateDecision(request, key, settings, new AbortController().signal)
      if (typeof result.model === 'string') models.add(result.model)
      const answers = result.answers
      const answer = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers.review : undefined
      const value = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : undefined
      observations.push({ id: fixture.id, durationMs: performance.now() - started,
        ...(typeof value?.choice === 'string' ? { choice: value.choice } : {}), ...(typeof value?.confidence === 'number' ? { confidence: value.confidence } : {}) })
    } catch (error) {
      observations.push({ id: fixture.id, durationMs: performance.now() - started,
        error: decisionEvidence(error instanceof Error ? error.message : 'Remote inference failed.', 600) })
    }
  }
  const quality = decisionQualityReport(decisionQualityCases, observations, .9)
  await writeFile(artifact, JSON.stringify({ status: 'measured', runtime: 'remote', models: [...models], revision: 'unreported',
    quality, observations, automaticActivation: false, reason: 'Remote precision alone does not establish an immutable model revision or paired-task benefit.' }, null, 2) + '\n')
  expect(observations).toHaveLength(decisionQualityCases.length)
  expect(models.size).toBeGreaterThan(0)
  if (process.env.LAYA_REQUIRE_QUALIFIED === '1') expect(Object.values(quality.intents).every(result => result.qualified)).toBe(true)
}, 180_000)
