#!/usr/bin/env python3
"""Export a v2 project to a readable HTML file."""
import sys, json, html as h, urllib.request

pid = sys.argv[1] if len(sys.argv) > 1 else None
if not pid:
    print("Usage: py scripts/export-html.py <projectId> [output.html]")
    sys.exit(1)

out_file = sys.argv[2] if len(sys.argv) > 2 else f"data/v2-runs/{pid}.html"

url = f"http://localhost:3001/api/v2/project/{pid}/export"
resp = urllib.request.urlopen(url)
d = json.loads(resp.read())

pr = d.get("premise", {})
bible = d.get("storyBible", {})
scenes = d.get("scenes", [])
traces = d.get("traces", [])

total_calls = len(traces)
total_time = sum(t.get("durationMs", 0) for t in traces) / 1000

CSS = """*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#e0ddd5;font-family:Georgia,serif;max-width:800px;margin:0 auto;padding:2rem 1.5rem;line-height:1.7}
h1{font-size:1.6rem;color:#c9a96e;margin-bottom:.5rem;font-weight:400;line-height:1.4}
.promise{font-size:1rem;color:#a89880;font-style:italic;margin-bottom:.5rem}.tone{color:#665e55;font-size:.85rem;margin-bottom:1.5rem}
.synopsis{background:#12121a;border-left:3px solid #c9a96e;padding:1rem 1.2rem;margin-bottom:2rem;color:#b0a898;font-size:.92rem;line-height:1.8}
.badge{background:#1a1a2a;color:#8a8ab8;padding:.2rem .8rem;border-radius:3px;font-size:.7rem;display:inline-block;margin-bottom:1.2rem}
.sd{text-align:center;margin:3.5rem 0 1.5rem;color:#c9a96e;letter-spacing:.3em;font-size:.72rem;text-transform:uppercase}
.sd::before,.sd::after{content:"";display:inline-block;width:60px;height:1px;background:#332e28;vertical-align:middle;margin:0 1rem}
.st{font-size:1.25rem;color:#c9a96e;text-align:center;margin-bottom:.3rem;font-weight:400;font-style:italic}
.ss{text-align:center;color:#555040;font-size:.8rem;font-style:italic;margin-bottom:1.8rem}
.narr{color:#8a8278;font-style:italic;padding:.1rem 0;margin-bottom:.7rem}
.int{color:#7a8a7a;font-style:italic;padding-left:1.5rem;border-left:2px solid #3a4a3a;margin-bottom:.7rem}
.stage{color:#4a4535;font-size:.82rem;font-style:italic;text-align:center;margin:.6rem 0}
.dl{margin-bottom:.8rem}.dl .sp{color:#c9a96e;font-weight:600;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em}
.dl .em{color:#555040;font-size:.72rem;font-style:italic;margin-left:.3rem}
.dl .dv{color:#776a5a;font-size:.82rem;font-style:italic;margin-left:.3rem}
.dl .tx{display:block;margin-top:.1rem;padding-left:.4rem}
.wc{text-align:right;color:#3a3530;font-size:.7rem;margin-top:.5rem}
.cc{background:#12121a;border:1px solid #2a2520;border-radius:4px;padding:1rem 1.2rem;margin-bottom:.8rem}
.cn{color:#c9a96e;font-size:1rem}.cr{color:#555040;font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;margin-left:.5rem}
.cd{color:#a89880;font-size:.88rem;margin-top:.4rem}.cp{color:#7a7a6a;font-size:.85rem}.cp strong{color:#998a7a;font-weight:400}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid #2a2520;color:#3a3530;font-size:.72rem;text-align:center}"""

out = []
out.append(f'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">')
out.append(f'<title>{h.escape(pr.get("hook_sentence","")[:80])}</title>')
out.append(f'<style>{CSS}</style></head><body>')

out.append(f'<div class="badge">{total_calls} LLM calls &middot; {total_time:.0f}s</div>')
out.append(f'<h1>{h.escape(pr.get("hook_sentence",""))}</h1>')
out.append(f'<p class="promise">{h.escape(pr.get("emotional_promise",""))}</p>')
out.append(f'<p class="tone">{h.escape(", ".join(pr.get("tone_chips",[])))}</p>')
out.append(f'<div class="synopsis">{h.escape(pr.get("synopsis",""))}</div>')

# Characters
out.append('<div class="sd">DRAMATIS PERSONAE</div>')
for name, c in bible.get("characters", {}).items():
    pp = c.get("psychological_profile", {})
    out.append('<div class="cc">')
    out.append(f'<span class="cn">{h.escape(name)}</span><span class="cr">{h.escape(c.get("role",""))}</span>')
    out.append(f'<p class="cd">{h.escape(c.get("description","")[:300])}</p>')
    out.append(f'<p class="cp"><strong>Want:</strong> {h.escape(pp.get("want","")[:200])}</p>')
    out.append(f'<p class="cp"><strong>Voice:</strong> {h.escape(pp.get("voice_pattern","")[:200])}</p>')
    out.append('</div>')

# Scenes
total_words = 0
for i, scene in enumerate(scenes):
    vn = scene.get("vn_scene", {})
    readable = scene.get("readable", {})
    out.append(f'<div class="sd">SCENE {i+1}</div>')
    out.append(f'<h2 class="st">{h.escape(readable.get("title", vn.get("title","")))}</h2>')
    cp = ", ".join(vn.get("characters_present", []))
    out.append(f'<p class="ss">{h.escape(vn.get("setting",""))} &mdash; {h.escape(cp)}</p>')

    wc = 0
    for line in vn.get("lines", []):
        speaker = line.get("speaker", "")
        text = h.escape(line.get("text", ""))
        emotion = line.get("emotion") or ""
        delivery = line.get("delivery") or ""
        stage = line.get("stage_direction") or ""
        wc += len(line.get("text", "").split())

        if stage:
            out.append(f'<p class="stage">[{h.escape(stage)}]</p>')
        if speaker == "NARRATION":
            out.append(f'<div class="narr">{text}</div>')
        elif speaker == "INTERNAL":
            out.append(f'<div class="int">{text}</div>')
        else:
            parts = [f'<span class="sp">{h.escape(speaker)}</span>']
            if emotion: parts.append(f' <span class="em">[{h.escape(emotion)}]</span>')
            if delivery: parts.append(f' <span class="dv">{h.escape(delivery)}</span>')
            parts.append(f'<span class="tx">{text}</span>')
            out.append(f'<div class="dl">{"".join(parts)}</div>')

    total_words += wc
    out.append(f'<p class="wc">{wc} words</p>')

out.append(f'<footer>Story Architect v2 &middot; {len(scenes)} scenes &middot; {total_words} words &middot; {total_calls} calls &middot; {total_time:.0f}s</footer>')
out.append('</body></html>')

with open(out_file, "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print(f"Wrote {out_file} ({len(scenes)} scenes, {total_words} words)")
