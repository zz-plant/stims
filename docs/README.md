# Developer and Contributor Docs

This is the canonical docs index for the repository.

Stims now centers on a single browser-native MilkDrop-inspired visualizer. Older toy-catalog docs remain useful as historical context in places, but they should not be treated as the current product model.

## Start here

- Human contributors: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Agent contributors: [`../AGENTS.md`](../AGENTS.md) then [`agents/README.md`](./agents/README.md)
- Day-to-day implementation: [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- Runtime details: [`MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)
- projectM parity roadmap: [`MILKDROP_PROJECTM_PARITY_PLAN.md`](./MILKDROP_PROJECTM_PARITY_PLAN.md)
- projectM parity backlog: [`MILKDROP_PROJECTM_PARITY_BACKLOG.md`](./MILKDROP_PROJECTM_PARITY_BACKLOG.md)
- Lineage and public wording: [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md)
- Deployment and release flow: [`DEPLOYMENT.md`](./DEPLOYMENT.md)

## Current operating docs

- [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- [`MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)
- [`MILKDROP_PROJECTM_PARITY_PLAN.md`](./MILKDROP_PROJECTM_PARITY_PLAN.md)
- [`MILKDROP_PROJECTM_PARITY_BACKLOG.md`](./MILKDROP_PROJECTM_PARITY_BACKLOG.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md)
- [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- [`DOCS_MAINTENANCE.md`](./DOCS_MAINTENANCE.md)
- [`FRONTEND_PERFORMANCE_BOTTLENECKS.md`](./FRONTEND_PERFORMANCE_BOTTLENECKS.md)

## Historical or transitional docs

The following docs still describe the retired multi-toy model. Keep them only as archival context unless they are actively rewritten:

- [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md)
- [`TOY_TESTING_SPEC.md`](./TOY_TESTING_SPEC.md)
- [`TOY_SCRIPT_INDEX.md`](./TOY_SCRIPT_INDEX.md)
- [`toys.md`](./toys.md)

## README synchronization

When docs are added, moved, renamed, archived, or removed, keep the repository entry-point READMEs aligned in the same PR:

- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/agents/README.md`

Reference [`DOCS_MAINTENANCE.md`](./DOCS_MAINTENANCE.md) for the full synchronization contract and per-change requirements.

## Conventions

- Package manager: `bun`
- Main quality gate: `bun run check`
- Fast iteration gate: `bun run check:quick`
