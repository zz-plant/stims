---
description: Update an existing toy and keep metadata, docs, and validation aligned
---

# Modify an Existing Toy

## 1. Confirm scope

1. Identify the slug in `assets/data/toys.json`.
2. Read the implementation in `assets/js/toys/<slug>.ts`.
3. Decide whether metadata, docs, or tests must change too.

Relevant docs:

- `docs/TOY_DEVELOPMENT.md`
- `docs/TOY_SCRIPT_INDEX.md`
- `docs/toys.md`

## 2. Implement

- Keep cleanup behavior intact.
- Preserve shared loader/runtime expectations.
- Prefer shared helpers when refactoring repeated logic.

## 3. Validate incrementally

Run focused checks while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

If metadata or toy docs changed:

```bash
bun run generate:toys
bun run check:toys
```

## 4. Final validation

```bash
bun run check
```

## 5. Optional browser verification

Use one of:

```bash
bun run play:toy <slug>
```

or

```bash
bun run dev
```

then open `http://localhost:5173/toy.html?toy=<slug>&agent=true`.
