---
description: Run visualizer-focused tests and validation with current repo commands
---

# Test the visualizer

## 1. Pick the smallest useful check first

Targeted spec:

```bash
bun run test tests/path/to/spec.test.ts
```

Browser-backed integration path:

```bash
bun run test:integration
```

Preset compatibility path:

```bash
bun run test:compat
```

## 2. Use the full gate before sign-off

```bash
bun run check
```

## 3. Manual browser verification when automation is not enough

Use:

```bash
bun run play:toy milkdrop
```

or start `bun run dev` and open `http://localhost:5173/toy.html?agent=true`.

## 4. Notes

- Prefer `bun run test` over raw `bun test`.
- Pair this workflow with `modify-visualizer-runtime`, `modify-preset-workflow`, or `ship-visualizer-change` when testing is only one phase of a larger update.
