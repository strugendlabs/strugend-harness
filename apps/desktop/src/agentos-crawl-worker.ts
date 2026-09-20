/** One-shot native crawler process. The desktop owns its deadline and termination. */
import { crawlWebsite } from './agentos-crawl.ts'
import { resolveCrawl } from './agentos-crawl-contract.ts'

process.once('message', (input: unknown) => {
  void (async () => {
    try {
      const result = await crawlWebsite(resolveCrawl(input))
      process.send?.({ result }, () => {
        process.exit(0)
      })
    } catch (error) {
      process.send?.(
        { error: error instanceof Error ? error.message : 'Crawling failed.' },
        () => {
          process.exit(1)
        },
      )
    }
  })()
})
process.once('disconnect', () => {
  process.exit(1)
})
