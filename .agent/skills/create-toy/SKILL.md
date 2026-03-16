---
name: create-toy
description: "Create and register a new toy in the Stim Webtoys Library. Use when asked to scaffold a new toy, add a new toy slug, or wire a new toy into metadata, tests, and docs."
---

# Create a new toy

Use this skill when the request is primarily about adding a new toy, not modifying an existing one.

## Start with the current docs

- `docs/TOY_DEVELOPMENT.md`
- `docs/agents/toy-development.md`
- `docs/agents/toy-workflows.md`

## Preferred path

Use the scaffold helper first:

```bash
bun run scripts/scaffold-toy.ts --slug <slug> --title "<Title>" --type module --with-test
```

Then verify the generated metadata in `assets/data/toys.json`.

If metadata changed, regenerate derived artifacts:

```bash
bun run generate:toys
```

## Minimum follow-through

1. Confirm the new entry in `assets/data/toys.json`.
2. Confirm the module path under `assets/js/toys/`.
3. Update toy docs when the new toy is real, not just a spike:
   - `docs/TOY_SCRIPT_INDEX.md`
   - `docs/toys.md`
4. Run validation:

```bash
bun run check:toys
bun run check
```

## Browser validation

For a real toy implementation, run:

```bash
bun run dev
```

Then open:

```text
http://localhost:5173/toy.html?toy=<slug>&agent=true
```

Confirm the toy loads, the audio entry flow appears when expected, and cleanup works when returning to the library.
