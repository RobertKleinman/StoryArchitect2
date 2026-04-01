import { describe, it, expect } from "vitest";
import { runPackager } from "../packager";
import type {
  PipelineOutput,
  IdentifiedScene,
  IdentifiedLine,
  SceneEditResult,
} from "../types";

// ── Test Fixtures ──

function makeLine(overrides: Partial<IdentifiedLine> & { _lid: string; speaker: string; text: string }): IdentifiedLine {
  return {
    emotion: null,
    stage_direction: null,
    delivery: null,
    ...overrides,
  };
}

function makeScene(overrides: Partial<IdentifiedScene> & { scene_id: string }): IdentifiedScene {
  return {
    title: "Test Scene",
    setting: "A room",
    characters_present: ["Alice"],
    lines: [
      makeLine({ _lid: `${overrides.scene_id}_L000`, speaker: "Alice", text: "Hello." }),
      makeLine({ _lid: `${overrides.scene_id}_L001`, speaker: "NARRATION", text: "She waited." }),
    ],
    transition_out: "cut",
    ...overrides,
  };
}

function makeInput(overrides?: Partial<PipelineOutput>): PipelineOutput {
  return {
    premise: { hook_sentence: "A test story about testing things" },
    storyBible: {
      characters: {
        Alice: { description: "A test character", role: "Protagonist", presentation: "feminine" },
        Bob: { description: "Another character", role: "Supporting", presentation: "masculine" },
      },
      world: {
        arena: {
          locations: [
            { id: "room_1", name: "A Room", description: "An indoor space" },
            { id: "garden", name: "The Garden", description: "Outdoor area" },
          ],
        },
      },
    },
    scenes: [],
    ...overrides,
  };
}

function noEdits(): SceneEditResult[] {
  return [{ scene_id: "s01", status: "unchanged", diffs_applied: 0, diffs_rejected: 0, issues_addressed: [] }];
}

// ── Emotion Mapping Tests ──

describe("packager: emotion mapping", () => {
  it("maps exact matches from VNBuilder table", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [
        makeLine({ _lid: "s01_L000", speaker: "Alice", text: "Hi", emotion: "frustrated" }),
        makeLine({ _lid: "s01_L001", speaker: "Alice", text: "Ok", emotion: "hollow" }),
        makeLine({ _lid: "s01_L002", speaker: "Alice", text: "Hmm", emotion: "wry" }),
        makeLine({ _lid: "s01_L003", speaker: "Alice", text: "Yes", emotion: "warm" }),
        makeLine({ _lid: "s01_L004", speaker: "Alice", text: "Fine", emotion: "professional" }),
        makeLine({ _lid: "s01_L005", speaker: "Alice", text: "Sure", emotion: "calm" }),
      ],
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    const emotions = pkg!.scenes[0].lines.map(l => l.emotion);
    expect(emotions).toEqual(["angry", "sad", "amused", "warm", "formal", "calm"]);
  });

  it("maps fuzzy matches (substring-based)", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [
        makeLine({ _lid: "s01_L000", speaker: "Alice", text: "Hi", emotion: "controlled fraying" }),
        makeLine({ _lid: "s01_L001", speaker: "Alice", text: "Ok", emotion: "something complicated and dark" }),
        makeLine({ _lid: "s01_L002", speaker: "Alice", text: "Hmm", emotion: "very quiet" }),
      ],
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    const emotions = pkg!.scenes[0].lines.map(l => l.emotion);
    expect(emotions).toEqual(["tense", "tense", "calm"]);
  });

  it("defaults unknown emotions to neutral with warning in manifest", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [
        makeLine({ _lid: "s01_L000", speaker: "Alice", text: "Hi", emotion: "discombobulated" }),
      ],
    });
    const { pkg, manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    expect(pkg!.scenes[0].lines[0].emotion).toBe("neutral");
    expect(manifest.warnings.some(w => w.includes("discombobulated"))).toBe(true);
  });

  it("handles null/undefined emotions as neutral without warnings", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [
        makeLine({ _lid: "s01_L000", speaker: "Alice", text: "Hi", emotion: null }),
        makeLine({ _lid: "s01_L001", speaker: "Alice", text: "Ok", emotion: undefined }),
      ],
    });
    const { pkg, manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    expect(pkg!.scenes[0].lines[0].emotion).toBe("neutral");
    expect(pkg!.scenes[0].lines[1].emotion).toBe("neutral");
    // No warnings for null/undefined — only for unrecognized strings
    expect(manifest.warnings.filter(w => w.includes("Unmapped")).length).toBe(0);
  });
});

// ── Speaker Normalization Tests ──

