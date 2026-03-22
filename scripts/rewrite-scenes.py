#!/usr/bin/env python3
"""
Rewrite existing v2 scenes to fix LLM tells, voice homogeneity,
emotional distance, and flat pacing.
"""

import json
import urllib.request
import os
import sys
import re

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY") or open(".env").read().split("ANTHROPIC_API_KEY=")[1].split("\n")[0].strip()

with open("data/v2-runs/full_export.json", encoding="utf-8") as f:
    d = json.load(f)

bible = d.get("storyBible", {})
premise = d.get("premise", {})
scenes = d.get("scenes", [])

# Build character reference
char_ref = []
for name, c in bible.get("characters", {}).items():
    pp = c.get("psychological_profile", {})
    char_ref.append(f'{name} ({c.get("role", "")}):')
    char_ref.append(f'  Description: {c.get("description", "")}')
    char_ref.append(f'  Want: {pp.get("want", "")}')
    char_ref.append(f'  Misbelief: {pp.get("misbelief", "")}')
    char_ref.append(f'  Voice: {pp.get("voice_pattern", "")}')
    char_ref.append(f'  Threshold: {c.get("threshold_statement", "")}')
    char_ref.append(f'  Stress: {pp.get("stress_style", "")}')
    char_ref.append(f'  Break point: {pp.get("break_point", "")}')

char_block = "\n".join(char_ref)

# Build plot reference
plot = bible.get("plot", {})
beats = "\n".join(f'  {b["id"]}: {b["beat"]}' for b in plot.get("tension_chain", []))

system = """You are rewriting an existing visual novel script to fix specific quality issues. You have the full story bible, character profiles, and all 8 existing scenes. Your job is to rewrite ALL 8 scenes, preserving the story beats and structure but fixing these specific problems:

## FIXES REQUIRED

### 1. VOICE DIFFERENTIATION (critical)
The current script has "intellectual homogeneity" — all characters think and speak with the same analytical precision. Fix this:

- **Kael**: Think in CONCRETE, PHYSICAL terms. He's a soldier. His observations are about bodies, weight, distance, heat, what his hands are doing. He doesn't philosophize — he notices. Short sentences. Incomplete thoughts. When he's attracted, it's physical unease, not analysis. He doesn't have words for what he feels and DOESN'T FIND THEM.
- **Soren**: Fluent, controlled — but the control SLIPS. He uses longer sentences as armor, but when Kael gets under his skin, the sentences fracture. He catches himself mid-thought. His intelligence is a defense mechanism that visibly fails.
- **The Consul**: ALIEN certainty. Not theatrical villainy. He speaks as if describing weather. The horror is in how reasonable he sounds. Bureaucratic language about monstrous things.
- **Mira**: BLUNT. Strategic. She's been at this for 20 years and doesn't dress things up. Short, declarative, occasionally brutal. The opposite of Soren's eloquence.

### 2. STOP EXPLAINING SUBTEXT (critical)
The current script explains its own metaphors and tells the reader what to feel. Fix this:

- If a gesture shows attraction, do NOT add a line explaining the character noticed the attraction
- If a power dynamic is visible in the action, do NOT narrate what it means
- NEVER write "that's the thing" or "the point is" or "what matters is" — those are the writer explaining
- Leave gaps. Let the reader's mind fill them. An unfinished sentence is stronger than a completed thought.
- Cut any INTERNAL line that just restates what the dialogue already showed

### 3. EMOTIONAL RUPTURE (important)
The current script is too controlled. Every character is composed at all times. Fix this:

- At least ONE moment per scene where someone's composure actually breaks — not gracefully, MESSILY
- Attraction should include moments of: wrong timing, physical proximity that's too close, involuntary reactions, saying something you didn't mean to
- Not every emotional beat should land cleanly. Some should be awkward, interrupted, or mistimed.
- The erotic tension (when it appears) should feel dangerous and slightly out of control, not aesthetically curated

### 4. PACING VARIATION (important)
The current script runs at the same intensity throughout. Fix this:

- Vary sentence length DRAMATICALLY within scenes. A 30-word sentence followed by a 3-word sentence.
- Some scenes should have stretches of rapid-fire short dialogue. Others should have long silences (noted as stage directions).
- The reveal moments should HIT — change the rhythm abruptly, not glide through at the same pace.
- Use SILENCE as a tool. "[Long pause]" or "[Neither speaks]" can be more powerful than any line.

### 5. LLM TELLS TO ELIMINATE
- No "both things can be true" constructions
- No "the thing about X is Y" framing
- No perfectly balanced parallel structures ("not X, but Y; not A, but B")
- No characters being eloquently self-aware about their own psychology
- No metaphors that are immediately decoded in the next line
- Kael especially should NOT be articulate about his feelings. He should be inarticulate and that inarticulacy should be VISIBLE.

## FORMAT

Output each scene as JSON matching this structure:
{
  "scenes": [
    {
      "scene_id": "S01",
      "title": "...",
      "setting": "...",
      "characters_present": ["..."],
      "pov_character": "...",
      "lines": [
        { "speaker": "NARRATION" or "INTERNAL" or character name, "text": "...", "emotion": "..." or null, "stage_direction": "..." or null, "delivery": "..." or null }
      ],
      "transition_out": "..." or null
    }
  ]
}

IMPORTANT: Rewrite ALL 8 scenes. Keep the same scene IDs, titles (you may adjust slightly), settings, and plot beats. Change the WRITING."""

