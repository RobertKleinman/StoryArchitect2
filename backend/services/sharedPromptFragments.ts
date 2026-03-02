/**
 * SHARED PROMPT FRAGMENTS — RE-EXPORT BARREL
 * =============================================
 * This file now re-exports from the two layer-specific files:
 *   - generalPromptFragments.ts  → General layer (interaction, classification, engagement)
 *   - psychologyPromptFragments.ts → Psychology layer (hypotheses, non-actions, assumptions)
 *
 * Module prompt files (hookPrompts.ts, characterPrompts.ts) should import directly
 * from the layer file they need. This barrel exists for backward compatibility
 * and can be removed once all imports are updated.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  LAYER ARCHITECTURE                                         │
 * │                                                             │
 * │  generalPromptFragments.ts   ← HOW to interact with users  │
 * │  psychologyPromptFragments.ts ← HOW to understand users    │
 * │  hookPrompts.ts              ← WHAT to ask (hook module)   │
 * │  characterPrompts.ts         ← WHAT to ask (char module)   │
 * │                                                             │
 * │  Composition: General + Psychology + Module = LLM Prompt    │
 * └─────────────────────────────────────────────────────────────┘
 */

// ═══ GENERAL LAYER ═══
export {
  SHARED_INTERACTION_STYLE_ADAPTATION,
  SHARED_USER_BEHAVIOR_CLASSIFICATION,
  SHARED_FREE_FORM_CHECKIN,
} from "./generalPromptFragments";

// ═══ PSYCHOLOGY LAYER ═══
export {
  SHARED_USER_READ_INSTRUCTIONS,
  SHARED_NON_ACTION_READING,
  SHARED_PSYCHOLOGY_ASSUMPTIONS,
} from "./psychologyPromptFragments";
