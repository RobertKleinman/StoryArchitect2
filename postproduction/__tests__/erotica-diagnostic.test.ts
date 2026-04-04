import { describe, it, expect } from "vitest";
import type { IdentifiedScene, IdentifiedLine, PipelineStoryBible } from "../types";
import { detect as detectDomCommands } from "../erotica/detectors/dom-commands";
import { detect as detectNicknameOveruse } from "../erotica/detectors/nickname-overuse";
import { detect as detectInternalTemplate } from "../erotica/detectors/internal-template";
import { detect as detectArcShape } from "../erotica/detectors/arc-shape";
import { detect as detectVulnerability } from "../erotica/detectors/vulnerability";
import { validateSceneRewrite } from "../erotica/content-validator";

// ── Test Fixtures ──

function makeLine(speaker: string, text: string, emotion = "", idx = 0, sceneId = "s1"): IdentifiedLine {
  return {
    speaker,
    text,
    emotion,
    stage_direction: null,
    delivery: null,
    _lid: `${sceneId}_L${String(idx).padStart(3, "0")}`,
  };
}

function makeScene(id: string, title: string, lines: IdentifiedLine[]): IdentifiedScene {
  return {
    scene_id: id,
    title,
    setting: "A room",
    characters_present: lines.map(l => l.speaker).filter(s => !["NARRATION", "INTERNAL"].includes(s.toUpperCase())),
    lines,
    transition_out: "cut",
  };
}

const eroticaBible: PipelineStoryBible = {
  characters: {
    "Commander Rex": {
      name: "Commander Rex",
      role: "antagonist",
      description: "A commanding, dominant officer who controls with calculated sadism",
    },
    "Kai": {
      name: "Kai",
      role: "protagonist",
      description: "A defiant captive torn between resistance and submission",
    },
  },
  world: { arena: { locations: [] } },
  relationships: [
    {
      between: ["Kai", "Commander Rex"],
      nature: "dominant-submissive captivity",
      stated_dynamic: "Commander enforces obedience",
    },
  ],
};

// ── Dom Command Detector ──

