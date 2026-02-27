import { DEFAULT_FEATURE_FLAGS, FeatureFlags } from "../shared/featureFlags";

/** Runtime flags — reads env vars. Import only in backend code. */
export const FEATURE_FLAGS: FeatureFlags = {
  HOOK_MODULE_ENABLED:
    process.env.HOOK_MODULE_ENABLED !== undefined
      ? process.env.HOOK_MODULE_ENABLED !== "false"
      : DEFAULT_FEATURE_FLAGS.HOOK_MODULE_ENABLED,
};
