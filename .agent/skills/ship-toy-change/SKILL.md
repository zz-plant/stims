---
name: ship-toy-change
description: "Orchestrate toy implementation, quality gates, docs sync, and PR-ready metadata in one repeatable flow."
---

# Ship a toy change

## Use when

- A change touches toy code, toy metadata, or toy docs.
- You need deterministic quality-gate output for agent reports.

## Workflow

1. Confirm impacted toy slug(s) and metadata.
2. Implement updates.
3. Run checks:

```text
run_quality_gate(scope: "toys")
run_quality_gate(scope: "typecheck")
run_quality_gate(scope: "full", timeoutMs: 600000)
```

4. If visual behavior changed, validate in browser and capture screenshot evidence.
5. Ensure docs are synchronized.
6. Finalize commit/PR metadata.

## Notes

- The full gate maps to `bun run check`.
- For quick iteration, use `run_quality_gate(scope: "quick")`.
