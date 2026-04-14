---
description: End-to-end workflow for implementing and validating a product-facing visualizer change
---

# Ship a visualizer change

## 1. Gather context

1. Confirm whether the change is runtime-focused, preset-focused, or crosses both.
2. Read the docs that define the changed behavior:
   - `docs/DEVELOPMENT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/MILKDROP_PRESET_RUNTIME.md`
   - `docs/PAGE_SPECIFICATIONS.md`
   - `docs/agents/visualizer-workflows.md`

## 2. Implement the change

- update code, tests, and agent-facing docs together
- keep the repo’s single-visualizer product framing consistent

## 3. Run validation

Use targeted coverage as needed, then run the main repo gate:

```bash
bun run check
```

## 4. Browser validation when needed

```bash
bun run dev
```

Inspect `http://localhost:5173/?agent=true` when runtime, preset, audio, or shell behavior changed.

## 5. Finalize

1. Ensure agent docs and MCP metadata stayed in sync.
2. Use a sentence-case commit title with no trailing period.
3. Prepare PR metadata with summary, tests run, and docs touched.
