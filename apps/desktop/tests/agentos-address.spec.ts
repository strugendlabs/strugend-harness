/** Address input must distinguish website navigation from Brave search. */
import { expect, it } from 'vitest'
import { browserUrl, navigationError } from '../src/agentos-address.ts'

it.each(['mail', '  mail  ', 'rust web crawling', 'hello.world today'])(
  'searches plain input %s',
  (input) => {
    const url = new URL(browserUrl(input))
    expect(url.origin).toBe('https://search.brave.com')
    expect(url.searchParams.get('q')).toBe(input.trim())
  },
)

it.each([
  ['mail.google.com', 'https://mail.google.com/'],
  ['example.com/path?x=1#title', 'https://example.com/path?x=1#title'],
  ['example.com:8443', 'https://example.com:8443/'],
  ['localhost:3210', 'http://localhost:3210/'],
  ['127.0.0.1:3210/form', 'http://127.0.0.1:3210/form'],
  ['https://intranet/', 'https://intranet/'],
  ['https://example.com/a b', 'https://example.com/a%20b'],
])('opens %s as a website', (input, expected) => {
  expect(browserUrl(input)).toBe(expected)
})

it.each([
  '',
  ' ',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'https://user:secret@example.com',
  'alice:secret@example.com',
])('rejects unsafe or empty input %s', (input) => {
  expect(() => browserUrl(input)).toThrow()
})

it('describes DNS errors without exposing Electron IPC internals', () => {
  expect(
    navigationError(
      new Error('ERR_NAME_NOT_RESOLVED (-105) loading https://mail/'),
    ),
  ).toBe('Website not found. Enter a full address, or search with Brave.')
})