describe("packager: speaker normalization", () => {
  it("resolves full character names", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [makeLine({ _lid: "s01_L000", speaker: "Alice", text: "Hi" })],
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.scenes[0].lines[0].speaker).toBe("Alice");
  });

  it("resolves uppercase speaker names", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [makeLine({ _lid: "s01_L000", speaker: "ALICE", text: "Hi" })],
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.scenes[0].lines[0].speaker).toBe("Alice");
  });

  it("preserves NARRATION and INTERNAL as-is", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [
        makeLine({ _lid: "s01_L000", speaker: "NARRATION", text: "Dawn broke." }),
        makeLine({ _lid: "s01_L001", speaker: "INTERNAL", text: "She thought about it." }),
      ],
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.scenes[0].lines[0].speaker).toBe("NARRATION");
    expect(pkg!.scenes[0].lines[1].speaker).toBe("INTERNAL");
  });

  it("errors on completely unknown speakers", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [makeLine({ _lid: "s01_L000", speaker: "MYSTERIOUS_STRANGER", text: "Boo" })],
    });
    const { manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(manifest.errors.some(e => e.includes("MYSTERIOUS_STRANGER"))).toBe(true);
    expect(manifest.package_status).toBe("failed");
  });
});

// ── Fail-Closed Tests ──

describe("packager: fail-closed behavior", () => {
  it("fails on empty scene lines", () => {
    const scene = makeScene({
      scene_id: "s01",
      lines: [makeLine({ _lid: "s01_L000", speaker: "Alice", text: "" })],
    });
    const { pkg, manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).toBeNull();
    expect(manifest.package_status).toBe("failed");
    expect(manifest.errors.some(e => e.includes("empty text"))).toBe(true);
  });

  it("fails on unfixed scenes without --force", () => {
    const scene = makeScene({ scene_id: "s01" });
    const edits: SceneEditResult[] = [{
      scene_id: "s01",
      status: "unfixed",
      diffs_applied: 0,
      diffs_rejected: 1,
      issues_addressed: ["Some issue"],
    }];
    const { pkg, manifest } = runPackager(makeInput(), [scene], edits);
    expect(pkg).toBeNull();
    expect(manifest.package_status).toBe("failed");
  });

  it("allows unfixed scenes with --force (degraded status)", () => {
    const scene = makeScene({ scene_id: "s01" });
    const edits: SceneEditResult[] = [{
      scene_id: "s01",
      status: "unfixed",
      diffs_applied: 0,
      diffs_rejected: 1,
      issues_addressed: ["Some issue"],
    }];
    const { pkg, manifest } = runPackager(makeInput(), [scene], edits, { forceUnfixed: true });
    expect(pkg).not.toBeNull();
    expect(manifest.package_status).toBe("degraded");
    expect(manifest.unfixed_scenes).toContain("s01");
  });

  it("succeeds when everything is clean", () => {
    const scene = makeScene({ scene_id: "s01" });
    const { pkg, manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    expect(manifest.package_status).toBe("success");
    expect(manifest.errors.length).toBe(0);
  });
});

// ── Output Schema Tests ──

describe("packager: output schema", () => {
  it("produces correct top-level VNPackage structure", () => {
    const scene = makeScene({ scene_id: "s01" });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg).not.toBeNull();
    expect(pkg!.title).toBe("A test story about testing things");
    expect(Object.keys(pkg!.characters)).toEqual(["Alice", "Bob"]);
    expect(pkg!.locations).toHaveLength(2);
    expect(pkg!.scenes).toHaveLength(1);
  });

  it("extracts character fields correctly", () => {
    const scene = makeScene({ scene_id: "s01" });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    const alice = pkg!.characters["Alice"];
    expect(alice.name).toBe("Alice");
    expect(alice.description).toBe("A test character");
    expect(alice.presentation).toBe("feminine");
    expect(alice.role).toBe("Protagonist");
  });

  it("extracts location fields correctly", () => {
    const scene = makeScene({ scene_id: "s01" });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.locations[0]).toEqual({ id: "room_1", name: "A Room", description: "An indoor space" });
  });

  it("normalizes setting object to string", () => {
    const scene = makeScene({
      scene_id: "s01",
      setting: { location: "The Garden", time: "morning" },
    });
    const { pkg } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.scenes[0].setting).toBe("The Garden");
  });

  it("defaults missing transition_out to 'cut' with warning", () => {
    const scene = makeScene({ scene_id: "s01", transition_out: "" });
    const { pkg, manifest } = runPackager(makeInput(), [scene], noEdits());
    expect(pkg!.scenes[0].transition_out).toBe("cut");
    expect(manifest.warnings.some(w => w.includes("transition_out"))).toBe(true);
  });

  it("truncates title to 60 chars", () => {
    const input = makeInput({
      premise: { hook_sentence: "A".repeat(100) },
    });
    const scene = makeScene({ scene_id: "s01" });
    const { pkg } = runPackager(input, [scene], noEdits());
    expect(pkg!.title.length).toBe(60);
  });

  it("manifest includes correct counts", () => {
    const scenes = [makeScene({ scene_id: "s01" }), makeScene({ scene_id: "s02" })];
    const edits = scenes.map(s => ({
      scene_id: s.scene_id, status: "unchanged" as const,
      diffs_applied: 0, diffs_rejected: 0, issues_addressed: [],
    }));
    const { manifest } = runPackager(makeInput(), scenes, edits);
    expect(manifest.version).toBe(1);
    expect(manifest.characters).toBe(2);
    expect(manifest.locations).toBe(2);
    expect(manifest.scenes).toBe(2);
    expect(manifest.total_lines).toBe(4); // 2 lines per scene
  });
});
