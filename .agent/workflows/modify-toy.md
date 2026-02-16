---
description: Update an existing toy while preserving registration, docs, and quality gates
---

# Modify an Existing Toy

Use this workflow when a request asks you to tweak behavior, visuals, controls, or metadata for a toy that already exists.

## Step 1: Confirm scope

1. Identify the target toy slug in `assets/data/toys.json`.
2. Review current implementation in `assets/js/toys/<slug>.ts`.
3. Note any metadata or docs that may need updates (`docs/TOY_SCRIPT_INDEX.md`, `docs/toys.md`, `docs/TOY_DEVELOPMENT.md`).

## Step 2: Implement the change

- Keep cleanup logic intact (animation frame cancellation, event listener teardown, DOM cleanup).
- Preserve loader contract (`start` export and toy global registration) unless the change intentionally updates integration behavior.
- Update controls/descriptions when UX-facing behavior changes.

## Step 3: Run checks

Use MCP quality-gate automation where available:

```text
run_quality_gate(scope: "toys")
run_quality_gate(scope: "typecheck")
run_quality_gate(scope: "full", timeoutMs: 600000)
```

Or run shell equivalents:

```bash
bun run check:toys
bun run typecheck
bun run check
```

## Step 4: Validate behavior

1. Start dev server with `bun run dev`.
2. Open `http://localhost:5173/toy.html?toy=<slug>&agent=true`.
3. Enable demo audio or microphone input.
4. Confirm the modified behavior works and no regressions appear.

## Step 5: Finalize

1. Sync docs/metadata for any changed controls, capabilities, or behavior notes.
2. Prepare sentence-case commit title with no trailing period.
3. Include PR summary, explicit tests list, and docs touched list.
