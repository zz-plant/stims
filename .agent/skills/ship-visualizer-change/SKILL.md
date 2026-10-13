---
name: ship-visualizer-change
description: "Run the end-to-end flow for a visualizer change. Use when a product-facing runtime or preset update spans implementation, docs sync, validation, and PR-ready completion."
---

# Ship a visualizer change

Use this skill when the task is broader than a narrow edit and should be carried through to PR-ready completion.

## Gather context

Read the docs that match the changed surface:

- `docs/DEVELOPMENT.md`
- `docs/ARCHITECTURE.md`
- `docs/MILKDROP_PRESET_RUNTIME.md`
- `docs/PAGE_SPECIFICATIONS.md`

## Implement

- update code, tests, and agent-facing docs together when the workflow changes
- keep the product framing centered on one visualizer, not a catalog of first-class toys

## Validate

Use targeted checks first, then the repo gate; [`verify-visualizer-work`](../verify-visualizer-work/SKILL.md)
says which tests cover which surface:

```bash
bun run check
```

Add browser verification when runtime, preset, or shell behavior changed:

```bash
bun run dev
```

Then inspect `http://localhost:5173/?agent=true`.

## Finalize

- keep agent docs and MCP capability metadata aligned
- write commits and the PR body per [Commit conventions](../../../docs/COMMIT_CONVENTIONS.md)
  and the [steward skill](../../../.claude/skills/steward/SKILL.md)
