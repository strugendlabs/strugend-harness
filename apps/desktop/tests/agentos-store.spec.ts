/** Durable tree, encrypted vault, and versioned memory behavior. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentOsStore } from '../src/agentos-store.ts'

const roots: string[] = []
const key = randomBytes(32)
const cipher = {
  encrypt(value: string): Buffer {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([c.update(value, 'utf8'), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), body])
  },
  decrypt(value: Buffer): string {
    const c = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
    c.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString()
  },
}
function setup(): { root: string; store: AgentOsStore } {
  const root = mkdtempSync(join(tmpdir(), 'agent-os-store-'))
  roots.push(root)
  return { root, store: new AgentOsStore(root, cipher) }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Agent OS persisted workspace', () => {
  it('keeps nested groups and chat placements across restart and rejects cycles and stale edits', () => {
    const { root, store } = setup()
    let state = store.mutateOrganization(0, { kind: 'create', name: 'Work', parentId: null })
    const work = state.groups[0]!.id
    state = store.mutateOrganization(state.revision, { kind: 'create', name: 'Marketing', parentId: work })
    const marketing = state.groups[1]!.id
    state = store.mutateOrganization(state.revision, { kind: 'assign', sessionId: 'chat-one', groupId: marketing })
    expect(() => store.mutateOrganization(0, { kind: 'rename', id: work, name: 'Stale' })).toThrow('sidebar changed')
    expect(() => store.mutateOrganization(state.revision, { kind: 'move', id: work, parentId: marketing })).toThrow(
      'cannot contain',
    )
    expect(() =>
      store.mutateOrganization(state.revision, { kind: 'assign', sessionId: '__proto__', groupId: marketing }),
    ).toThrow('identifier')
    store.close()
    const reopened = new AgentOsStore(root, cipher)
    expect(reopened.organization()).toEqual(state)
    const deleted = reopened.mutateOrganization(state.revision, { kind: 'delete', id: marketing })
    expect(deleted.assignments['chat-one']).toBe(work)
    expect(deleted.groups).toHaveLength(1)
    reopened.close()
  })
  it('saves only ciphertext and returns password-free inventory', () => {
    const { root, store } = setup()
    const password = 'do-not-persist-this-password-4262'
    const [item] = store.saveVault({
      name: 'Example',
      username: 'owner@example.test',
      origin: 'https://example.test/login',
      password,
    })
    expect(item?.origin).toBe('https://example.test')
    expect(JSON.stringify(store.vault())).not.toContain(password)
    expect(store.secret(`vault:${item!.id}`)).toBe(password)
    store.close()
    expect(readFileSync(join(root, 'agent-os.sqlite')).includes(Buffer.from(password))).toBe(false)
    const reopened = new AgentOsStore(root, cipher)
    reopened.removeVault(item!.id)
    expect(reopened.vault()).toEqual([])
    expect(reopened.secret(`vault:${item!.id}`)).toBeUndefined()
    reopened.close()
  })
  it('refuses lost memory edits and creates a portable reviewed skill', () => {
    const { root, store } = setup()
    const initial = store.memory()
    const saved = store.writeMemory('# Preferences\nUse concise English.\n', initial.revision)
    expect(saved.revision).not.toBe(initial.revision)
    expect(() => store.writeMemory('stale', initial.revision)).toThrow('changed elsewhere')
    expect(readFileSync(join(root, 'memory-history', `${initial.revision}.md`), 'utf8')).toBe(initial.text)
    store.saveRecording({
      id: 'recording-one',
      createdAt: 1,
      title: 'Publish video',
      steps: [{ action: 'change', url: 'https://example.test/', value: '{{caption}}', time: 1 }],
    })
    const path = store.saveSkill(
      'recording-one',
      'publish-video',
      'Open the destination. Fill {{caption}}. Review the post before publishing.',
    )
    expect(readFileSync(path, 'utf8')).toContain('name: publish-video')
    expect(() => store.saveSkill('recording-one', '../../outside', 'bad')).toThrow('skill-name')
    store.close()
  })
})
