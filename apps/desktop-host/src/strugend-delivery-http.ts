/** Credential-bound GitHub and Vercel requests; provider errors never echo response bodies. */
import { createHash } from 'node:crypto'
import { requestJson, serviceUrl } from './strugend-services.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Addresses and bounds for the delivery providers. */
export interface DeliveryHttpConfig {
  githubUrl: string
  vercelUrl: string
  timeoutMs: number
  maxBytes: number
}

/** Response object read from an authenticated provider. */
export type ProviderObject = Record<string, JsonValue>

/**
 * Make one bounded request; redirects cannot carry provider credentials elsewhere.
 * @param base - Configured provider origin, or loopback fixture origin.
 * @param path - Provider-owned path and query.
 * @param key - Credential resolved by the Host.
 * @param method - Explicit HTTP method.
 * @param body - Request object, bytes for file upload, or absent for GET.
 * @param config - HTTP limits.
 * @param signal - Run cancellation.
 * @returns Parsed object; unexpected HTTP, JSON, or body sizes reject.
 */
export async function deliveryHttp(base: string, path: string, key: string, method: 'GET' | 'POST', body: JsonValue | Uint8Array | undefined, config: DeliveryHttpConfig, signal: AbortSignal): Promise<ProviderObject> {
  const origin = serviceUrl(base)
  if (origin.pathname !== '/') throw new Error('Delivery provider addresses must be origins.')
  const url = new URL(path, origin)
  if (url.origin !== origin.origin) throw new Error('Invalid delivery provider path.')
  if (method === 'POST' && !(body instanceof Uint8Array)) {
    const value = await requestJson(url, key, body ?? {}, config, signal)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Delivery provider returned an invalid response.')
    return value
  }
  const deadline = AbortSignal.timeout(config.timeoutMs)
  const combined = AbortSignal.any([signal, deadline])
  const response = await fetch(url, { method, redirect: 'error', signal: combined,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body instanceof Uint8Array ? { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': createHash('sha1').update(body).digest('hex'), 'x-vercel-size': String(body.byteLength) } : {}) },
    ...(body instanceof Uint8Array ? { body: Buffer.from(body) } : {}),
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Delivery request failed (HTTP ${response.status}). Check the connection and account permissions.`) }
  const chunks: Uint8Array[] = []; let size = 0
  if (!response.body) throw new Error('Delivery provider returned no response.')
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > config.maxBytes) throw new Error('Delivery response exceeds the byte limit.')
    chunks.push(chunk)
  }
  combined.throwIfAborted()
  const text = Buffer.concat(chunks).toString('utf8')
  const value: unknown = text ? JSON.parse(text) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Delivery provider returned an invalid response.')
  return value as ProviderObject
}
