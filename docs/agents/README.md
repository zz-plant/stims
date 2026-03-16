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
- [`toy-development.md`](./toy-development.md)
- [`toy-workflows.md`](./toy-workflows.md) (includes `/ship-toy-change` for end-to-end toy updates)
- [`reference-docs.md`](./reference-docs.md)

### Documentation or metadata changes

- [`metadata-and-docs.md`](./metadata-and-docs.md)
- [`custom-capabilities.md`](./custom-capabilities.md) when `.agent/` assets or agent-facing docs change
- [`../README.md`](../README.md) (canonical docs index)
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) (docs synchronization contract for add/move/rename/delete changes)

## Fast repo map

- `assets/js/toys/` — toy implementations.
- `assets/data/toys.json` — authoritative toy metadata source of truth; `assets/js/data/toy-manifest.ts` and `public/toys.json` are generated from it.
- `toys/` — standalone toy pages.
- `tests/` — automated test suite.
- `docs/` — contributor and architecture docs.
- `.agent/workflows/` + `.agent/skills/` — reusable automation workflows.
