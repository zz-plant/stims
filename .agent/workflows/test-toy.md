---
description: Run toy-focused tests and validation with current repo commands
---

# Testing Toys

## 1. Pick the smallest useful check first

Targeted spec:

```bash
bun run test tests/path/to/spec.test.ts
```

Toy registry/docs consistency:

```bash
bun run check:toys
```

Browser-backed integration path:

```bash
bun run test:integration
```

## 2. Use the full gate before sign-off

```bash
bun run check
```

## 3. Manual browser verification when automation is not enough

Use:

```bash
bun run play:toy <slug>
```

or start `bun run dev` and open `http://localhost:5173/toy.html?toy=<slug>&agent=true`.

## 4. Notes

- Prefer `bun run test` over raw `bun test`.
- Pair this workflow with `modify-toy` or `ship-toy-change` when testing is only one phase of a larger toy update.
