import { describe, it, expect } from "vitest";
import { runStructuralScan } from "../pass1-structural";
import type { PipelineOutput, VNScene, VNLine } from "../types";

// ── Test Fixtures ──

function makeLine(overrides?: Partial<VNLine>): VNLine {
  return {
    speaker: "Alice",
    text: "Hello there.",
    emotion: null,
    stage_direction: null,
    delivery: null,
    ...overrides,
  };
}

function makeVNScene(overrides?: Partial<VNScene>): VNScene {
  return {
    scene_id: "scene_01",
    title: "Test Scene",
    setting: "A room",
    characters_present: ["Alice"],
    pov_character: "Alice",
    lines: [makeLine()],
    transition_out: "cut",
    ...overrides,
  };
}

function makeInput(vnScenes: VNScene[], characters?: Record<string, any>): PipelineOutput {
  return {
    premise: { hook_sentence: "A test story." },
    storyBible: {
      characters: characters ?? { Alice: { description: "Test char", role: "Protagonist" } },
      world: {
        arena: {
          locations: [{ id: "room", name: "A Room", description: "Indoor space" }],
        },
      },
    },
    scenes: vnScenes.map(vn => ({ vn_scene: vn })),
  };
}

// ── Truncation Detection ──

describe("pass1: truncation detection", () => {
  it("flags text ending mid-word (short trailing word)", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: "She walked toward the do" })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const truncations = report.issues.filter(i => i.category === "truncation");
    expect(truncations.length).toBeGreaterThan(0);
  });

  it("does not flag text ending with punctuation", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: "She walked toward the door." })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const truncations = report.issues.filter(i => i.category === "truncation");
    expect(truncations.length).toBe(0);
  });

  it("does not flag text ending with em-dash", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: "She walked toward the door—" })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const truncations = report.issues.filter(i => i.category === "truncation");
    expect(truncations.length).toBe(0);
  });

  it("flags unclosed double quotes", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: 'She said "hello' })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const truncations = report.issues.filter(i => i.category === "truncation" && i.message.includes("Unclosed"));
    expect(truncations.length).toBe(1);
  });

  it("does not flag balanced quotes", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: 'She said "hello" and left.' })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const truncations = report.issues.filter(i => i.message.includes("Unclosed"));
    expect(truncations.length).toBe(0);
  });
});

// ── Line Length ──

describe("pass1: VN compatibility — line length", () => {
  it("flags lines over 200 characters", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: "A".repeat(250) })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const long = report.issues.filter(i => i.category === "vn_compatibility" && i.message.includes("chars"));
    expect(long.length).toBe(1);
    expect(long[0].auto_fixable).toBe(true);
  });

  it("does not flag lines under 200 characters", () => {
    const scene = makeVNScene({
      lines: [makeLine({ text: "A".repeat(100) })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const long = report.issues.filter(i => i.category === "vn_compatibility" && i.message.includes("chars"));
    expect(long.length).toBe(0);
  });
});

// ── Speaker Validation ──

describe("pass1: speaker validation", () => {
  it("accepts known speakers", () => {
    const scene = makeVNScene({
      lines: [makeLine({ speaker: "Alice", text: "Hello." })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const unknown = report.issues.filter(i => i.message.includes("Unknown speaker"));
    expect(unknown.length).toBe(0);
  });

  it("flags unknown speakers", () => {
    const scene = makeVNScene({
      lines: [makeLine({ speaker: "GANDALF", text: "You shall not pass." })],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const unknown = report.issues.filter(i => i.message.includes("Unknown speaker"));
    expect(unknown.length).toBe(1);
  });

  it("accepts NARRATION and INTERNAL as special speakers", () => {
    const scene = makeVNScene({
      lines: [
        makeLine({ speaker: "NARRATION", text: "Dawn broke." }),
        makeLine({ speaker: "INTERNAL", text: "She pondered." }),
      ],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const unknown = report.issues.filter(i => i.message.includes("Unknown speaker"));
    expect(unknown.length).toBe(0);
  });
});

// ── Empty / Duplicate Detection ──

describe("pass1: scene quality checks", () => {
  it("flags scenes with fewer than 3 lines", () => {
    const scene = makeVNScene({
      lines: [makeLine()],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const short = report.issues.filter(i => i.message.includes("only 1 line"));
    expect(short.length).toBe(1);
  });

  it("flags duplicate consecutive lines", () => {
    const scene = makeVNScene({
      lines: [
        makeLine({ text: "This is a long enough line to trigger duplicate detection." }),
        makeLine({ text: "This is a long enough line to trigger duplicate detection." }),
      ],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const dupes = report.issues.filter(i => i.message.includes("Duplicate"));
    expect(dupes.length).toBe(1);
  });

  it("does not flag different consecutive lines", () => {
    const scene = makeVNScene({
      lines: [
        makeLine({ text: "First line of dialogue here." }),
        makeLine({ text: "Second line of dialogue here." }),
      ],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const dupes = report.issues.filter(i => i.message.includes("Duplicate"));
    expect(dupes.length).toBe(0);
  });

  it("flags missing transition_out", () => {
    const scene = makeVNScene({ transition_out: "" });
    const { report } = runStructuralScan(makeInput([scene]));
    const missing = report.issues.filter(i => i.message.includes("transition_out"));
    expect(missing.length).toBe(1);
  });

  it("flags all-narration scenes", () => {
    const scene = makeVNScene({
      lines: [
        makeLine({ speaker: "NARRATION", text: "Line one." }),
        makeLine({ speaker: "NARRATION", text: "Line two." }),
        makeLine({ speaker: "NARRATION", text: "Line three." }),
      ],
    });
    const { report } = runStructuralScan(makeInput([scene]));
    const narr = report.issues.filter(i => i.message.includes("no dialogue"));
    expect(narr.length).toBe(1);
  });
});

// ── Stable Line IDs ──

describe("pass1: stable line ID assignment", () => {
  it("assigns unique _lid to every line", () => {
    const scene = makeVNScene({
      scene_id: "s01",
      lines: [
        makeLine({ text: "One." }),
        makeLine({ text: "Two." }),
        makeLine({ text: "Three." }),
      ],
    });
    const { scenes } = runStructuralScan(makeInput([scene]));
    const lids = scenes[0].lines.map(l => l._lid);
    expect(lids).toEqual(["s01_L000", "s01_L001", "s01_L002"]);
    expect(new Set(lids).size).toBe(3);
  });

  it("prefixes line IDs with scene_id", () => {
    const scene = makeVNScene({ scene_id: "scene_07" });
    const { scenes } = runStructuralScan(makeInput([scene]));
    expect(scenes[0].lines[0]._lid.startsWith("scene_07_")).toBe(true);
  });
});

// ── Consecutive Narration ──

describe("pass1: consecutive narration blocks", () => {
  it("flags more than 5 consecutive narration lines", () => {
    const lines = Array.from({ length: 7 }, (_, i) =>
      makeLine({ speaker: "NARRATION", text: `Narration line ${i + 1}.` })
    );
    const scene = makeVNScene({ lines });
    const { report } = runStructuralScan(makeInput([scene]));
    const narr = report.issues.filter(i => i.message.includes("consecutive narration"));
    expect(narr.length).toBeGreaterThan(0);
  });

  it("does not flag 5 or fewer consecutive narration lines", () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLine({ speaker: "NARRATION", text: `Narration line ${i + 1}.` })
    );
    const scene = makeVNScene({ lines });
    const { report } = runStructuralScan(makeInput([scene]));
    const narr = report.issues.filter(i => i.message.includes("consecutive narration"));
    expect(narr.length).toBe(0);
  });
});
