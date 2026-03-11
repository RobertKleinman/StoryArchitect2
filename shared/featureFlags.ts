/**
 * Pure constants — no process.env. Safe for frontend import.
 * Backend reads env vars separately in backend/featureFlags.ts.
 */
export const DEFAULT_FEATURE_FLAGS = {
  HOOK_MODULE_ENABLED: true,
  CHARACTER_MODULE_ENABLED: true,
  CHARACTER_IMAGE_MODULE_ENABLED: true,
  WORLD_MODULE_ENABLED: true,
  PLOT_MODULE_ENABLED: true,
  SCENE_MODULE_ENABLED: true,
} as const;

export interface FeatureFlags {
  HOOK_MODULE_ENABLED: boolean;
  CHARACTER_MODULE_ENABLED: boolean;
  CHARACTER_IMAGE_MODULE_ENABLED: boolean;
  WORLD_MODULE_ENABLED: boolean;
  PLOT_MODULE_ENABLED: boolean;
  SCENE_MODULE_ENABLED: boolean;
}
