---
description: End-to-end workflow for shipping toy updates with docs and quality gates
---

# Ship a Toy Change

Use this workflow when you need to implement, validate, and package a toy-focused change with predictable automation output.

## Step 1: Gather context

1. Confirm target toy slug(s) in `assets/data/toys.json`.
2. Review relevant docs:
   - `docs/TOY_DEVELOPMENT.md`
   - `docs/TOY_SCRIPT_INDEX.md`
   - `docs/toys.md`
3. If browser verification is needed, note the toy URL:
   - `http://localhost:5173/toy.html?toy=<slug>&agent=true`

## Step 2: Implement changes

- Prefer scaffolded or shared helpers over ad-hoc wiring.
- Keep cleanup logic and toy globals registration intact.

## Step 3: Run deterministic checks

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

## Step 4: Optional browser validation

- Start dev server with `bun run dev`.
- Open target toy and enable demo audio.
- Capture screenshot evidence and note observed audio-reactive behavior.

## Step 5: Finalize metadata

1. Ensure docs sync for toy/script changes.
2. Create sentence-case commit title without trailing period.
3. Include PR summary, explicit tests run, and docs touched.
