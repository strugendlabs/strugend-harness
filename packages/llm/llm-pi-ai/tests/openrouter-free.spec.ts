/**
 * A free OpenRouter model is an ordinary route, not a special case: the
 * installed catalog lists it, a settings profile reaches it, and the request
 * that leaves the harness carries the free model id and the profile's key.
 *
 * The model id comes from the shipped catalog rather than a literal, because a
 * free model retiring upstream must fail this spec rather than silently keep
 * passing against a name OpenRouter no longer serves.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = 'llm-pi-ai'
const KEY_REF = 'PI_OPENROUTER_FREE_KEY'
const KEY = 'sk-or-v1-synthetic'

/** One free OpenRouter model the installed catalog ships. */
const free = getBuiltinModels('openrouter').filter(model => model.id.endsWith(':free'))

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

it('ships free OpenRouter models in the catalog with an OpenAI-compatible protocol', () => {
  expect(free.length).toBeGreaterThan(0)
  expect(free.every(model => model.api === 'openai-completions')).toBe(true)
})

it('offers OpenRouter in the add-provider directory before anything is configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-openrouter-offer-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmPiAi, {})

  // Zero routes: the directory is what the settings page offers to configure.
  expect(ctx.llm.listProviders()).toEqual([])
  const entry = ctx.llm.listConfigurableProviders().find(candidate => candidate.provider === 'openrouter')
  expect(entry).toMatchObject({ provider: 'openrouter', settingsPath: ['providers', 'openrouter'], declared: false })
  expect(entry?.error).toBeUndefined()
})

it('runs a free OpenRouter model through the real composition with the profile key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-openrouter-free-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const server = await mockServer([{ events: textEvents }])
  const id = free[0]!.id
  await writeFile(join(dir, 'settings.yaml'), JSON.stringify({
    [NS]: { providers: { openrouter: { apiKeyEnv: KEY_REF, baseURL: server.url, models: [{ id }] } } },
  }))
  await writeFile(join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  ${KEY_REF}: ${KEY}\n`, { mode: 0o600 })
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmPiAi, {})

  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openrouter'])
  expect((await ctx.llm.listModels('openrouter')).map(model => model.id)).toEqual([id])
  await expect(ctx.llm.validateConnection('openrouter', id)).resolves.toBeUndefined()

  const result = await assemble(ctx, {
    provider: 'openrouter', model: id,
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'ping' }],
      source: { kind: 'plugin', plugin: 'test' },
    })],
  })
  expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  expect(server.paths).toHaveLength(1)
  expect(server.paths[0]).toMatch(/chat\/completions$/u)
  expect(server.headers[0]!.authorization).toBe(`Bearer ${KEY}`)
  expect((server.requests[0] as { model?: string } | undefined)?.model).toBe(id)
})

it('registers and streams a hand-written profile that declares catalog models without an api override', async () => {
  // The shape a user writes by hand in settings.yaml: no `api`, three catalog
  // ids, one paid and two free. Every id must resolve and the free one must run.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-openrouter-handwritten-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const server = await mockServer([{ events: textEvents }, { events: textEvents }, { events: textEvents }])
  const paid = 'qwen/qwen3.8-27b'
  const freeGlm = 'z-ai/glm-5.2:free'
  const freeMinimax = 'minimax/minimax-m3:free'
  const ids = [paid, freeGlm, freeMinimax]
  await writeFile(join(dir, 'settings.yaml'), JSON.stringify({
    [NS]: { providers: { openrouter: {
      apiKeyEnv: KEY_REF,
      // A deployed profile omits baseURL and takes the catalog's own
      // https://openrouter.ai/api/v1; a scripted one points at the mock. The
      // model shape under test is identical either way.
      baseURL: server.url,
      models: [
        { id: paid, contextWindow: 1_000_000, maxTokens: 131_072 },
        { id: freeGlm, contextWindow: 256_000, maxTokens: 230_400 },
        { id: freeMinimax, contextWindow: 1_048_576, maxTokens: 943_718 },
      ],
    } } },
  }))
  await writeFile(join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  ${KEY_REF}: ${KEY}\n`, { mode: 0o600 })
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmPiAi, {})

  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openrouter'])
  expect((await ctx.llm.listModels('openrouter')).map(model => model.id)).toEqual(ids)
  expect(ctx.llm.listConfigurableProviders().find(entry => entry.provider === 'openrouter')?.error).toBeUndefined()
  await expect(ctx.llm.validateConnection('openrouter', freeGlm)).resolves.toBeUndefined()

  const result = await assemble(ctx, {
    provider: 'openrouter', model: freeGlm,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'plugin', plugin: 'test' } })],
  })
  expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  expect((server.requests[0] as { model?: string } | undefined)?.model).toBe(freeGlm)
})

it('refuses a free-looking id the catalog does not describe before any request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-openrouter-undeclared-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const server = await mockServer([])
  const id = free[0]!.id
  await writeFile(join(dir, 'settings.yaml'), JSON.stringify({
    [NS]: { providers: { openrouter: { apiKeyEnv: KEY_REF, baseURL: server.url } } },
  }))
  await writeFile(join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  ${KEY_REF}: ${KEY}\n`, { mode: 0o600 })
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmPiAi, {})

  // A profile with no model list serves the catalog the profile was built from.
  const listed = (await ctx.llm.listModels('openrouter')).map(model => model.id)
  expect(listed).toContain(id)
  const result = await assemble(ctx, {
    provider: 'openrouter', model: 'openrouter/does-not-exist:free',
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'ping' }],
      source: { kind: 'plugin', plugin: 'test' },
    })],
  })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNKNOWN_MODEL' } })
  expect(server.requests).toHaveLength(0)
})