# Build the existing scenes as reference
scene_texts = []
for s in scenes:
    r = s.get("readable", {})
    vn = s.get("vn_scene", {})
    plan = s.get("plan", {})
    scene_texts.append(f'--- SCENE {s["scene_id"]}: {r.get("title", "")} ---')
    scene_texts.append(f'Setting: {vn.get("setting", "")}')
    scene_texts.append(f'Characters: {", ".join(vn.get("characters_present", []))}')
    scene_texts.append(f'POV: {vn.get("pov_character", "")}')
    scene_texts.append(f'Plan purpose: {plan.get("purpose", "")}')
    scene_texts.append(f'Pacing: {plan.get("pacing_type", "")}')
    obj = plan.get("objective", {})
    scene_texts.append(f'Objective: {obj.get("want", "")} vs {obj.get("opposition", "")}')
    scene_texts.append(f'Exit hook: {plan.get("exit_hook", "")}')
    scene_texts.append("")
    scene_texts.append(r.get("screenplay_text", ""))
    scene_texts.append("")

bible_context = f"""PREMISE: {premise.get('hook_sentence', '')}
{premise.get('synopsis', '')}
Core conflict: {premise.get('core_conflict', '')}
Tone: {', '.join(premise.get('tone_chips', []))}

CHARACTERS:
{char_block}

PLOT BEATS:
{beats}"""

# Process in batches of 2 scenes
all_rewritten = []
batch_size = 2

for batch_start in range(0, len(scenes), batch_size):
    batch = scenes[batch_start:batch_start + batch_size]
    batch_ids = [s["scene_id"] for s in batch]
    print(f"\n--- Batch: {batch_ids} ---", file=sys.stderr)

    batch_texts = []
    for s in batch:
        r = s.get("readable", {})
        vn = s.get("vn_scene", {})
        plan = s.get("plan", {})
        batch_texts.append(f'--- SCENE {s["scene_id"]}: {r.get("title", "")} ---')
        batch_texts.append(f'Setting: {vn.get("setting", "")}')
        batch_texts.append(f'Characters: {", ".join(vn.get("characters_present", []))}')
        batch_texts.append(f'POV: {vn.get("pov_character", "")}')
        batch_texts.append(f'Plan purpose: {plan.get("purpose", "")}')
        batch_texts.append(f'Pacing: {plan.get("pacing_type", "")}')
        obj = plan.get("objective", {})
        batch_texts.append(f'Objective: {obj.get("want", "")} vs {obj.get("opposition", "")}')
        batch_texts.append(f'Exit hook: {plan.get("exit_hook", "")}')
        batch_texts.append("")
        batch_texts.append(r.get("screenplay_text", ""))
        batch_texts.append("")

    # Include previous rewritten scene digest for continuity
    prev_digest = ""
    if all_rewritten:
        last = all_rewritten[-1]
        last_lines = [l.get("text", "") for l in last.get("lines", [])[-5:]]
        prev_digest = f"\nPREVIOUS SCENE ENDING (for continuity):\n" + "\n".join(last_lines)

    user = f"""{bible_context}
{prev_digest}

SCENES TO REWRITE:

{chr(10).join(batch_texts)}

Rewrite these {len(batch)} scenes. Same beats — better writing. Output as JSON with a "scenes" array."""

    print(f"  Prompt: {len(system) + len(user)} chars", file=sys.stderr)

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 16000,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    resp = urllib.request.urlopen(req, timeout=600)
    data = json.loads(resp.read())
    text = data["content"][0]["text"]
    stop = data.get("stop_reason", "?")
    usage = data.get("usage", {})

    print(f"  Response: {len(text)} chars, stop={stop}", file=sys.stderr)
    print(f"  Tokens: {usage.get('input_tokens', 0)} in / {usage.get('output_tokens', 0)} out", file=sys.stderr)

    # Save raw batch
    with open(f"data/v2-runs/rewrite_batch_{batch_start}.txt", "w", encoding="utf-8") as f:
        f.write(text)

    # Parse
    try:
        m = re.search(r'\{[\s\S]*\}', text)
        if m:
            parsed = json.loads(m.group(0))
            batch_scenes = parsed.get("scenes", [])
            all_rewritten.extend(batch_scenes)
            print(f"  Parsed {len(batch_scenes)} scenes", file=sys.stderr)
        else:
            print(f"  WARNING: No JSON found in batch response", file=sys.stderr)
    except Exception as e:
        print(f"  WARNING: Parse failed: {e}", file=sys.stderr)

print(f"\n=== Total rewritten: {len(all_rewritten)} scenes ===", file=sys.stderr)

# Save all
with open("data/v2-runs/rewrite_scenes.json", "w", encoding="utf-8") as f:
    json.dump({"scenes": all_rewritten}, f, indent=2, ensure_ascii=False)

print(f"Saved to data/v2-runs/rewrite_scenes.json")
