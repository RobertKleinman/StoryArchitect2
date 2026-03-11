import { DEFAULT_FEATURE_FLAGS, FeatureFlags } from "../shared/featureFlags";

/** Runtime flags — reads env vars. Import only in backend code. */
export const FEATURE_FLAGS: FeatureFlags = {
  HOOK_MODULE_ENABLED:
    process.env.HOOK_MODULE_ENABLED !== undefined
      ? process.env.HOOK_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.HOOK_MODULE_ENABLED,
  CHARACTER_MODULE_ENABLED:
    process.env.CHARACTER_MODULE_ENABLED !== undefined
      ? process.env.CHARACTER_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.CHARACTER_MODULE_ENABLED,
  CHARACTER_IMAGE_MODULE_ENABLED:
    process.env.CHARACTER_IMAGE_MODULE_ENABLED !== undefined
      ? process.env.CHARACTER_IMAGE_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.CHARACTER_IMAGE_MODULE_ENABLED,
  WORLD_MODULE_ENABLED:
    process.env.WORLD_MODULE_ENABLED !== undefined
      ? process.env.WORLD_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.WORLD_MODULE_ENABLED,
  PLOT_MODULE_ENABLED:
    process.env.PLOT_MODULE_ENABLED !== undefined
      ? process.env.PLOT_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.PLOT_MODULE_ENABLED,
  SCENE_MODULE_ENABLED:
    process.env.SCENE_MODULE_ENABLED !== undefined
      ? process.env.SCENE_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.SCENE_MODULE_ENABLED,
};
