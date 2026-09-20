/** Shared address handling for the visible browser and read-only crawler. */

/** @param value - Explicit website URL. @returns An allowed canonical HTTP(S) URL. */
export function websiteUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'Only HTTP and HTTPS addresses without credentials can be opened.',
    )
  if (
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.port === (process.env.DSH_DESKTOP_HOST_PORT ?? '19387')
  )
    throw new Error('The application service cannot be opened as a website.')
  return url.href
}

/** @param value - Address-bar or tool input. @returns A website or an encoded Brave Search URL. */
export function browserUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 8192 || !value.trim())
    throw new Error('Enter a website address or a search query.')
  const input = value.trim()
  const host =
    /^(?:localhost|\[[\da-f:]+\]|(?:[\p{L}\d_-]+\.)+[\p{L}\d-]+)(?::\d+)?(?:[/?#][^\s]*)?$/iu
  if (host.test(input))
    return websiteUrl(
      `${/^localhost(?=[:/?#]|$)|^127\.|^\[::1\]/u.test(input) ? 'http' : 'https'}://${input}`,
    )
  if (/^[a-z][a-z\d+.-]*:/iu.test(input)) return websiteUrl(input)
  if (/^[^\s/@]+:[^\s/]*@/u.test(input))
    throw new Error('Addresses cannot contain credentials.')
  const search = new URL('https://search.brave.com/search')
  search.searchParams.set('q', input)
  return search.href
}

/** @param error - Chromium navigation rejection. @returns A concise recovery message. */
export function navigationError(error: unknown): string {
  const message = String(error)
  if (message.includes('ERR_NAME_NOT_RESOLVED'))
    return 'Website not found. Enter a full address, or search with Brave.'
  if (/ERR_CERT_|ERR_SSL_/u.test(message))
    return 'The website could not establish a secure connection.'
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/u.test(message))
    return 'Check your internet connection, then reload.'
  if (message.includes('ERR_CONNECTION_REFUSED'))
    return 'The website refused the connection. Check the address and port.'
  if (message.includes('ERR_TIMED_OUT'))
    return 'The website took too long to respond. Try reloading.'
  return 'This page could not load. Check the address or search with Brave.'
}
