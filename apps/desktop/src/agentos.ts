/** Installs Agent OS capabilities behind the owned desktop's narrow IPC surface. */
import { app, clipboard, dialog, ipcMain, safeStorage, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { extname, join } from 'node:path'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AgentOsCommand, AgentOsEvent, BrowserAction, VideoEdit } from '@deepseek-ai/dsh-agentos-protocol'
import { AgentOsMedia } from './agentos-media.ts'
import { AgentOsStore } from './agentos-store.ts'
import { AgentOsBrowser } from './agentos-browser.ts'
import { openLocation } from './strugend-location.ts'
import { AgentOsCrawler } from './agentos-crawler.ts'

/** Main-process feature composition; untrusted page renderers receive none of these APIs. */
export class AgentOsDesktop {
  readonly store: AgentOsStore
  readonly browser: AgentOsBrowser
  readonly media: AgentOsMedia
  private readonly crawler = new AgentOsCrawler()
  private clipboardTimer?: ReturnType<typeof setTimeout>
  private copiedPassword?: string

  /** @param root - Private application data. @param window - Owned window. @param assertSender - Top-level renderer authentication. */
  constructor(
    root: string,
    window: () => BrowserWindow | undefined,
    assertSender: (event: IpcMainInvokeEvent) => void,
  ) {
    this.store = new AgentOsStore(root, {
      encrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('System credential encryption is unavailable. Sign in to your desktop session and try again.')
        return safeStorage.encryptString(value)
      },
      decrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('System credential encryption is unavailable. Sign in to your desktop session and try again.')
        return safeStorage.decryptString(value)
      },
    })
    const emit = (event: AgentOsEvent): void => {
      const target = window()
      if (target !== undefined && !target.isDestroyed()) target.webContents.send('agent-os:event', event)
    }
    this.media = new AgentOsMedia(join(root, 'media'), this.store, emit)
    this.browser = new AgentOsBrowser(window, emit, this.store)
    const skillRoot = join(root, 'skills')
    const bundledSkills = app.isPackaged ? join(process.resourcesPath, 'agent-os-skills')
      : fileURLToPath(new URL('../resources/agent-os-skills', import.meta.url))
    mkdirSync(skillRoot, { recursive: true, mode: 0o700 })
    if (existsSync(bundledSkills)) {
      for (const entry of readdirSync(bundledSkills, { withFileTypes: true })) {
        const destination = join(skillRoot, entry.name)
        if (entry.isDirectory() && !existsSync(destination))
          cpSync(join(bundledSkills, entry.name), destination, { recursive: true, errorOnExist: true, force: false })
      }
    }
    ipcMain.handle('agent-os:request', async (event, input: unknown) => {
      assertSender(event)
      if (typeof input !== 'object' || input === null || !('type' in input)) throw new Error('Invalid desktop command.')
      const command = input as AgentOsCommand
      switch (command.type) {
        case 'location.open':
          return openLocation(command, shell)
        case 'media.list':
          return this.media.list()
        case 'media.import': {
          const target = window()
          if (target === undefined) throw new Error('Open the application window.')
          const selected = await dialog.showOpenDialog(target, {
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }],
          })
          return selected.canceled ? this.media.list() : this.media.import(selected.filePaths)
        }
        case 'media.edit':
          return this.media.edit(command.edit)
        case 'media.recipe':
          return this.media.recipe(command.assetId)
        case 'media.cancel':
          this.media.cancel(command.jobId)
          return null
        case 'organization.read':
          return this.store.organization()
        case 'organization.mutate': {
          const state = this.store.mutateOrganization(command.revision, command.mutation)
          emit({ type: 'organization', state })
          return state
        }
        case 'browser.mount':
          return this.browser.mount(command.sessionId, command.tabId, command.bounds, command.visible, command.url)
        case 'browser.hide': {
          this.browser.hide(command.tabId)
          return
        }
        case 'browser.close': {
          this.browser.close(command.tabId)
          return
        }
        case 'browser.list':
          return this.browser.list(command.sessionId)
        case 'browser.action': {
          if (command.command.action === 'upload') {
            const paths = await Promise.all(command.command.paths.map(path => this.media.admit(path)))
            return this.browser.upload(command.sessionId, { ...command.command, paths })
          }
          return this.browser.act(command.sessionId, command.command, true)
        }
        case 'memory.read':
          return this.store.memory()
        case 'memory.write':
          return this.store.writeMemory(command.text, command.revision)
        case 'vault.list':
          return this.store.vault()
        case 'vault.save':
          return this.store.saveVault(command.entry)
        case 'vault.remove':
          this.store.removeVault(command.id)
          return this.store.vault()
        case 'vault.copy': {
          const value = this.store.secret(`vault:${command.id}`)
          if (value === undefined) throw new Error('Login not found.')
          await clipboard.writeText(value)
          this.copiedPassword = value
          clearTimeout(this.clipboardTimer)
          this.clipboardTimer = setTimeout(() => {
            void clipboard.readText().then((current) => {
              if (current === value) clipboard.clear()
            })
          }, 30_000)
          return { copied: true }
        }
        case 'vault.fill': {
          const entry = this.store.vault().find(item => item.id === command.id)
          const value = this.store.secret(`vault:${command.id}`)
          if (entry === undefined || value === undefined) throw new Error('Login not found.')
          await this.browser.fillCredential(command.sessionId, command.tabId, entry.origin, entry.username, value)
          return { filled: true }
        }
        case 'recording.start':
          return this.browser.startRecording(command.sessionId, command.tabId)
        case 'recording.stop':
          return this.browser.stopRecording(command.tabId)
        case 'recording.list':
          return this.store.recordings()
        case 'recording.saveSkill':
          return { path: this.store.saveSkill(command.id, command.name, command.instructions) }
        default:
          throw new Error('Unknown desktop command.')
      }
    })
  }

  /** Handle private requests from the trusted Harness process, not page or tool-supplied JavaScript. */
  async hostRequest(input: unknown, signal?: AbortSignal): Promise<unknown> {
    if (typeof input !== 'object' || input === null || !('method' in input)) throw new Error('Invalid host operation.')
    const request = input as {
      method: string
      operation?: string
      sessionId?: string
      command?: BrowserAction
      key?: string
      value?: string
      workspace?: string
      edit?: VideoEdit
      id?: string
      name?: string
      instructions?: string
      crawl?: unknown
    }
    if (request.method === 'crawl') return this.crawler.run(request.crawl, signal)
    if (request.method === 'recordings') return this.store.recordings()
    if (
      request.method === 'skill-save' &&
      typeof request.id === 'string' &&
      typeof request.name === 'string' &&
      typeof request.instructions === 'string'
    )
      return { path: this.store.saveSkill(request.id, request.name, request.instructions) }
    if (request.method === 'media' && request.edit !== undefined)
      return this.media.edit(request.edit, request.workspace, signal)
    if (request.method === 'media-list') return this.media.list()
    if (request.method === 'browser' && typeof request.sessionId === 'string' && request.command !== undefined) {
      if (request.command.action === 'upload') {
        if (
          !Array.isArray(request.command.paths) ||
          request.command.paths.length < 1 ||
          request.command.paths.length > 10
        )
          throw new Error('Choose between 1 and 10 upload files.')
        const paths = await Promise.all(
          request.command.paths.map(async (path) => {
            if (
              !['.mp4', '.mov', '.webm', '.m4v', '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.docx'].includes(
                extname(path).toLowerCase(),
              )
            )
              throw new Error('This upload type is not supported.')
            return this.media.admit(path, request.workspace)
          }),
        )
        return this.browser.upload(request.sessionId, { ...request.command, paths }, signal)
      }
      return this.browser.act(request.sessionId, request.command, false, signal)
    }
    if (request.method === 'memory') return this.store.memory()
    if (request.method === 'skill-root') return join(this.store.memory().path, '..', 'skills')
    if (
      request.method === 'credential' &&
      typeof request.key === 'string' &&
      /^[A-Za-z_][\w/-]{0,200}$/u.test(request.key)
    ) {
      const key = `provider:${request.key}`
      if (request.operation === 'get') return this.store.secret(key) ?? null
      if (request.operation === 'set' && typeof request.value === 'string' && request.value.length <= 100_000) {
        this.store.setSecret(key, request.value)
        return null
      }
      if (request.operation === 'delete') {
        this.store.setSecret(key, undefined)
        return null
      }
    }
    throw new Error('Unsupported host operation.')
  }

  /** Dispose input surfaces before releasing persisted metadata. */
  async dispose(): Promise<void> {
    clearTimeout(this.clipboardTimer)
    ipcMain.removeHandler('agent-os:request')
    await this.crawler.dispose()
    await this.media.dispose()
    if (this.copiedPassword !== undefined && (await clipboard.readText()) === this.copiedPassword) clipboard.clear()
    this.browser.dispose()
    this.store.close()
  }
}
