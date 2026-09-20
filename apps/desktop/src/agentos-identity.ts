/** Distinguish an explicitly configured local model endpoint from the normal desktop app. */

/** @param endpoint - Inherited provider override. @returns Native app name and Dock badge. */
export function agentOsIdentity(endpoint: string | undefined): { name: string; badge: string } {
  let local = false
  if (endpoint) {
    try {
      const host = new URL(endpoint).hostname
      local = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./u.test(host)
    } catch {
      // Provider configuration owns invalid endpoint reporting.
    }
  }
  return local ? { name: 'Strugend Harness (Local API)', badge: 'LOCAL' } : { name: 'Strugend Harness', badge: '' }
}
