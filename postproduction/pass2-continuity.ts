/**
 * PASS 2 — CONTINUITY READ (DUAL-MODEL)
 * ══════════════════════════════════════
 * Parallel continuity read with Sonnet + GPT for higher recall.
 * 3 fixable dimensions: seed compliance, continuity errors, voice drift.
 * Findings are merged: both-flagged = high confidence, single-model major = auto-fix,
 * single-model minor = report-only.
 * Continuity ledger comes from the primary (Sonnet) model.
 */

import "dotenv/config";
import type {
  IdentifiedScene,
  PipelineOutput,
  EditorialFinding,
  EditorialReport,
  ContinuityLedger,
  PostproductionConfig,
} from "./types";
import { callLLM } from "./llm";

// ── Config ──

const PRIMARY_MODEL = process.env.EDITOR_MODEL ?? "claude-sonnet-4-6";
const SECONDARY_MODEL = process.env.EDITOR_SECONDARY_MODEL ?? "gpt-5.4";
const SECONDARY_ENABLED = process.env.EDITOR_DUAL_MODEL !== "false";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── Main ──

export async function runContinuityRead(
  input: PipelineOutput,
  scenes: IdentifiedScene[],
  config?: PostproductionConfig,
): Promise<EditorialReport> {
  // Resolve config — backward compatible: undefined = default behavior from env vars
  const llm = config?.llm ?? {
    provider: "anthropic" as const,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: ANTHROPIC_API_KEY ?? "",
    editorialModel: PRIMARY_MODEL,
    verifyModel: "",
    emotionModel: "",
    dualModel: SECONDARY_ENABLED && !!OPENAI_API_KEY,
    secondary: (SECONDARY_ENABLED && OPENAI_API_KEY) ? {
      provider: "openai-compat" as const,
      baseUrl: "https://api.openai.com/v1",
      apiKey: OPENAI_API_KEY,
      model: SECONDARY_MODEL,
    } : null,
    systemPromptSuffix: "",
  };

  if (!llm.apiKey) throw new Error("API key required for editor");

  const screenplay = formatScreenplay(scenes);
  const characterBrief = formatCharacterBrief(input);
  const seed = input.seed ?? "(no seed available)";

  const systemPrompt = buildSystemPrompt() + llm.systemPromptSuffix;
  const userPrompt = buildUserPrompt(seed, characterBrief, screenplay);

  // Run primary — always
  const primaryPromise = callLLM(
    llm.provider, llm.baseUrl, llm.apiKey,
    systemPrompt, userPrompt, llm.editorialModel, 0.3, 16000,
  );

  // Run secondary — in parallel if enabled
  let secondaryPromise: Promise<string | null> = Promise.resolve(null);
  if (llm.dualModel && llm.secondary) {
    const sec = llm.secondary;
    secondaryPromise = callLLM(
      sec.provider, sec.baseUrl, sec.apiKey,
      systemPrompt, userPrompt, sec.model, 0.3, 16000,
    ).catch(err => {
      console.warn(`[PASS2] Secondary model (${sec.model}) failed:`, err.message ?? err);
      return null;
    });
  }

  const [primaryRaw, secondaryRaw] = await Promise.all([primaryPromise, secondaryPromise]);

  // Parse primary (required)
  const primaryResult = parseEditorialResponse(primaryRaw, scenes, "sonnet");
  if (!primaryResult) {
    return emptyReport();
  }

  // Parse secondary (optional)
  const secondaryResult = secondaryRaw
    ? parseEditorialResponse(secondaryRaw, scenes, "gpt")
    : null;

  // If no secondary, return primary as-is
  if (!secondaryResult) {
    return buildReport(primaryResult.findings, [], primaryResult.reportOnly, primaryResult.ledger, scenes);
  }

  // Merge findings from both models
  const merged = mergeFindings(primaryResult.findings, secondaryResult.findings, scenes);

  // Combine report-only items (deduplicate by description similarity)
  const allReportOnly = deduplicateReportOnly([
    ...primaryResult.reportOnly,
    ...secondaryResult.reportOnly,
  ]);

  // Ledger comes from primary (Sonnet) — it's more reliable for structured output
  return buildReport(merged.autoFix, merged.reportOnly, allReportOnly, primaryResult.ledger, scenes);
}

// ── Merge Logic ──

interface MergeResult {
  autoFix: EditorialFinding[];
  reportOnly: EditorialFinding[];
}

