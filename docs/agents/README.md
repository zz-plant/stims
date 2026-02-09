# Agent Guidance Index

Use this folder as the **agent-facing overlay** for repo docs.

## Navigation order (agent workflow)

1. Read root [`AGENTS.md`](../../AGENTS.md) for mandatory defaults.
2. Open [`../README.md`](../README.md) when you need the full contributor docs map.
3. Use the focused files below only for the task at hand (progressive disclosure).

## Guidance by task

### If you are changing code

- [`tooling-and-quality.md`](./tooling-and-quality.md): Bun-first commands and required quality gates.
- [`toy-development.md`](./toy-development.md): runtime structure and toy implementation patterns.
- [`toy-workflows.md`](./toy-workflows.md): common toy workflows and command recipes.
- [`reference-docs.md`](./reference-docs.md): high-signal code/document locations for fast triage.

### If you are changing docs or metadata

- [`metadata-and-docs.md`](./metadata-and-docs.md): commit/PR conventions and documentation upkeep expectations.
- [`../README.md`](../README.md): canonical docs map by audience and purpose.

## Fast repo map

- `assets/js/` - Core runtime, toy modules, and UI logic.
- `assets/js/toys/` - Toy implementations (TypeScript).
- `assets/data/toys.json` - Toy registry metadata.
- `toys/` - Standalone HTML toy pages.
- `tests/` - Automated tests.
- `docs/` - Contributor and architecture references.
- `.agent/skills/` - Agent skill definitions for reusable workflows.
