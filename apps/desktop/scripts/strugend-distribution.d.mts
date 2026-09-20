/** Explicit Strugend preview release configuration. */
/**
 * Validate the optional preview selector and reject inherited publisher services.
 * @param environment File-owned release settings.
 * @returns Whether this is an unsigned Strugend BYOK preview.
 */
export function isStrugendPreviewDistribution(environment: NodeJS.ProcessEnv): boolean