function mergeFindings(
  primary: EditorialFinding[],
  secondary: EditorialFinding[],
  scenes: IdentifiedScene[],
): MergeResult {
  const autoFix: EditorialFinding[] = [];
  const reportOnly: EditorialFinding[] = [];

  // Index secondary by scene_id + line_id for matching
  const secondaryIndex = new Map<string, EditorialFinding>();
  for (const f of secondary) {
    secondaryIndex.set(`${f.scene_id}:${f.line_id}`, f);
  }

  const matchedSecondaryKeys = new Set<string>();

  // Process primary findings
  for (const pf of primary) {
    const key = `${pf.scene_id}:${pf.line_id}`;
    const sf = secondaryIndex.get(key);

    if (sf) {
      // Both models flagged this line → high confidence, always auto-fix
      matchedSecondaryKeys.add(key);
      autoFix.push({
        ...pf,
        description: `[Both models] ${pf.description}`,
        // Use the more specific fix suggestion
        fix_suggestion: pf.fix_suggestion.length > sf.fix_suggestion.length
          ? pf.fix_suggestion : sf.fix_suggestion,
      });
    } else if (pf.severity === "major") {
      // Single-model major → auto-fix
      autoFix.push(pf);
    } else {
      // Single-model minor → report-only
      reportOnly.push(pf);
    }
  }

  // Process secondary-only findings
  for (const sf of secondary) {
    const key = `${sf.scene_id}:${sf.line_id}`;
    if (matchedSecondaryKeys.has(key)) continue; // Already handled

    if (sf.severity === "major") {
      // Single-model major → auto-fix
      autoFix.push({ ...sf, description: `[${SECONDARY_MODEL}] ${sf.description}` });
    } else {
      // Single-model minor → report-only
      reportOnly.push({ ...sf, description: `[${SECONDARY_MODEL}] ${sf.description}` });
    }
  }

  // Deduplicate: if multiple findings target the same line, keep highest severity
  const dedupedAutoFix = deduplicateByLine(autoFix);

  return { autoFix: dedupedAutoFix, reportOnly };
}

function deduplicateByLine(findings: EditorialFinding[]): EditorialFinding[] {
  const byLine = new Map<string, EditorialFinding>();
  for (const f of findings) {
    const key = `${f.scene_id}:${f.line_id}`;
    const existing = byLine.get(key);
    if (!existing) {
      byLine.set(key, f);
    } else {
      // Keep the one with higher severity or more detail
      if (f.severity === "major" && existing.severity !== "major") {
        byLine.set(key, f);
      } else if (f.description.length > existing.description.length) {
        byLine.set(key, f);
      }
    }
  }
  return Array.from(byLine.values());
}

