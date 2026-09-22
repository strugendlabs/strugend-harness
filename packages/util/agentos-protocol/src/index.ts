/** Typed commands exchanged by the Agent OS desktop, its renderer, and its Harness host. */

/** One independently evaluated question accepted by the Decision runtime. */
export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

/** Exact non-secret auxiliary model input, logged before local or remote inference. */
export interface DecisionPayload {
  model: string
  state: string
  questions: Record<string, DecisionQuestion>
}

/** An organizational folder; placement never changes a chat's execution workspace. */
export interface ChatGroup {
  id: string
  parentId: string | null
  name: string
  order: number
  collapsed: boolean
}

/** Persisted sidebar organization, independently versioned from conversation history. */
export interface OrganizationState {
  revision: number
  groups: ChatGroup[]
  assignments: Record<string, string>
  pinned: string[]
}

/** Atomic sidebar mutation. */
export type OrganizationMutation =
  | { kind: 'create'; name: string; parentId: string | null }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'move'; id: string; parentId: string | null; beforeId?: string }
  | { kind: 'delete'; id: string }
  | { kind: 'collapse'; id: string; collapsed: boolean }
  | { kind: 'assign'; sessionId: string; groupId: string | null }
  | { kind: 'pin'; sessionId: string; pinned: boolean }

/** Browser position in application content coordinates, in CSS pixels. */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One user-visible browser tab; no cookie or secret values cross this interface. */
export interface DesktopBrowserState {
  tabId: string
  sessionId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  revision: number
  takenOver: boolean
  recording: boolean
  visible: boolean
  error?: string
}

/** Browser observations use fresh, opaque element references instead of executable selectors. */
export interface BrowserObservation {
  state: DesktopBrowserState
  text: string
  elements: Array<{ ref: string; role: string; name: string; value?: string }>
  /** Visible page dimensions in CSS pixels; screenshots may use a different device scale. */
  viewport: { width: number; height: number }
  screenshot?: string
}

/** Discovery is scoped to the tool's actual conversation owner. */
export interface BrowserTabList {
  tabs: DesktopBrowserState[]
}

/**
 * Browser tool operations are restricted to the requesting chat's own tab.
 * Point clicks use normalized viewport coordinates from 0 to 1 and a fresh revision.
 * Keys accept letters, digits, navigation keys, and Space, with optional holds of 0–1000 ms.
 */
export type BrowserAction =
  | { action: 'list' }
  | { action: 'open'; url: string; tabId?: string }
  | { action: 'observe'; tabId?: string; screenshot?: boolean }
  | { action: 'click'; tabId: string; ref: string; revision: number }
  | { action: 'click_point'; tabId: string; x: number; y: number; revision: number }
  | { action: 'fill'; tabId: string; ref: string; value: string; revision: number }
  | { action: 'upload'; tabId: string; ref: string; revision: number; paths: string[] }
  | { action: 'scroll'; tabId: string; direction: 'up' | 'down' }
  | { action: 'key'; tabId: string; key: string; holdMs?: number }
  | { action: 'back' | 'forward' | 'reload' | 'takeover' | 'resume'; tabId: string }

/** Safe vault inventory; plaintext values are never included. */
export interface VaultItem {
  id: string
  name: string
  username: string
  origin: string
  updatedAt: number
}

/** A recorded step, scrubbed at capture time. */
export interface RecordedStep {
  action: string
  url: string
  target?: string
  value?: string
  time: number
}

/** A local demonstration ready to review and convert into a skill. */
export interface Recording {
  id: string
  title: string
  createdAt: number
  steps: RecordedStep[]
  skillPath?: string
}

/** Imported footage or a playable video export. */
export interface MediaAsset {
  id: string
  name: string
  path: string
  url: string
  duration: number
  width: number
  height: number
  audio: boolean
  kind: 'input' | 'export'
  createdAt: number
}
/** A nondestructive edit recipe; originals are never overwritten. */
export interface VideoEdit {
  clips: Array<{ path: string; start?: number; end?: number }>
  format: 'portrait' | 'square' | 'landscape'
  fit?: 'cover' | 'contain'
  mute?: boolean
  musicPath?: string
  captions?: Array<{ start: number; end: number; text: string }>
  name?: string
}

/** Commands available only to the owned, top-level application renderer. */
export type AgentOsCommand =
  | { type: 'location.open'; path: string; reveal?: boolean }
  | { type: 'media.list' }
  | { type: 'media.import' }
  | { type: 'media.edit'; edit: VideoEdit }
  | { type: 'media.recipe'; assetId: string }
  | { type: 'media.cancel'; jobId: string }
  | { type: 'organization.read' }
  | { type: 'organization.mutate'; revision: number; mutation: OrganizationMutation }
  | { type: 'browser.mount'; sessionId: string; tabId: string; bounds: BrowserBounds; visible: boolean; url?: string }
  | { type: 'browser.hide'; tabId: string }
  | { type: 'browser.close'; tabId: string }
  | { type: 'browser.action'; sessionId: string; command: BrowserAction }
  | { type: 'browser.list'; sessionId: string }
  | { type: 'memory.read' }
  | { type: 'memory.write'; text: string; revision: string }
  | { type: 'vault.list' }
  | { type: 'vault.save'; entry: { id?: string; name: string; username: string; origin: string; password: string } }
  | { type: 'vault.remove'; id: string }
  | { type: 'vault.copy'; id: string }
  | { type: 'vault.fill'; id: string; sessionId: string; tabId: string }
  | { type: 'recording.start'; sessionId: string; tabId: string }
  | { type: 'recording.stop'; tabId: string }
  | { type: 'recording.list' }
  | { type: 'recording.saveSkill'; id: string; name: string; instructions: string }

/** Main-process notifications, containing only redacted application state. */
export type AgentOsEvent =
  | { type: 'media'; assets: MediaAsset[] }
  | { type: 'media.progress'; jobId: string; progress: number; name: string; error?: string }
  | { type: 'organization'; state: OrganizationState }
  | { type: 'browser'; state: DesktopBrowserState }
  | { type: 'browser.open'; sessionId: string; tabId: string; url: string }

/** Narrow preload API; never exposes raw IPC, filesystem, or JavaScript evaluation. */
export interface AgentOsDesktopApi {
  request(command: AgentOsCommand): Promise<unknown>
  subscribe(listener: (event: AgentOsEvent) => void): () => void
}

declare global {
  interface Window {
    agentOS?: AgentOsDesktopApi
  }
}
