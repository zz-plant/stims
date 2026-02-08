# Agent Guidelines (Essentials)

Stim Webtoys Library is a collection of interactive, audio-reactive web toys built with Three.js/WebGL for responsive visual play.

## Essentials

- **Package manager:** Bun (use `bun install --frozen-lockfile` when dependencies change; run scripts with `bun run ...`).
- **Non-standard quality gates for JS/TS changes:** run `bun run check` (Biome + typecheck + tests) before committing.
- **Metadata:** commit messages use sentence case with no trailing period; PR summaries include a short summary plus explicit lists of tests run and docs touched/added.

## More detailed guidance

- [Tooling & quality checks](./docs/agents/tooling-and-quality.md)
- [Metadata & documentation expectations](./docs/agents/metadata-and-docs.md)
- [Toy development structure & patterns](./docs/agents/toy-development.md)
- [Toy workflows & common commands](./docs/agents/toy-workflows.md)
- [Reference documentation pointers](./docs/agents/reference-docs.md)
