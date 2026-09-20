/** Validated request and result contract for the isolated Rust crawler. */
import { websiteUrl } from './agentos-address.ts'

export interface CrawlSpec {
  url: string
  maxPages: number
  maxDepth: number
  timeoutMs: number
}

export interface CrawlPage {
  url: string
  status: number
  title: string
  text: string
  links: string[]
  truncated: boolean
}

export interface CrawlResult {
  engine: 'Spider (Rust)'
  url: string
  pages: CrawlPage[]
  elapsedMs: number
  truncated: boolean
  limitation: string
}

/** @param input - Untrusted tool/process input. @returns Explicit bounded crawl settings. */
export function resolveCrawl(input: unknown): CrawlSpec {
  if (typeof input !== 'object' || input === null)
    throw new Error('Provide a website URL to crawl.')
  const value = input as Record<string, unknown>
  if (typeof value.url !== 'string' || value.url.length > 8192)
    throw new Error('Provide a full HTTP(S) website URL.')
  const number = (key: string, fallback: number, max: number): number => {
    const result = value[key] ?? fallback
    if (
      typeof result !== 'number' ||
      !Number.isSafeInteger(result) ||
      result < 1 ||
      result > max
    )
      throw new Error(`${key} must be an integer between 1 and ${max}.`)
    return result
  }
  const url = new URL(websiteUrl(value.url))
  url.hash = ''
  return {
    url: url.href,
    maxPages: number('maxPages', 10, 25),
    maxDepth: number('maxDepth', 2, 4),
    timeoutMs: number('timeoutMs', 25_000, 30_000),
  }
}
