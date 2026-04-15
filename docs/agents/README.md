# Agent Guidance Index

Use this folder as a focused, progressive-disclosure overlay for agent tasks.

## Read order

1. Root [`AGENTS.md`](../../AGENTS.md) for non-negotiable defaults.
2. [`agent-handoffs.md`](./agent-handoffs.md) for the fastest safe bootstrap plus delegation and return-contract guidance.
3. [`custom-capabilities.md`](./custom-capabilities.md) when the task may map to repo-local `.agent` skills/workflows.
4. [`tooling-and-quality.md`](./tooling-and-quality.md) before code edits.
5. [`metadata-and-docs.md`](./metadata-and-docs.md) before commit/PR finalization.
6. [`reference-docs.md`](./reference-docs.md) when triaging unfamiliar areas.

## 60-second bootstrap

When the repo state is unknown, start here:

```bash
bun run setup:codex --print-plan
bun run setup:codex
```

The default setup path installs dependencies and runs `bun run check:quick`, which is usually enough to establish a safe starting point before targeted work.

If you want a warmer long-lived session on a machine that exposes the local helper commands, use:

```bash
bun run session:codex -- --profile review
```

## Task routing

Use [`custom-capabilities.md`](./custom-capabilities.md) first when the task matches a repeatable repo-local workflow. Fast path:

| If the task is mainly about... | Start here |
| --- | --- |
| shared runtime, loader, renderer, shell, controls, audio, or routing | [`.agent/skills/modify-visualizer-runtime/SKILL.md`](../../.agent/skills/modify-visualizer-runtime/SKILL.md) |
| bundled presets, catalog/editor behavior, import/export, or compatibility | [`.agent/skills/modify-preset-workflow/SKILL.md`](../../.agent/skills/modify-preset-workflow/SKILL.md) |
| browser QA or visual confirmation | [`.agent/skills/play-visualizer/SKILL.md`](../../.agent/skills/play-visualizer/SKILL.md) and [`visual-testing.md`](./visual-testing.md) |
| quick implementation-time verification | [`.agent/skills/verify-visualizer-work/SKILL.md`](../../.agent/skills/verify-visualizer-work/SKILL.md) |
| end-to-end product-facing change that should go to PR-ready | [`.agent/skills/ship-visualizer-change/SKILL.md`](../../.agent/skills/ship-visualizer-change/SKILL.md) |

### Code changes

- [`agent-handoffs.md`](./agent-handoffs.md) (bootstrap, task slicing, subagent return contract)
- [`custom-capabilities.md`](./custom-capabilities.md)
- [`tooling-and-quality.md`](./tooling-and-quality.md)
- [`visual-testing.md`](./visual-testing.md) (browser-based testing, DevTools, agent-mode URL)
- [`visualizer-workflows.md`](./visualizer-workflows.md) (includes `/ship-visualizer-change` for end-to-end product updates)
- [`reference-docs.md`](./reference-docs.md)
- [`../MILKDROP_SUCCESSOR_WORKSTREAMS.md`](../MILKDROP_SUCCESSOR_WORKSTREAMS.md) (parallel successor execution map)

### Documentation or metadata changes

- [`agent-handoffs.md`](./agent-handoffs.md) when task ownership or delegation guidance changed
- [`metadata-and-docs.md`](./metadata-and-docs.md)
- [`custom-capabilities.md`](./custom-capabilities.md) when `.agent/` assets or agent-facing docs change
- [`../README.md`](../README.md) (canonical docs index)
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) (docs synchronization contract for add/move/rename/delete changes)

### README alignment changes

When a task updates any README, verify cross-link alignment across:

- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/agents/README.md`

Use [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) as the checklist before finalizing commit/PR metadata.

## Fast repo map

- `index.html` and `milkdrop/index.html` — canonical app shell and redirect alias.
- `assets/js/frontend/` — root workspace UI, URL state, and the engine adapter seam.
- `assets/js/core/` — shared runtime, renderer, shell, audio, and capability systems.
- `assets/js/bootstrap/`, `assets/js/loader.ts`, `assets/js/router.ts`, `assets/js/toy-view.ts`, and `assets/js/library-view.js` — legacy compatibility/test-support shell wiring, not the root product surface.
- `assets/js/milkdrop/` — preset runtime, editor, compiler, catalog, and VM behavior.
- `assets/data/toys.json` — loader manifest source for the shipped MilkDrop entry.
- `.github/workflows/ci.yml` — CI quality gate plus the default Cloudflare Pages direct-upload deploy jobs.
- `tests/` — automated test suite.
- `docs/` — contributor and architecture docs.
- `.agent/workflows/` + `.agent/skills/` — reusable automation workflows.
