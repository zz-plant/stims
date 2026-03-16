---
name: ship-toy-change
description: "Run the end-to-end flow for a toy-focused change. Use when a toy change spans implementation, docs sync, validation, and PR-ready completion."
---

# Ship a toy change

Use this when the request is not just “edit one toy file,” but “carry the toy change all the way through.”

## Gather context

- Confirm affected slug(s) in `assets/data/toys.json`.
- Read:
  - `docs/TOY_DEVELOPMENT.md`
  - `docs/TOY_SCRIPT_INDEX.md`
  - `docs/toys.md`
  - `docs/agents/toy-workflows.md`

## Implement

- Update code, metadata, tests, and toy docs together.
- Regenerate derived toy artifacts when metadata changes:

```bash
bun run generate:toys
```

## Validate

Run the toy-specific gate when applicable:

```bash
bun run check:toys
```

Then run the full repo gate:

```bash
bun run check
```

If visual behavior changed, also run:

```bash
bun run play:toy <slug>
```

## Finalize

- Keep docs in sync.
- Use a sentence-case commit title with no trailing period.
- Prepare PR metadata with:
  - short summary,
  - explicit tests run,
  - explicit docs touched.