function deduplicateReportOnly(items: Array<{ category: string; description: string; scenes_affected: string[] }>): typeof items {
  const seen = new Set<string>();
  return items.filter(item => {
    // Simple dedup: same category + overlapping scenes
    const key = `${item.category}:${item.scenes_affected.sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Response Parsing ──

interface ParsedResponse {
  findings: EditorialFinding[];
  reportOnly: Array<{ category: string; description: string; scenes_affected: string[] }>;
  ledger: ContinuityLedger;
}

function parseEditorialResponse(
  raw: string,
  scenes: IdentifiedScene[],
  source: string,
): ParsedResponse | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate findings have required evidence
    const validFindings = (parsed.fixable_findings ?? []).filter((f: EditorialFinding) => {
      if (!f.scene_id || !f.line_id || !f.quoted_text) return false;
      const scene = scenes.find(s => s.scene_id === f.scene_id);
      if (!scene) return false;
      const line = scene.lines.find(l => l._lid === f.line_id);
      if (!line) return false;
      return true;
    });

    return {
      findings: validFindings,
      reportOnly: parsed.report_only ?? [],
      ledger: parsed.continuity_ledger ?? {
        characters: [], promises: [], relationships: [], world_facts: [],
      },
    };
  } catch (err) {
    console.error(`[PASS2] Failed to parse ${source} response:`, err);
    return null;
  }
}

// ── Report Building ──

function buildReport(
  fixableFindings: EditorialFinding[],
  demotedFindings: EditorialFinding[],
  reportOnly: Array<{ category: string; description: string; scenes_affected: string[] }>,
  ledger: ContinuityLedger,
  scenes: IdentifiedScene[],
): EditorialReport {
  // Multi-scene continuity errors → report-only
  const fixable = fixableFindings.filter(f => !f.affects_multiple_scenes);
  const crossScene = fixableFindings.filter(f => f.affects_multiple_scenes);

  const allReportOnly = [
    ...reportOnly,
    ...crossScene.map(f => ({
      category: "continuity_error" as const,
      description: `Cross-scene: ${f.description}`,
      scenes_affected: [f.scene_id, ...(f.related_scene_ids ?? [])],
    })),
    ...demotedFindings.map(f => ({
      category: f.category as any,
      description: `[Single-model minor] ${f.description}`,
      scenes_affected: [f.scene_id],
    })),
  ];

  return {
    fixable_findings: fixable,
    report_only: allReportOnly,
    continuity_ledger: ledger,
  };
}

function emptyReport(): EditorialReport {
  return {
    fixable_findings: [],
    report_only: [],
    continuity_ledger: { characters: [], promises: [], relationships: [], world_facts: [] },
  };
}

// ── Formatting ──

function formatScreenplay(scenes: IdentifiedScene[]): string {
  const parts: string[] = [];
  for (const scene of scenes) {
    parts.push(`\n=== SCENE: ${scene.scene_id} — "${scene.title}" ===`);
    const setting = typeof scene.setting === "string" ? scene.setting : scene.setting.location;
    parts.push(`[Setting: ${setting}]`);
    parts.push(`[Characters: ${scene.characters_present.join(", ")}]\n`);

    for (const line of scene.lines) {
      const lid = line._lid;
      if (line.speaker === "NARRATION" || line.speaker === "narration") {
        parts.push(`  [${lid}] (narration) ${line.text}`);
      } else if (line.speaker === "INTERNAL") {
        parts.push(`  [${lid}] (internal) ${line.text}`);
      } else {
        const emotion = line.emotion ? ` [${line.emotion}]` : "";
        const delivery = line.delivery ? ` (${line.delivery})` : "";
        parts.push(`  [${lid}] ${line.speaker}${emotion}: "${line.text}"${delivery}`);
      }
      if (line.stage_direction) {
        parts.push(`    > ${line.stage_direction}`);
      }
    }
  }
  return parts.join("\n");
}

function formatCharacterBrief(input: PipelineOutput): string {
  const parts: string[] = [];
  for (const [name, char] of Object.entries(input.storyBible.characters)) {
    parts.push(`### ${name}`);
    if (char.role) parts.push(`Role: ${char.role}`);
    if (char.description) parts.push(`Description: ${char.description.slice(0, 300)}`);
    const voice = char.secondary_dials?.voice_pattern
      ?? (char as any).psychological_profile?.voice_pattern;
    if (voice) parts.push(`Voice: ${voice}`);
    parts.push("");
  }
  return parts.join("\n");
}

function buildSystemPrompt(): string {
  return `You are a professional editor reviewing a visual novel script. You are reading the COMPLETE story for the first time — fresh eyes, no prior context about the generation process.

Your job is to find FIXABLE problems only. You will flag:
1. SEED COMPLIANCE — things the original seed/brief asked for that are missing, weak, or displaced into metaphor when they should be direct
2. CONTINUITY ERRORS — factual contradictions within a single scene (a character says X in line 10 but the opposite in line 20, a setting detail changes mid-scene)
3. VOICE DRIFT — a character speaking in a way that contradicts their established voice pattern
4. OVER-EXPLANATION — lines where narration, internal thought, or dialogue explains the scene's meaning rather than dramatizing it. Flag lines that sound like literary analysis, scene summaries, or emotional captions. Examples: "The silence between them was the most honest thing either of them had said", "She realized in that moment that trust was being offered", or any narration that tells the reader what to feel about what just happened. The fix for over-explanation is usually DELETION — the preceding action/dialogue already carried the meaning. Only flag a line as over-explanation if the same information is already recoverable from action, dialogue, or context in the surrounding lines.

You must also produce a CONTINUITY LEDGER — a compact record of key facts, character emotional states, promises/setups, and relationship states.

RULES:
- Every finding MUST include the exact scene_id, line_id, and a quoted text snippet from that line
- If a continuity error spans multiple scenes, mark affects_multiple_scenes: true and list all scene IDs — these will be report-only, not auto-fixed
- Only flag voice drift if it's clearly wrong (not just slightly different register)
- For seed compliance: compare what was asked for vs what was delivered. Be specific.
- Do NOT flag: pacing issues, dead setups, repeated beats, structural problems — those are handled separately`;
}

function buildUserPrompt(seed: string, characterBrief: string, screenplay: string): string {
  return `## ORIGINAL SEED
${seed}

## CHARACTER PROFILES
${characterBrief}

## FULL SCREENPLAY (read in order)
${screenplay}

---

Respond in JSON only. Use this exact schema:

{
  "fixable_findings": [
    {
      "category": "seed_compliance" | "continuity_error" | "voice_drift" | "over_explanation",
      "severity": "major" | "minor",
      "scene_id": "string (exact scene_id)",
      "line_id": "string (exact _lid)",
      "quoted_text": "string (exact text from the line)",
      "description": "what the problem is",
      "fix_suggestion": "what should change",
      "affects_multiple_scenes": false,
      "related_scene_ids": []
    }
  ],
  "report_only": [
    {
      "category": "dead_setup" | "pacing" | "repeated_beat",
      "description": "string",
      "scenes_affected": ["scene_id", ...]
    }
  ],
  "continuity_ledger": {
    "characters": [
      {
        "name": "string",
        "established_facts": ["string"],
        "emotional_state_by_scene": { "scene_id": "state description" }
      }
    ],
    "promises": [
      { "setup": "string", "introduced_in": "scene_id", "resolved_in": "scene_id or null" }
    ],
    "relationships": [
      { "between": ["name1", "name2"], "state": "string" }
    ],
    "world_facts": ["string"]
  }
}`;
}

// ── LLM Calls ──

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`Anthropic API error: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`OpenAI API error: ${JSON.stringify(data.error)}`);
  return data.choices?.[0]?.message?.content ?? "";
}
