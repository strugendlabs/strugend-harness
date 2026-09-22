/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** Durable opt-out for automatic provider setup; manual Connections remains available. */
export const PROVIDER_SETUP_ACK_FIELD = 'providerSetupDeferredVersion'

/** Version of the provider setup choice; unrelated to welcome notice copy. */
export const PROVIDER_SETUP_VERSION = '1'
