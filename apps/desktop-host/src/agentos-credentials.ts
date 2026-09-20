/** Keychain-backed desktop credential provider, loaded through the desktop profile overlay. */
import { Service } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  parseCredentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRef,
  type ResolvedCredential,
  type CredentialRecordInfo,
  type CredentialRecordEntry,
} from '@deepseek-ai/dsh-credentials'
import { desktopRequest } from './agentos-bridge.ts'

/** Replaces the file provider without changing the Harness credential service contract. */
export default class DesktopCredentials extends CredentialProvider {
  private operations: Promise<unknown> = Promise.resolve()
  private closed = false
  private async read(key: string): Promise<string | undefined> {
    return (await desktopRequest<string | null>({ method: 'credential', operation: 'get', key })) ?? undefined
  }
  private async write(key: string, value?: string): Promise<void> {
    await desktopRequest({ method: 'credential', operation: value === undefined ? 'delete' : 'set', key, value })
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Credential storage is closed.'))
    const next = this.operations.then(fn)
    this.operations = next.catch(() => undefined)
    return next
  }
  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const inherited = process.env[ref]
    if (inherited) return { value: inherited, source: 'env' }
    const value = await this.read(ref)
    return value === undefined ? undefined : { value, source: 'System credential store' }
  }
  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const resolved = await this.resolve(ref)
    return {
      configured: resolved !== undefined,
      writable: !process.env[ref],
      ...(resolved === undefined ? {} : { source: resolved.source }),
    }
  }
  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (!value || process.env[ref])
      throw new Error('Enter a nonempty key, or remove its read-only environment override.')
    await this.serial(() => this.write(ref, value))
    this.notifyUpdated(ref)
  }
  override async unset(ref: CredentialRef): Promise<void> {
    if (process.env[ref]) throw new Error('Remove this key from the launching environment first.')
    await this.serial(() => this.write(ref))
    this.notifyUpdated(ref)
  }
  private async records(): Promise<Record<string, CredentialRecord>> {
    const text = await this.read('records')
    return text === undefined ? {} : (JSON.parse(text) as Record<string, CredentialRecord>)
  }
  override async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return (await this.records())[key]
  }
  override async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = await this.readRecord(key)
    return { configured: record !== undefined, writable: true, ...(record === undefined ? {} : { kind: record.kind }) }
  }
  override async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Object.entries(await this.records()).map(([key, value]) => ({
      key: parseCredentialKey(key),
      kind: value.kind,
    }))
  }
  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return this.serial(async () => {
      const records = await this.records()
      const next = await mutate(records[key])
      if (next === undefined) return records[key]
      records[key] = next
      await this.write('records', JSON.stringify(records))
      this.notifyRecordUpdated(key)
      return next
    })
  }
  override async deleteRecord(key: CredentialKey): Promise<void> {
    await this.serial(async () => {
      const records = Object.fromEntries(Object.entries(await this.records()).filter(([id]) => id !== key))
      await this.write('records', JSON.stringify(records))
      this.notifyRecordUpdated(key)
    })
  }
  *[Service.init](): Generator<() => Promise<void>, void, void> {
    yield async () => {
      this.closed = true
      await this.operations
    }
  }

}
