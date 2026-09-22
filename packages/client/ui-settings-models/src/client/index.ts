/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * provider editing or desktop Intelligence settings and ordered onboarding
 * dialogs, whose UI shares this package's modal wrapper. The Host
 * settings and credential contracts stay behind their existing wire APIs.
 * Export discipline:
 * packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { DeepSeekOnboardingDialog } from './DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingInjected } from './DeepSeekOnboardingDialog.tsx'
import { ProviderOnboardingDialog, type ProviderOnboardingInjected } from './ProviderOnboardingDialog.tsx'
import { WelcomeNotice } from './WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from './WelcomeNotice.tsx'
import { decodeWelcomeSection, WelcomeNoticeStore } from './welcome-store.ts'
import { ModelsSettingsStore } from './store.ts'
import { createModelsOperations } from './operations.ts'
import { createSettingsSchemaOperations } from './schema-operations.ts'
import { en, zh, type ModelsKey } from './locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE, PROVIDER_SETUP_ACK_FIELD, PROVIDER_SETUP_VERSION } from '../onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type { ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps } from './slot-contract.ts'
export type { ModelsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy. */
    'settings.models': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'
export type {
  ModelsSettingsState, ProviderDirectoryEntry, ProviderRow,
} from './store.ts'
export type { ModelDiscoveryOutcome, ModelsOperations, SettingsWriteOutcome } from './operations.ts'

/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings',
  'settingsScope', 'settingsSchema', 'remote.session',
]

/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-models: copy dictionaries')

  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  // Bound once here, where the Remote namespaces are declared in this plugin's
  // own `inject`; the cards receive callbacks and never a context.
  const operations = createModelsOperations(ctx)
  const controller = new ModelsSettingsStore(ctx, schema, ctx.settingsScope.describe())
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const intelligence: ModelsSectionInjected['intelligence'] = typeof window !== 'undefined' && 'agentOS' in window ? {
    testConnection: async (provider) => {
      const response = await fetch(provider === 'decision' ? '/api/strugend/decision/test' : `/api/strugend/connections/${provider}`, { method: 'POST' })
      if (!response.ok) throw new Error('Connection test failed.')
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('available' in value) || typeof value.available !== 'boolean'
        || ('reason' in value && typeof value.reason !== 'string')) throw new Error('Invalid connection result.')
      return { available: value.available, ...('reason' in value ? { reason: value.reason as string } : {}) }
    },
    load: async () => {
      const response = await ctx.remote.settings.describe()
      if (!response.ok) throw new Error(response.error.message)
      const service = response.value.namespaces.find(row => row.ns === 'strugend-intelligence')
      const credentials = await ctx.remote.credentials.describe(['IMPOSSIBL_API_KEY', 'STRUGEND_GITHUB_TOKEN', 'STRUGEND_VERCEL_TOKEN'])
      const graphUrl = service === undefined ? undefined : schema.getPath(service.value, ['graphUrl'])
      if (!service || !credentials.ok || typeof graphUrl !== 'string') throw new Error('Intelligence settings are unavailable.')
      const decisionMode = schema.getPath(service.value, ['decisionMode'])
      if (decisionMode !== 'local' && decisionMode !== 'auto' && decisionMode !== 'remote') throw new Error('Invalid Decision runtime.')
      const adviceMode = schema.getPath(service.value, ['adviceMode'])
      if (adviceMode !== 'observe' && adviceMode !== 'assist') throw new Error('Invalid Decision advice mode.')
      const runtimeResponse = await fetch('/api/strugend/decision/runtime')
      if (!runtimeResponse.ok) throw new Error('Decision resource information is unavailable.')
      const runtime: unknown = await runtimeResponse.json()
      if (!runtime || typeof runtime !== 'object' || !('localAllowed' in runtime) || typeof runtime.localAllowed !== 'boolean'
        || !('reason' in runtime) || typeof runtime.reason !== 'string'
        || !('enabled' in runtime) || typeof runtime.enabled !== 'boolean'
        || !('installed' in runtime) || typeof runtime.installed !== 'boolean'
        || !('available' in runtime) || typeof runtime.available !== 'boolean') throw new Error('Invalid Decision resource information.')
      return { enabled: runtime.enabled, installed: runtime.installed, available: runtime.available,
        graphUrl, decisionMode, adviceMode, localAllowed: runtime.localAllowed, localReason: runtime.reason,
        revision: service.revision, credentials: credentials.value }
    },
  } : undefined
  const injected = (): ModelsSectionInjected => ({
    ...(intelligence === undefined ? {} : { intelligence }),
    controller,
    hooks: { snapshot: controller.store },
    operations,
    schema,
    t,
  })
  const deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
    controller,
    hooks: { models: controller.store },
    operations,
    schema,
    t,
  })
  const providerSetupController = new WelcomeNoticeStore(ctx.settingsScope.bind({
    namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    decode: decodeWelcomeSection,
  }), { field: PROVIDER_SETUP_ACK_FIELD, version: PROVIDER_SETUP_VERSION })
  const providerOnboardingInjected = (): ProviderOnboardingInjected => ({
    ...deepSeekOnboardingInjected(),
    setupController: providerSetupController,
    hooks: { models: controller.store, providerSetup: providerSetupController.store },
    models: async (provider) => {
      const result = await ctx.remote.session.modelCatalog()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.groups.find(row => row.id === provider)?.models.map(row => ({ id: row.id, name: row.name })) ?? []
    },
    select: async (provider, model) => {
      const current = await ctx.remote.settings.describe()
      if (!current.ok) throw new Error(current.error.message)
      const namespace = current.value.namespaces.find(row => row.ns === 'agent-default-model')
      if (!namespace) throw new Error('Default model settings are unavailable.')
      const result = await operations.writeSettings('agent-default-model', [
        { op: 'set', path: ['provider'], value: provider },
        { op: 'set', path: ['model'], value: model },
        { op: 'unset', path: ['reasoningEffort'] },
      ], namespace.revision)
      if (result.kind !== 'written') throw new Error(result.message)
    },
  })
  // The scope's own memory mode is what keeps a remote browser process-local,
  // so the store needs no isLoopback branch of its own.
  const welcomeController = new WelcomeNoticeStore(ctx.settingsScope.bind({
    namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    decode: decodeWelcomeSection,
  }))
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    agentOs: typeof window !== 'undefined' && 'agentOS' in window,
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })

  // Pushed invalidations converge every open surface without polling. The
  // settingsScope injection makes ui-settings activate first, and remote
  // dispatch preserves listener order; its listener therefore starts the
  // mirror refresh before this store joins that refresh. The welcome notice
  // follows its settings scope, so it needs no subscription here.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
      ctx.remote.$on('credentials/reference-updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => {
      welcomeController.dispose()
      providerSetupController.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-models: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
    children: {
      'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
      'settings.models.footer': { kind: 'list', scope: 'root' },
    },
  }, ModelsSection))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  if (process.env.DSH_CLIENT_TITLE === 'Strugend Harness') ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'provider-connection', order: 0, inject: providerOnboardingInjected,
  }, ProviderOnboardingDialog))
  else ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    order: 0,
    inject: deepSeekOnboardingInjected,
  }, DeepSeekOnboardingDialog))
}