describe("dom command detector", () => {
  it("flags scenes where >50% of dom lines are short imperatives", () => {
    const lines = [
      makeLine("COMMANDER REX", "Kneel.", "commanding", 0),
      makeLine("KAI", "No way.", "defiant", 1),
      makeLine("COMMANDER REX", "Now.", "commanding", 2),
      makeLine("KAI", "Make me.", "defiant", 3),
      makeLine("COMMANDER REX", "Obey.", "commanding", 4),
      makeLine("COMMANDER REX", "Strip.", "commanding", 5),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectDomCommands([scene], eroticaBible);

    expect(result.metrics.total_dom_lines).toBe(4);
    expect(result.metrics.short_imperative_count).toBe(4);
    expect(result.flagged.length).toBe(4);
    expect(result.flagged.every(f => f.issue_type === "dom_command")).toBe(true);
  });

  it("does not flag varied dom speech", () => {
    const lines = [
      makeLine("COMMANDER REX", "You think that little show of defiance changes anything about your position here?", "mocking", 0),
      makeLine("KAI", "It might.", "defiant", 1),
      makeLine("COMMANDER REX", "Tell me, how does it feel knowing nobody is coming for you?", "probing", 2),
      makeLine("COMMANDER REX", "Kneel.", "commanding", 3),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectDomCommands([scene], eroticaBible);

    // Only 1/4 lines is a short imperative = 25%, under 50% threshold
    expect(result.flagged.length).toBe(0);
  });
});

// ── Nickname Overuse Detector ──

describe("nickname overuse detector", () => {
  it("flags when address rate exceeds 15%", () => {
    const lines = [
      makeLine("COMMANDER REX", "Listen, pet, you're not going anywhere.", "commanding", 0),
      makeLine("KAI", "Sure thing, sir.", "sarcastic", 1),
      makeLine("COMMANDER REX", "Good boy. Now kneel.", "satisfied", 2),
      makeLine("KAI", "Whatever you say, commander.", "bitter", 3),
      makeLine("COMMANDER REX", "That's right, pet.", "amused", 4),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectNicknameOveruse([scene], eroticaBible);

    expect(result.metrics.address_rate).toBeGreaterThan(0.15);
    expect(result.flagged.length).toBeGreaterThan(0);
  });

  it("does not flag character names as nicknames", () => {
    const lines = [
      makeLine("COMMANDER REX", "Kai, come here.", "commanding", 0),
      makeLine("KAI", "Rex, no.", "defiant", 1),
      makeLine("COMMANDER REX", "I said now.", "firm", 2),
      makeLine("KAI", "Fine.", "resigned", 3),
      makeLine("COMMANDER REX", "Good.", "satisfied", 4),
      makeLine("KAI", "Happy?", "bitter", 5),
      makeLine("COMMANDER REX", "Getting there.", "amused", 6),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectNicknameOveruse([scene], eroticaBible);

    // "Kai" and "Rex" are character names, not nicknames
    expect(result.metrics.address_rate).toBeLessThan(0.15);
    expect(result.flagged.length).toBe(0);
  });
});

// ── Internal Template Detector ──

describe("internal template detector", () => {
  it("flags lines matching the dominant template pattern", () => {
    const lines = [
      makeLine("INTERNAL", "*His boots. Salt and metal—can't look away.*", "conflicted", 0),
      makeLine("INTERNAL", "*That scent hits low in the gut. Why—why does it pull?*", "aroused", 1),
      makeLine("INTERNAL", "*Taste of leather. Sweat and musk—wrong, all wrong.*", "ashamed", 2),
      makeLine("INTERNAL", "*Heat off his skin. Close—too close for thought.*", "overwhelmed", 3),
      makeLine("INTERNAL", "This is simply a complete thought.", "calm", 4),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectInternalTemplate([scene]);

    // First 4 all have asterisk + body sensation, and some have interruption
    // Line 5 is plain — should not be flagged
    expect(result.metrics.template_uniformity_score).toBeGreaterThan(0.5);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.flagged.every(f => f.line_id !== "s1_L004")).toBe(true);
  });

  it("does not flag when templates are already varied", () => {
    const lines = [
      makeLine("INTERNAL", "*His boots hit the floor.*", "tense", 0),
      makeLine("INTERNAL", "No turning back now.", "resolved", 1),
      makeLine("INTERNAL", "What would it mean if—no. Focus.", "conflicted", 2),
      makeLine("INTERNAL", "Cold steel. Familiar somehow.", "calm", 3),
      makeLine("INTERNAL", "He's watching. They're all watching.", "paranoid", 4),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectInternalTemplate([scene]);

    // Only 1/5 has 2+ features — well under 40% threshold
    expect(result.flagged.length).toBe(0);
  });
});

// ── Arc Shape Detector ──

describe("arc shape detector", () => {
  it("classifies sub character emotion arcs", () => {
    const lines = [
      makeLine("KAI", "Screw you.", "defiant", 0),
      makeLine("KAI", "Get off me!", "resistant_anger", 1),
      makeLine("KAI", "I... fine.", "yielding", 2),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectArcShape([scene], eroticaBible);

    expect(result.metrics.arc_shapes.length).toBe(1);
    expect(result.metrics.arc_shapes[0].shape).toContain("defiant");
  });

  it("measures diversity across scenes", () => {
    const scene1 = makeScene("s1", "Scene 1", [
      makeLine("KAI", "No!", "defiant", 0, "s1"),
      makeLine("KAI", "Ugh, fine.", "yielding", 1, "s1"),
    ]);
    const scene2 = makeScene("s2", "Scene 2", [
      makeLine("KAI", "No!", "defiant", 0, "s2"),
      makeLine("KAI", "Stop it.", "yielding", 1, "s2"),
    ]);
    const scene3 = makeScene("s3", "Scene 3", [
      makeLine("KAI", "Please...", "vulnerable", 0, "s3"),
      makeLine("KAI", "I trust you.", "tender", 1, "s3"),
    ]);

    const result = detectArcShape([scene1, scene2, scene3], eroticaBible);

    // scene1 and scene2 have same shape, scene3 different
    expect(result.metrics.scene_count).toBe(3);
    expect(result.metrics.dominant_arc_frequency).toBe(2);
  });
});

// ── Vulnerability Detector ──

describe("vulnerability detector", () => {
  it("measures vulnerability rate correctly", () => {
    const lines = [
      makeLine("KAI", "Screw you!", "defiant", 0),
      makeLine("COMMANDER REX", "Kneel.", "commanding", 1),
      makeLine("KAI", "I'm scared.", "vulnerable", 2),
      makeLine("KAI", "Please don't stop.", "tender", 3),
      makeLine("COMMANDER REX", "Good.", "satisfied", 4),
    ];
    const scene = makeScene("s1", "Test", lines);
    const result = detectVulnerability([scene]);

    // 2 vulnerable out of 5 dialogue lines = 40%
    expect(result.metrics.vulnerable_line_count).toBe(2);
    expect(result.metrics.vulnerability_rate).toBeCloseTo(0.4, 1);
  });
});

// ── Content Preservation Validator (Scene-Level) ──

describe("scene content preservation validator", () => {
  const originalLines: IdentifiedLine[] = [
    makeLine("NARRATION", "The cell door slams shut behind them. Commander Rex stands at the center, boots planted wide.", "", 0),
    makeLine("COMMANDER REX", "Kneel and lick my boots clean, slave. Every ridge, every crease.", "commanding", 1),
    makeLine("KAI", "Make me, you bastard. I'd rather rot in this cell than give you the satisfaction.", "defiant", 2),
    makeLine("INTERNAL", "*His boots. The smell hits before they touch. Salt and leather.*", "conflicted", 3),
    makeLine("COMMANDER REX", "Now worship. Or we do this the hard way.", "commanding", 4),
  ];

  it("accepts rewrites that maintain word count", () => {
    const rewritten = [
      { speaker: "NARRATION", text: "The cell door slams shut. Commander Rex stands at the center, boots planted wide on the grate.", emotion: null },
      { speaker: "COMMANDER REX", text: "Kneel. Lick my boots clean — every ridge, every crease.", emotion: "commanding" },
      { speaker: "KAI", text: "I'd rather rot in this cell than give you that.", emotion: "defiant" },
      { speaker: "INTERNAL", text: "His boots. Salt and leather before they even touch.", emotion: "conflicted" },
      { speaker: "COMMANDER REX", text: "Worship. Or we do this the hard way.", emotion: "commanding" },
    ];
    const result = validateSceneRewrite(originalLines, rewritten);
    expect(result.valid).toBe(true);
  });

  it("rejects rewrites that shrink word count below 80%", () => {
    const rewritten = [
      { speaker: "COMMANDER REX", text: "Kneel.", emotion: "commanding" },
      { speaker: "KAI", text: "No.", emotion: "defiant" },
      { speaker: "COMMANDER REX", text: "Worship.", emotion: "commanding" },
    ];
    const result = validateSceneRewrite(originalLines, rewritten);
    expect(result.valid).toBe(false);
  });

  it("warns when explicit keywords are lost", () => {
    const rewritten = [
      { speaker: "NARRATION", text: "The cell door slams shut behind them. Commander Rex stands at the center, feet planted wide.", emotion: null },
      { speaker: "COMMANDER REX", text: "Get down on the ground and show respect to your superior right now.", emotion: "commanding" },
      { speaker: "KAI", text: "You'll have to force me, you arrogant fool. I'm not giving you anything.", emotion: "defiant" },
      { speaker: "INTERNAL", text: "His presence fills the room. Something sharp in the air.", emotion: "conflicted" },
      { speaker: "COMMANDER REX", text: "Show me what you've got. Prove your devotion to me.", emotion: "commanding" },
    ];
    const result = validateSceneRewrite(originalLines, rewritten);
    // "lick", "boots", "slave" are lost
    expect(result.reasons.some(r => r.includes("keywords lost"))).toBe(true);
  });

  it("warns when characters are missing from rewrite", () => {
    const rewritten = [
      { speaker: "NARRATION", text: "The cell door slams shut. Rex stands in the center of the room, boots planted wide.", emotion: null },
      { speaker: "COMMANDER REX", text: "Kneel and lick my boots clean, slave. Every ridge.", emotion: "commanding" },
      { speaker: "INTERNAL", text: "His boots. Salt and leather.", emotion: "conflicted" },
      { speaker: "COMMANDER REX", text: "Now worship. Or we do this the hard way.", emotion: "commanding" },
    ];
    const result = validateSceneRewrite(originalLines, rewritten);
    expect(result.reasons.some(r => r.includes("Characters missing"))).toBe(true);
  });
});
