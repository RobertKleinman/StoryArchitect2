// Check judge success rates across all test results
import { readdirSync, readFileSync } from "fs";

const dir = "./data/blind-tests";
const rawFiles = readdirSync(dir).filter(f => f.endsWith(".json")).sort();

for (const file of rawFiles) {
  const data = JSON.parse(readFileSync(`${dir}/${file}`, "utf-8"));
  if (!Array.isArray(data)) continue;

  // Different tests use different field names for validity
  const valid = data.filter((r: any) => r.valid || (r.validation && r.validation.valid));
  const judged = data.filter((r: any) => r.judge !== null && r.judge !== undefined);
  const nullJudge = valid.filter((r: any) => r.judge === null || r.judge === undefined);
  const haikuErrors = data.filter((r: any) => r.model && r.model.includes("haiku") && (r.error || (r.call && r.call.error)));

  console.log(`${file}: valid=${valid.length} judged=${judged.length} nullJudge=${nullJudge.length} haikuErrors=${haikuErrors.length}`);
}
