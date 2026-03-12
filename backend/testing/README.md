# Golden Test Set

Quality regression testing for LLM outputs across modules.

## Quick Start

### 1. Capture a baseline

Run the pipeline normally with a known-good input. Save the result:

```typescript
import { GoldenTestRunner, HOOK_QUALITY_CRITERIA } from "./goldenTestRunner";

const runner = new GoldenTestRunner("./golden-tests/baselines");

await runner.capture({
  id: "dark-romance-foot-worship",
  module: "hook",
  description: "Dark romance with kink mechanics as load-bearing plot structure",
  rationale: "Tests complex content handling, mechanism specificity, and user-fit scoring",
  seedInput: "dark romance where a warrior king's son...",
  inputs: { /* session state, upstream packs */ },
  outputs: { builder: builderOutput, judge: judgeOutput },
  promptVersions: { clarifier_system: "v1.0", builder_system: "v1.0" },
  qualityCriteria: HOOK_QUALITY_CRITERIA,
});
```

### 2. Compare after changes

After modifying prompts, models, or logic:

```typescript
const result = await runner.compare(
  "dark-romance-foot-worship",
  "hook",
  { builder: newBuilderOutput, judge: newJudgeOutput }
);

console.log(runner.formatReport(result));
```

### 3. Review the report

The report shows:
- Automated check pass/fail (score thresholds, field presence)
- Structural diffs (what changed in the output)
- Items flagged for human review

## Recommended Test Cases

Build a set of 10-15 cases per module covering:

- **Typical case**: Standard input, expected to work well
- **Edge case**: Unusual seed, complex constraints, ambiguous input
- **High-stakes**: Pivotal scene, climax, turning point
- **Continuity-dependent**: Scene that relies heavily on previous scene state
- **Psychology-heavy**: Session with strong user behavior patterns
- **Content-sensitive**: Adult content, dark themes (test boundary handling)

## When to Run

- Before deploying prompt changes
- After model tier changes
- After modifying tournament/gating logic
- After schema changes that affect LLM structured output
