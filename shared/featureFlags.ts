/**
 * Pure constants — no process.env. Safe for frontend import.
 * Backend reads env vars separately in backend/featureFlags.ts.
 */
export const DEFAULT_FEATURE_FLAGS = {
  HOOK_MODULE_ENABLED: true,
  CHARACTER_MODULE_ENABLED: true,
} as const;

export interface FeatureFlags {
  HOOK_MODULE_ENABLED: boolean;
  CHARACTER_MODULE_ENABLED: boolean;
}
