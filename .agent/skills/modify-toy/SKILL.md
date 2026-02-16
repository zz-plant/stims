---
name: modify-toy
description: "Update an existing toy implementation and keep metadata/docs/tests synchronized. Use when asked to modify, tune, or refactor an existing stim."
---

# Modify an existing toy

## Use when

- A user asks to change behavior in an existing toy.
- A toy needs updated controls, metadata, or docs after implementation changes.

## Workflow

1. Confirm the target slug and current metadata in `assets/data/toys.json`.
2. Edit the toy module in `assets/js/toys/<slug>.ts` and preserve cleanup logic.
3. Update related metadata/docs when behavior or controls change.
4. Run checks:

```text
run_quality_gate(scope: "toys")
run_quality_gate(scope: "typecheck")
run_quality_gate(scope: "full", timeoutMs: 600000)
```

5. Optionally run browser validation and capture screenshot evidence when visuals changed.
6. Finalize commit/PR metadata.

## Notes

- For quick iteration, use `run_quality_gate(scope: "quick")`.
- Pair with `/ship-toy-change` when the change spans multiple files and docs.
