---
name: test-toy
description: "Validate toy behavior and toy-adjacent changes. Use when asked to run toy tests, toy registration checks, integration checks, or the full repo quality gate for toy work."
---

# Test toys

Use this skill when the main task is verification rather than implementation.

## Focused validation

Run a targeted spec while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

Run toy registry/docs consistency checks when slugs or metadata changed:

```bash
bun run check:toys
```

Run the browser-backed integration path when the change affects toy loading or real browser behavior:

```bash
bun run test:integration
```

## Final validation

Use the full quality gate before sign-off:

```bash
bun run check
```

## Notes

- Prefer `bun run test`, not raw `bun test`.
- If you also need manual browser evidence, pair this skill with `play-toy`.
