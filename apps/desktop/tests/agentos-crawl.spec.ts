/** Native Rust crawling against owned local fixtures; no external accounts or websites. */
import { createServer, type Server } from 'node:http'
import { expect, it } from 'vitest'
import { crawlWebsite, extractCrawlPage } from '../src/agentos-crawl.ts'
import { resolveCrawl } from '../src/agentos-crawl-contract.ts'

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP fixture')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

it('collects same-origin pages, respects robots, and does not execute scripts or follow redirects', async () => {
  const hits: string[] = []
  const foreign = createServer((request, response) => {
    hits.push(`foreign:${request.url}`)
    response.end('Outside origin')
  })
  const foreignUrl = await listen(foreign)
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    hits.push(path)
    if (path === '/robots.txt') {
      response.end('User-agent: *\nDisallow: /private\n')
      return
    }
    if (path === '/redirect') {
      response.writeHead(302, { location: `${foreignUrl}/private` })
      response.end()
      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(
      `<!doctype html><html><head><title>Page ${path}</title></head><body><h1>Readable ${path}</h1><script>fetch('/executed')</script><input value="do-not-read"><a href="/next">Next page</a><a href="/private">Private</a><a href="/redirect">Redirect</a><a href="${foreignUrl}/">External</a></body></html>`,
    )
  })
  try {
    const url = await listen(server)
    const result = await crawlWebsite(
      resolveCrawl({ url, maxPages: 5, maxDepth: 3 }),
    )
    expect(result.engine).toBe('Spider (Rust)')
    expect(result.pages.map(page => new URL(page.url).pathname)).toContain(
      '/next',
    )
    expect(result.pages.some(page => page.text.includes('Readable'))).toBe(
      true,
    )
    expect(hits).toContain('/robots.txt')
    expect(hits).not.toContain('/private')
    expect(hits.filter(hit => hit.startsWith('foreign:'))).toEqual([])
    expect(hits).not.toContain('/executed')
    expect(JSON.stringify(result)).not.toContain('do-not-read')
  } finally {
    await Promise.all([close(server), close(foreign)])
  }
})

it('limits pages and bounds extracted Unicode text', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/robots.txt') {
      response.end('User-agent: *\nAllow: /')
      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(
      `<html><body>${'你好 '.repeat(4000)}${Array.from({ length: 10 }, (_, i) => `<a href="/page${i}">${i}</a>`).join('')}</body></html>`,
    )
  })
  try {
    const url = await listen(server)
    const result = await crawlWebsite(resolveCrawl({ url, maxPages: 2 }))
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.pages.length).toBeLessThanOrEqual(2)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100_000)
  } finally {
    await close(server)
  }
})

it('rejects credential URLs, executable protocols, and unbounded crawling', () => {
  for (const input of [
    { url: 'mail' },
    { url: 'file:///etc/passwd' },
    { url: 'https://u:p@example.com' },
    { url: 'https://example.com', maxPages: 26 },
    { url: 'https://example.com', maxDepth: 0 },
  ])
    expect(() => resolveCrawl(input)).toThrow()
})

it('keeps decoded readable text and strips form values and executable content', () => {
  const page = extractCrawlPage(
    {
      url: 'https://example.com/',
      statusCode: 200,
      content:
        '<html><head><title>A &amp; B</title></head><body>Hello &amp; world<script>private-script</script><textarea>private-value</textarea><a href="/next">Next</a></body></html>',
    },
    'https://example.com',
  )
  expect(page.title).toBe('A & B')
  expect(page.text).toContain('Hello & world')
  expect(page.text).not.toContain('private')
  expect(page.links).toEqual(['https://example.com/next'])
  expect(
    extractCrawlPage(
      { url: 'https://example.com/redirect', statusCode: 302, content: '' },
      'https://example.com',
    ),
  ).toMatchObject({ status: 302, text: '', title: '' })
})
