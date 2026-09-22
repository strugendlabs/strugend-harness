/** Private offline inference helper. Only its owning Host can communicate over the inherited IPC channel. */
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'
import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { decisionEvidence } from './strugend-decision.ts'
import type { Laya } from '@receptron/laya'
import { verifyLayaAssets, layaManifest } from './strugend-laya-assets.ts'
import { decisionQuestions, decisionResponse } from './strugend-services.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

if (!process.send || !process.connected) throw new Error('Local Decision must run in its owned helper process.')
const send = (message: object): void => { if (process.connected) process.send?.(message, (error) => { if (error) process.exitCode = 1 }) }
let model: Laya | undefined
let busy = false
process.once('disconnect', () => { process.exit(0) })
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('id' in message) || !Number.isSafeInteger(message.id)
    || !('state' in message) || typeof message.state !== 'string' || message.state.length > 6500
    || !('questions' in message) || !message.questions || typeof message.questions !== 'object' || Array.isArray(message.questions)
    || !('options' in message) || !message.options || typeof message.options !== 'object') {
    send({ error: 'Invalid local Decision request.' }); return
  }
  const { options } = message
  if (!('directory' in options) || typeof options.directory !== 'string' || !('runtimeDirectory' in options) || typeof options.runtimeDirectory !== 'string'
    || !('threads' in options) || !Number.isSafeInteger(options.threads) || Number(options.threads) < 1 || Number(options.threads) > 2) {
    send({ id: message.id, error: 'Invalid local Decision helper configuration.' }); return
  }
  if (busy) { send({ id: message.id, error: 'Local Decision helper already has an active request.' }); return }
  busy = true
  const state = message.state, directory = options.directory, runtimeDirectory = options.runtimeDirectory, threads = Number(options.threads)
  void (async () => {
    try {
      const questions = decisionQuestions(message.questions as Record<string, JsonValue>, 8)
      if (!model) {
        await verifyLayaAssets(directory)
        const root = await realpath(runtimeDirectory)
        const sdkPath = await realpath(createRequire(join(root, 'package.json')).resolve('@receptron/laya'))
        const modulePath = relative(root, sdkPath)
        if (modulePath.startsWith('..') || isAbsolute(modulePath)) throw new Error('Decision runtime is missing from the installed component.')
        const sdk = await import(pathToFileURL(sdkPath).href) as typeof import('@receptron/laya')
        model = await sdk.Laya.load({ modelDir: directory, executionProviders: ['cpu'], sessionOptions: {
          intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all',
        } })
      }
      const result = await model.systemOne(state, questions)
      const value = decisionResponse(JSON.parse(JSON.stringify(result)) as JsonValue, questions)
      send({ id: message.id, result: { ...value, model: layaManifest.model, runtime: 'local', revision: layaManifest.revision },
        memory: { rss: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024 } })
    } catch (error) {
      send({ id: message.id, error: error instanceof Error ? decisionEvidence('Local Laya: ' + error.message, 1000) : 'Local Laya could not load or evaluate this request.' })
    } finally { busy = false }
  })()
})
