/** HTTP-only page collection using Spider's native Rust engine. */
import { Website, type NPage } from '@spider-rs/spider-rs'
import { parseHTML } from 'linkedom'
import type {
  CrawlSpec,
  CrawlPage,
  CrawlResult,
} from './agentos-crawl-contract.ts'

/** @param page - Rust page result. @param origin - Requested origin. @returns Bounded, inert readable page data. */
export function extractCrawlPage(page: NPage, origin: string): CrawlPage {
  const html = page.content.slice(0, 2_000_000)
  const { document } = parseHTML(
    /<html[\s>]/iu.test(html) ? html : `<html><body>${html}</body></html>`,
  )
  const title = (document.querySelector('title')?.textContent ?? '').slice(
    0,
    300,
  )
  document
    .querySelectorAll(
      'script,style,template,noscript,svg,input,textarea,[contenteditable]',
    )
    .forEach((node) => {
      node.remove()
    })
  const text = (document.querySelector('body')?.textContent ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
  const links = new Set<string>()
  for (const anchor of document.querySelectorAll('a[href]')) {
    let url: URL
    try {
      url = new URL(anchor.getAttribute('href') ?? '', page.url)
    } catch {
      continue
    }
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      continue
    url.hash = ''
    links.add(url.href)
    if (links.size >= 20) break
  }
  return {
    url: page.url,
    status: page.statusCode,
    title,
    text: text.slice(0, 6000),
    links: [...links],
    truncated: text.length > 6000 || html.length < page.content.length,
  }
}

/** @param spec - Validated settings. @returns Same-origin pages; no browser cookies or JavaScript execution. */
export async function crawlWebsite(spec: CrawlSpec): Promise<CrawlResult> {
  const origin = new URL(spec.url).origin
  const start = performance.now()
  const website = new Website(spec.url)
    .withBudget({ '*': spec.maxPages })
    .withDepth(spec.maxDepth)
    .withRespectRobotsTxt(true)
    .withUserAgent('AgentOS/0.1 (Spider; read-only website research)')
    .withSubdomains(false)
    .withTld(false)
    .withFullResources(false)
    .withExternalDomains([])
    .withWhitelistUrl([
      `^${origin.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:/|$)`,
    ])
    .withRedirectPolicy(false)
    .withRedirectLimit(0)
    .withRequestTimeout(Math.min(spec.timeoutMs, 8000))
    .withDelay(100)
    .build()
  const result: CrawlResult = {
    engine: 'Spider (Rust)',
    url: spec.url,
    pages: [],
    elapsedMs: 0,
    truncated: false,
    limitation:
      'HTTP reading only; respects robots.txt and does not follow redirects. Use desktop_browser for JavaScript, sign-in, forms, or actions.',
  }
  // Scrape owns collection until completion; no subscription callback can outlive this result.
  try {
    await website.scrape(undefined, false, false)
    for (const raw of website.getPages()) {
      if (new URL(raw.url).origin !== origin) continue
      const page = extractCrawlPage(raw, origin)
      result.pages.push(page)
      if (
        result.pages.length > spec.maxPages ||
        Buffer.byteLength(JSON.stringify(result)) > 96_000
      ) {
        result.pages.pop()
        result.truncated = true
        break
      }
    }
    result.elapsedMs = Math.round(performance.now() - start)
    result.truncated ||=
      result.pages.length >= spec.maxPages ||
      result.pages.some(page => page.truncated)
    if (result.pages.length === 0)
      throw new Error(
        'No pages returned. The site may block crawling or disallow it in robots.txt; use the visible browser.',
      )
    return result
  } finally {
    website.clear()
  }
}
