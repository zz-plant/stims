# Agent Guidance Index

Use this folder as a focused, progressive-disclosure overlay for agent tasks.

## Read order

1. Root [`AGENTS.md`](../../AGENTS.md) for non-negotiable defaults.
2. [`tooling-and-quality.md`](./tooling-and-quality.md) before code edits.
3. [`custom-capabilities.md`](./custom-capabilities.md) when the task may map to repo-local `.agent` skills/workflows.
4. [`metadata-and-docs.md`](./metadata-and-docs.md) before commit/PR finalization.
5. [`reference-docs.md`](./reference-docs.md) when triaging unfamiliar areas.

## Task routing

### Code changes

- [`tooling-and-quality.md`](./tooling-and-quality.md)
- [`custom-capabilities.md`](./custom-capabilities.md)
- [`visualizer-workflows.md`](./visualizer-workflows.md) (includes `/ship-visualizer-change` for end-to-end product updates)
- [`reference-docs.md`](./reference-docs.md)

### Documentation or metadata changes

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

- `milkdrop/index.html` — primary app entrypoint for the flagship visualizer.
- `assets/js/core/` — shared runtime, renderer, shell, audio, and capability systems.
- `assets/js/milkdrop/` — preset runtime, editor, compiler, catalog, and VM behavior.
- `assets/data/toys.json` — loader manifest source for the shipped MilkDrop entry.
- `tests/` — automated test suite.
- `docs/` — contributor and architecture docs.
- `.agent/workflows/` + `.agent/skills/` — reusable automation workflows.
