/** Explicit BYOK preview distribution identity; it never inherits an upstream update service. */

/**
 * Validate the optional Strugend distribution selector.
 * @param {NodeJS.ProcessEnv} environment - File-owned release settings.
 * @returns {boolean} Whether this is the unsigned BYOK preview distribution.
 */
export function isStrugendPreviewDistribution(environment) {
  const distribution = environment.DSH_DESKTOP_DISTRIBUTION
  if (distribution === undefined) return false
  if (distribution !== 'strugend-preview') throw new Error('Unknown desktop distribution')
  if (environment.DSH_DESKTOP_APP_ID !== 'com.strugend.harness') {
    throw new Error('The preview distribution requires the separate com.strugend.harness application identity')
  }
  if (Object.keys(environment).some(name => /^(?:APPLE_|(?:WIN_)?CSC_(?:LINK|KEY_PASSWORD|NAME)$|DOWNLOAD_|DSH_DESKTOP_(?:AUTO_UPDATE_|MANDATORY_UPDATE_|WINDOWS_|MACOS_))/u.test(name))) {
    throw new Error('The preview distribution must not contain updater, upload, policy or signing settings')
  }
  return true
}
