/**
 * Schema versioning + migration-on-load.
 *
 * CURRENT_SCHEMA_VERSION = 2
 *
 * Each migration function takes a raw parsed session object and mutates it in place.
 * Migrations run sequentially: v1→v2, v2→v3, etc.
 *
 * Modules call `migrateSession(raw, moduleName)` in their store's `get()`.
 * If the session was migrated, the store should re-save it.
 */

export const CURRENT_SCHEMA_VERSION = 2;

type ModuleName = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

type MigrationFn = (session: any, module: ModuleName) => boolean; // returns true if changed

/**
 * Migration registry: key is the target version.
 * E.g., migrations[2] runs when upgrading from version 1 to version 2.
 */
const migrations: Record<number, MigrationFn> = {
  2: migrateV1toV2,
};

/**
 * Run all necessary migrations on a raw session object.
 * Returns true if any migrations were applied (caller should re-save).
 */
export function migrateSession(session: any, module: ModuleName): boolean {
  if (!session || typeof session !== "object") return false;

  const startVersion = session.schemaVersion ?? 1;
  if (startVersion >= CURRENT_SCHEMA_VERSION) return false;

  let changed = false;
  for (let v = startVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const fn = migrations[v];
    if (fn) {
      const applied = fn(session, module);
      if (applied) {
        console.log(`[migrations] ${module} ${session.projectId}: v${v - 1}→v${v}`);
        changed = true;
      }
    }
  }

  session.schemaVersion = CURRENT_SCHEMA_VERSION;
  return changed || startVersion < CURRENT_SCHEMA_VERSION;
}

// ── v1 → v2 ─────────────────────────────────────────────────────────
// Populate missing `presentation` and `age_range` on character data.

function migrateV1toV2(session: any, module: ModuleName): boolean {
  let changed = false;

  if (module === "character") {
    // CharacterSessionState: fix revealedCharacters and locked pack characters
    const targets = [
      session.revealedCharacters?.characters,
      session.characterPack?.locked?.characters,
    ].filter(Boolean);

    for (const chars of targets) {
      if (typeof chars === "object") {
        for (const char of Object.values(chars) as any[]) {
          if (!char.presentation) {
            char.presentation = "unspecified";
            changed = true;
          }
          if (!char.age_range) {
            char.age_range = "unspecified";
            changed = true;
          }
        }
      }
    }
  }

  if (module === "character_image") {
    // CharacterImageSessionState: fix sourceCharacterPack.locked.characters
    const chars = session.sourceCharacterPack?.locked?.characters;
    if (typeof chars === "object") {
      for (const char of Object.values(chars) as any[]) {
        if (!char.presentation) {
          char.presentation = "unspecified";
          changed = true;
        }
        if (!char.age_range) {
          char.age_range = "unspecified";
          changed = true;
        }
      }
    }
  }

  // World/Plot/Scene sessions carry sourceCharacterPack or sourceCharacterImagePack
  if (["world", "plot", "scene"].includes(module)) {
    for (const packKey of ["sourceCharacterPack", "sourceCharacterImagePack"]) {
      const chars = session[packKey]?.locked?.characters;
      if (typeof chars === "object") {
        for (const char of Object.values(chars) as any[]) {
          if (!char.presentation) {
            char.presentation = "unspecified";
            changed = true;
          }
          if (!char.age_range) {
            char.age_range = "unspecified";
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}
