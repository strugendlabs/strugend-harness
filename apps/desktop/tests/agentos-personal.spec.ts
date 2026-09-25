/** Native personal operations never return secrets or fill an unrelated conversation's page. */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import type { AgentOsEvent } from '@deepseek-ai/dsh-agentos-protocol'
vi.mock('electron', () => ({
  app: { isPackaged: false }, ipcMain: { handle: () => {}, removeHandler: () => {} },
  safeStorage: { isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  clipboard: {}, shell: {}, session: {}, WebContentsView: vi.fn(),
}))
import { AgentOsDesktop } from '../src/agentos.ts'

it('saves memory with conflict detection, scopes vault metadata, and opens a secure form without a password argument', async () => {
  const root = mkdtempSync(join(tmpdir(), 'strugend-personal-')), events: AgentOsEvent[] = []
  const window = { isDestroyed: () => false, webContents: { send: (_channel: string, event: AgentOsEvent) => { events.push(event) } } }
  const desktop = new AgentOsDesktop(root, () => window as unknown as BrowserWindow, () => {})
  try {
    const memory = desktop.store.memory()
    await desktop.hostRequest({ method: 'memory-write', text: 'Use concise English.', revision: memory.revision })
    expect(events).toContainEqual({ type: 'personal.changed' })
    await expect(desktop.hostRequest({ method: 'memory-write', text: 'stale', revision: memory.revision })).rejects.toThrow('changed elsewhere')
    const entries = desktop.store.saveVault({ name: 'Portal', origin: 'https://example.test/login', username: 'alice', password: 'synthetic-secret' })
    desktop.store.saveVault({ name: 'Other', origin: 'https://other.test', username: 'bob', password: 'other-secret' })
    vi.spyOn(desktop.browser, 'list').mockImplementation(owner => owner === 'chat' ? [{ sessionId: owner, tabId: 'tab', url: 'https://example.test/login', title: 'Login', loading: false, canGoBack: false, canGoForward: false, revision: 8, takenOver: false, recording: false, visible: true }] : [])
    const fill = vi.spyOn(desktop.browser, 'fillCredential').mockResolvedValue()
    const check = await desktop.hostRequest({ method: 'vault-use', action: 'check', sessionId: 'chat', tabId: 'tab' })
    expect(check).toEqual({ origin: 'https://example.test', logins: entries })
    expect(JSON.stringify(check)).not.toContain('secret')
    await expect(desktop.hostRequest({ method: 'vault-use', action: 'fill', sessionId: 'other', tabId: 'tab', id: entries[0]!.id, revision: 8 })).rejects.toThrow('owned')
    await expect(desktop.hostRequest({ method: 'vault-use', action: 'fill', sessionId: 'chat', tabId: 'tab', id: entries[0]!.id })).rejects.toThrow('revision')
    expect(fill).not.toHaveBeenCalled()
    const result = await desktop.hostRequest({ method: 'vault-use', action: 'fill', sessionId: 'chat', tabId: 'tab', id: entries[0]!.id, revision: 8 })
    expect(fill).toHaveBeenCalledWith('chat', 'tab', 'https://example.test', 'alice', 'synthetic-secret', { revision: 8, signal: undefined })
    expect(JSON.stringify(result)).not.toContain('secret')
    await desktop.hostRequest({ method: 'vault-use', action: 'add', sessionId: 'chat', tabId: 'tab' })
    expect(events.at(-1)).toEqual({ type: 'vault.open', sessionId: 'chat', origin: 'https://example.test' })
    expect(await desktop.hostRequest({ method: 'personal-context', limit: 256 })).toMatchObject({ memory: { text: 'Use concise English.', truncated: false }, savedLogins: 2 })
    await expect(desktop.hostRequest({ method: 'personal-context', limit: -1 })).rejects.toThrow('limit')
  } finally { await desktop.dispose(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() }
})
