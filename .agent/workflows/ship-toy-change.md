---
description: End-to-end workflow for implementing and validating a toy-focused change
---

# Ship a Toy Change

## 1. Gather context

1. Confirm impacted slug(s) in `assets/data/toys.json`.
2. Read:
   - `docs/TOY_DEVELOPMENT.md`
   - `docs/TOY_SCRIPT_INDEX.md`
   - `docs/toys.md`
   - `docs/agents/toy-workflows.md`

## 2. Implement the change

- Update code, metadata, tests, and docs together.
- If toy metadata changed, regenerate artifacts:

```bash
bun run generate:toys
```

## 3. Run validation

If metadata, slugs, or toy docs changed:

```bash
bun run check:toys
```

Run the main repo gate:

```bash
bun run check
```

## 4. Browser validation when needed

```bash
bun run play:toy <slug>
```

or open a local dev session and inspect `toy.html?toy=<slug>&agent=true`.

## 5. Finalize

1. Ensure docs stayed in sync.
2. Use a sentence-case commit title with no trailing period.
3. Prepare PR metadata with summary, tests run, and docs touched.
