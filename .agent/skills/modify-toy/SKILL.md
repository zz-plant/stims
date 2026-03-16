---
name: modify-toy
description: "Modify an existing toy safely. Use when a request changes a toy's visuals, controls, performance, metadata, tests, or toy-specific docs."
---

# Modify an existing toy

Use this skill when the target toy already exists and the change touches its behavior or supporting files.

## First checks

1. Find the slug in `assets/data/toys.json`.
2. Read the current implementation in `assets/js/toys/<slug>.ts`.
3. Identify which of these may need updates:
   - `docs/toys.md`
   - `docs/TOY_SCRIPT_INDEX.md`
   - tests under `tests/`

## Implementation rules

- Keep cleanup logic intact.
- Preserve the loader contract unless the change intentionally updates it.
- Prefer shared runtime/helpers over bespoke plumbing when refactoring.

## Validation

While iterating, use targeted tests where possible:

```bash
bun run test tests/path/to/spec.test.ts
```

When the change is ready:

```bash
bun run check
```

If the toy slug, metadata, or docs changed, also run:

```bash
bun run check:toys
```

## Browser check

If the change is visual, interactive, or performance-sensitive:

```bash
bun run play:toy <slug>
```

Or run a manual dev session with `bun run dev` and open `toy.html?toy=<slug>&agent=true`.

## Escalation

If the task spans implementation, docs sync, and PR-ready validation, use the `ship-toy-change` skill/workflow instead of treating it as a narrow toy edit.
