/** External services fail closed on malformed data and release network work on cancellation. */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { decisionQuestions, decisionResponse, requestJson, serviceUrl } from '../src/strugend-services.ts'
import { Config } from '../src/strugend-intelligence.ts'

const questions = {
  task: { type: 'choice' as const, instructions: 'Which work is requested?', criteria: { coding: 'Change software', writing: 'Draft text' } },
  evidence: { type: 'noul' as const, instructions: 'Does the supplied test output show a passing run?' },
  relevance: { type: 'score' as const, instructions: 'Rate relevance to this task.', criteria: ['Unrelated', 'Related', 'Directly needed'] },
}
const response = () => ({ model: 'jev-latest', answers: {
  task: { type: 'choice', choice: 'coding', probabilities: { coding: 0.9, writing: 0.1 }, confidence: 0.7 },
  evidence: { type: 'noul', noul: 0.8 },
  relevance: { type: 'score', score: 1.6, probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 }, legend: { '0': 'Unrelated', '1': 'Related', '2': 'Directly needed' }, confidence: 0.6 },
}, usage: { input_tokens: 100, output_tokens: 20 } })

it('preserves independent questions and validates every matching answer', async () => {
  const parsed = decisionQuestions(questions, 8)
  expect(parsed).toEqual(questions)
  expect(parsed).not.toBe(questions)
  await expect(JSON.stringify(decisionResponse(response(), parsed), null, 2) + '\n').toMatchFileSnapshot('./expected/strugend-decision.json')
})

it.each([
  {}, { a: { type: 'unknown', instructions: 'x' } },
  { a: { type: 'choice', instructions: 'x', criteria: { one: 'Only option' } } },
  { a: { type: 'score', instructions: 'x', criteria: ['One'] } },
  { a: { type: 'noul', instructions: '', unsafe: true } },
])('rejects an invalid question batch before sending it: %j', (value) => {
  expect(() => decisionQuestions(value, 8)).toThrow()
})

it('enforces batch limits and complete, typed, finite response values', () => {
  expect(() => decisionQuestions(questions, 2)).toThrow('1–2')
  const missing = response(); delete (missing.answers as Partial<typeof missing.answers>).task
  const unknown = response(); unknown.answers.task.choice = 'unexpected'
  const distribution = response(); distribution.answers.task.probabilities.coding = 10
  const wrongType = response(); wrongType.answers.task.type = 'noul'
  const score = response(); score.answers.relevance.score = 9
  const legend = response(); legend.answers.relevance.legend['0'] = 'Different rubric'
  const usage = response(); usage.usage.input_tokens = -1
  for (const value of [missing, unknown, distribution, wrongType, score, legend, usage])
    expect(() => decisionResponse(value, questions)).toThrow('invalid answer')
})

it.each(['http://example.com/v1', 'https://name:secret@example.com', 'https://example.com?token=secret', 'https://example.com/#secret', 'file:///tmp/key'])('rejects credential-bearing or insecure remote URLs: %s', (url) => {
  expect(() => serviceUrl(url)).toThrow()
})

it('uses direct decision inference and leaves graph reads disconnected by default', () => {
  const config = Config({} as Config)
  expect(config.decisionUrl).toBe('https://api.typesafe.ai/v1/systemone')
  expect(config.graphUrl).toBe('')
  expect(config.decisionModels).toEqual(['jev-latest'])
  expect(serviceUrl('http://127.0.0.1:8080').origin).toBe('http://127.0.0.1:8080')
})

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  run: (base: string, server: Server) => Promise<void>,
): Promise<void> {
  const failures: unknown[] = []
  const pending = new Set<Promise<void>>()
  const server = createServer((req, res) => {
    const task = Promise.resolve().then(() => handler(req, res)).catch((error: unknown) => {
      failures.push(error)
      res.destroy()
    })
    pending.add(task)
    void task.then(() => { pending.delete(task) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  try { await run(`http://127.0.0.1:${address.port}`, server) }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await Promise.all(pending)
  }
  if (failures.length) throw failures[0]
}

it('sends only the supplied state/questions/model and rejects redirects, large bodies and HTTP errors', async () => {
  let requests = 0
  await withServer(async (req, res) => {
    requests++
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/capture' }); res.end(); return }
    if (req.url === '/large') { res.end('x'.repeat(1025)); return }
    if (req.url === '/auth') { res.writeHead(401); res.end('fixture-key must never be included in the error'); return }
    if (req.url === '/invalid') { res.end('{'); return }
    expect(req.headers.authorization).toBe('Bearer fixture-key')
    let raw = ''; for await (const chunk of req) raw += String(chunk)
    res.setHeader('Content-Type', 'application/json'); res.end(raw)
  }, async (base) => {
    const send = (path: string, body = { state: 'Synthetic state', questions, model: 'jev-latest' }) =>
      requestJson(serviceUrl(base + path), 'fixture-key', body, { timeoutMs: 5000, maxBytes: 1024 }, new AbortController().signal)
    expect(await send('/ok')).toEqual({ state: 'Synthetic state', questions, model: 'jev-latest' })
    await expect(send('/redirect')).rejects.toThrow('connection failed')
    expect(requests).toBe(2)
    await expect(send('/large')).rejects.toThrow('byte limit')
    await expect(send('/auth')).rejects.toThrow('HTTP 401')
    await expect(send('/invalid')).rejects.toThrow('invalid JSON')
    const count = requests
    await expect(send('/ok', { state: 'x'.repeat(1025), questions, model: 'jev-latest' })).rejects.toThrow('byte limit')
    expect(requests).toBe(count)
  })
})

it('cancels an in-flight request and enforces a deadline on a stalled response', async () => {
  let arrived!: () => void
  const requestArrived = new Promise<void>((resolve) => { arrived = resolve })
  await withServer((_req, res) => { res.writeHead(200); res.write('{'); arrived() }, async (base) => {
    const abort = new AbortController()
    const request = requestJson(serviceUrl(base), 'fixture-key', {}, { timeoutMs: 5000, maxBytes: 1024 }, abort.signal)
    const rejected = expect(request).rejects.toThrow('Stopped by test')
    await requestArrived
    abort.abort(new Error('Stopped by test'))
    await rejected
    await expect(requestJson(serviceUrl(base), 'fixture-key', {}, { timeoutMs: 50, maxBytes: 1024 }, new AbortController().signal)).rejects.toThrow('deadline exceeded')
  })
})
