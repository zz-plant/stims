# Agent Guidance Index

Start with the root [AGENTS.md](../../AGENTS.md) for the essentials, then use these deeper references as needed.

## Quickstart (agent-facing)

- Check for additional `AGENTS.md` files when you move into a new subdirectory.
- Prefer Bun for installs and scripts (`bun install --frozen-lockfile`, `bun run ...`).
- If you touch JS/TS, run `bun run check` before committing.
- If you only edit docs, you can skip typechecking/tests.

## Fast navigation map

- `assets/js/` - Core runtime, toy modules, and UI logic.
- `assets/js/toys/` - Toy implementations (TypeScript).
- `assets/data/toys.json` - Toy registry metadata.
- `toys/` - Standalone HTML toy pages.
- `tests/` - Automated tests.
- `docs/` - Documentation and architecture references.
- `.agent/skills/` - Agent skill definitions for common workflows.

- [Tooling & quality checks](./tooling-and-quality.md)
- [Metadata & documentation expectations](./metadata-and-docs.md)
- [Toy development structure & patterns](./toy-development.md)
- [Toy workflows & common commands](./toy-workflows.md)
- [Reference documentation pointers](./reference-docs.md)
