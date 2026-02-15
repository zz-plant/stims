# Agent Guidance Index

Use this folder as a focused, progressive-disclosure overlay for agent tasks.

## Read order

1. Root [`AGENTS.md`](../../AGENTS.md) for non-negotiable defaults.
2. [`tooling-and-quality.md`](./tooling-and-quality.md) before code edits.
3. [`metadata-and-docs.md`](./metadata-and-docs.md) before commit/PR finalization.
4. [`reference-docs.md`](./reference-docs.md) when triaging unfamiliar areas.

## Task routing

### Code changes

- [`tooling-and-quality.md`](./tooling-and-quality.md)
- [`toy-development.md`](./toy-development.md)
- [`toy-workflows.md`](./toy-workflows.md) (includes `/ship-toy-change` for end-to-end toy updates)
- [`reference-docs.md`](./reference-docs.md)

### Documentation or metadata changes

- [`metadata-and-docs.md`](./metadata-and-docs.md)
- [`../README.md`](../README.md) (canonical docs index)
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) (docs synchronization contract for add/move/rename/delete changes)

## Fast repo map

- `assets/js/toys/` — toy implementations.
- `assets/data/toys.json` — toy metadata source of truth.
- `toys/` — standalone toy pages.
- `tests/` — automated test suite.
- `docs/` — contributor and architecture docs.
- `.agent/workflows/` + `.agent/skills/` — reusable automation workflows.
