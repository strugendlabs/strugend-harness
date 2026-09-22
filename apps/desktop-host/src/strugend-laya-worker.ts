/** Offline ONNX inference worker. Loads verified local files without provider credentials or network requests. */
import { decisionEvidence } from './strugend-decision.ts'
import { parentPort, workerData } from 'node:worker_threads'
import { Laya } from '@receptron/laya'
import { verifyLayaAssets, layaManifest } from './strugend-laya-assets.ts'
import { decisionQuestions, decisionResponse } from './strugend-services.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

if (!parentPort) throw new Error('Local Decision must run in its owned worker.')
const port = parentPort
const options: unknown = workerData
if (!options || typeof options !== 'object' || !('directory' in options) || typeof options.directory !== 'string'
  || !('threads' in options) || !Number.isSafeInteger(options.threads) || Number(options.threads) < 1 || Number(options.threads) > 8)
  throw new Error('Invalid local Decision worker configuration.')
const directory = options.directory, threads = Number(options.threads)
const loaded = (async () => {
  await verifyLayaAssets(directory)
  return Laya.load({ modelDir: directory, executionProviders: ['cpu'], sessionOptions: {
    intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all',
  } })
})()
// A failed load is delivered to each waiting request; it cannot become an unhandled rejection.
void loaded.catch(() => undefined)
let queue = Promise.resolve()
port.on('message', (message: unknown) => {
  queue = queue.then(async () => {
    if (!message || typeof message !== 'object' || !('id' in message) || !Number.isSafeInteger(message.id)
      || !('state' in message) || typeof message.state !== 'string' || message.state.length > 6500
      || !('questions' in message) || !message.questions || typeof message.questions !== 'object' || Array.isArray(message.questions)) {
      port.postMessage({ error: 'Invalid local Decision request.' }); return
    }
    try {
      const questions = decisionQuestions(message.questions as Record<string, JsonValue>, 8)
      const model = await loaded
      const result = await model.systemOne(message.state, questions)
      const value = decisionResponse(JSON.parse(JSON.stringify(result)) as JsonValue, questions)
      port.postMessage({ id: message.id, result: { ...value, model: layaManifest.model, runtime: 'local', revision: layaManifest.revision } })
    } catch (error) {
      port.postMessage({ id: message.id, error: error instanceof Error ? decisionEvidence('Local Laya: ' + error.message, 1000) : 'Local Laya could not load or evaluate this request.' })
    }
  })
})
