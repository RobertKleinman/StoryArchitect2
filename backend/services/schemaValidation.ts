/**
 * Post-parse schema validation for fields where JSON schema enums
 * were removed due to Anthropic grammar compilation limits.
 *
 * Two tiers:
 * - Hard-fail: orchestration fields that branch logic. Invalid values
 *   cause a retry (throw SchemaViolationError).
 * - Soft-coerce: decorative fields. Invalid values get a warning log
 *   and are replaced with a safe default.
 */

// ── Hard-fail fields ──

export class SchemaViolationError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: string,
    public readonly allowed: readonly string[],
  ) {
    super(`Invalid ${field}: "${value}" — expected one of: ${allowed.join(", ")}`);
    this.name = "SchemaViolationError";
  }
}

const PRESENTATION_VALUES = [
  "male", "female", "androgynous", "non-binary", "unspecified",
] as const;

const PACING_TYPE_VALUES = [
  "slow_burn", "escalating", "explosive", "atmospheric", "rhythmic", "freefall",
] as const;

const COMPULSION_VECTOR_VALUES = [
  "unresolved_question", "forbidden_possibility", "identity_threat",
  "status_anxiety", "intimacy_threat", "moral_contamination",
  "anticipated_reversal", "withheld_answer", "dread_clock",
  "private_contradiction", "choice_regret_risk",
] as const;

/**
 * Validate a hard-fail field. Throws SchemaViolationError if invalid.
 * Use for fields that branch downstream logic (image gen, pacing, scene objective).
 */
export function validateHard<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new SchemaViolationError(fieldName, value ?? "(undefined)", allowed);
}

// ── Soft-coerce fields ──

const CONFLICT_PATTERN_VALUES = [
  "internal", "external", "relational", "institutional", "cosmic",
] as const;

const POWER_DYNAMIC_VALUES = [
  "dominance", "equality", "vulnerability", "reversal", "escalation",
] as const;

/**
 * Validate a soft-coerce field. Logs a warning and returns the default
 * if invalid. Use for decorative or inspiration-only fields.
 */
export function validateSoft<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fieldName: string,
  defaultValue: T,
  module: string = "VALIDATION",
): T {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  if (value) {
    console.warn(
      `[${module}] Soft-coercing ${fieldName}: "${value}" → "${defaultValue}" (expected: ${allowed.join(", ")})`,
    );
  }
  return defaultValue;
}

// ── Convenience validators ──

export function validatePresentation(value: string | undefined): string {
  return validateHard(value, PRESENTATION_VALUES, "presentation");
}

export function validatePacingType(value: string | undefined): string {
  return validateHard(value, PACING_TYPE_VALUES, "pacing_type");
}

export function validateCompulsionVector(value: string | undefined): string {
  return validateHard(value, COMPULSION_VECTOR_VALUES, "compulsion_vector");
}

export function validateConflictPattern(value: string | undefined): string {
  return validateSoft(value, CONFLICT_PATTERN_VALUES, "conflictPattern", "internal", "DIVERGENCE");
}

export function validatePowerDynamic(value: string | undefined): string {
  return validateSoft(value, POWER_DYNAMIC_VALUES, "powerDynamic", "equality", "DIVERGENCE");
}
