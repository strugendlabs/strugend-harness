/** Desktop-only configuration; shared CLI and server profiles retain their own defaults. */

/**
 * Build the application-owned overlay with a user-selectable access default.
 * @param credentialsPath - Built desktop credentials provider.
 * @param workspaceRoot - Fallback root for restricted sessions.
 * @param permissionMode - Explicit deployment override; Full access when omitted.
 * @returns Cordis patches consumed before any desktop session is created.
 */
export function agentOsProfilePatch(credentialsPath: string, workspaceRoot: string, permissionMode = 'danger-full-access') {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(permissionMode))
    throw new Error('DSH_PERMISSION_MODE must be read-only, workspace-write, or danger-full-access.')
  return [
    { id: 'credentials', name: credentialsPath, config: {} },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] } },
    { id: 'skill-badge', disabled: true },
    { id: 'agent-presets', config: { default: 'ptc' } },
    { id: 'system-prompt', config: { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: 'You are Strugend, the user’s coding and everyday-task assistant.' } },
    { id: 'llm-deepseek', config: { models: [
      { id: 'deepseek-flash', name: 'Core', inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history' },
      { id: 'deepseek-v4-flash-vision-exp', name: 'Vision', inputModalities: ['text', 'image'] },
    ] } },
    { id: 'sandbox-policy', config: { mode: permissionMode, workspaceRoot, includeHarnessName: false } },
    { id: 'approval', config: { policy: permissionMode === 'danger-full-access' ? 'never' : 'ask' } },
    { id: 'permission', config: {
      defaultPreset: permissionMode,
      presets: {
        'read-only': { sandbox: 'read-only', approval: 'ask' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      },
    } },
    { id: 'bash-sandbox', config: { timeoutMs: 300_000, maxTimeoutMs: 1_800_000 } },
    { id: 'pwsh-sandbox', config: { timeoutMs: 300_000, maxTimeoutMs: 1_800_000 } },
  ]
}
