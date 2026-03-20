---
name: test-visualizer
description: "Validate visualizer behavior and product-facing runtime changes. Use when running targeted tests, integration or compatibility coverage, or the full repo quality gate."
---

# Test the visualizer

Use this skill when the main task is validation rather than implementation.

## Focused validation

Run a targeted spec while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

Run browser-backed integration coverage when loader, shell, audio, or real-page behavior changed:

```bash
bun run test:integration
```

Run compatibility coverage when preset parsing or support guarantees changed:

```bash
bun run test:compat
```

## Final validation

Use the full quality gate before sign-off:

```bash
bun run check
```

## Notes

- Prefer `bun run test`, not raw `bun test`.
- Pair this skill with `play-visualizer` when you need manual browser evidence.
