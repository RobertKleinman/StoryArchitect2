// Check which models/roles have null judges in Tier A and Tier B v2
import { readFileSync } from "fs";

for (const file of ["tier_a_raw_2026-03-21T13-38-47.json", "tier_b_v2_raw_2026-03-21T15-19-52.json"]) {
  console.log(`\n=== ${file} ===`);
  const data = JSON.parse(readFileSync(`./data/blind-tests/${file}`, "utf-8"));
  const valid = data.filter((r: any) => r.valid);
  const nullJudge = valid.filter((r: any) => !r.judge);

  // Count by model
  const byModel: Record<string, { total: number; nulls: number }> = {};
  for (const r of valid) {
    const m = r.model;
    if (!byModel[m]) byModel[m] = { total: 0, nulls: 0 };
    byModel[m].total++;
    if (!r.judge) byModel[m].nulls++;
  }
  for (const [model, counts] of Object.entries(byModel)) {
    if (counts.nulls > 0) {
      console.log(`  ${model}: ${counts.nulls}/${counts.total} null judges (${((counts.nulls/counts.total)*100).toFixed(0)}%)`);
    }
  }

  // Count by role
  const byRole: Record<string, { total: number; nulls: number }> = {};
  for (const r of valid) {
    const role = r.role;
    if (!byRole[role]) byRole[role] = { total: 0, nulls: 0 };
    byRole[role].total++;
    if (!r.judge) byRole[role].nulls++;
  }
  for (const [role, counts] of Object.entries(byRole)) {
    if (counts.nulls > 0) {
      console.log(`  ${role}: ${counts.nulls}/${counts.total} null judges (${((counts.nulls/counts.total)*100).toFixed(0)}%)`);
    }
  }

  console.log(`  Total: ${nullJudge.length}/${valid.length} null judges (${((nullJudge.length/valid.length)*100).toFixed(0)}%)`);
}
