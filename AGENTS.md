# Agent Guidelines (Essentials)

Stims is a browser-native MilkDrop-inspired visualizer built with Three.js/WebGL for responsive, audio-reactive visual play.

## Quick start (yes, read this first)

You're about to code on Stims. Before you dive into docs, grab these three things:

1. **Verify your code as you go** — Use [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) during implementation to catch bugs early. Don't wait until the end for the full quality gate.

2. **Test visually in the browser** — Run `bun run dev` and visit `http://localhost:5173/milkdrop/?agent=true` to test your changes with persistent state. See [`docs/agents/visual-testing.md`](./docs/agents/visual-testing.md) for the full visual testing guide.

3. **Know your commands** — Bookmark the CLI quick reference in [`docs/agents/tooling-and-quality.md`](./docs/agents/tooling-and-quality.md#quick-cli-reference-for-agents). The three you'll use most:
   - `bun run check:quick` — Fast syntax/lint/type check (use often)
   - `bun run test tests/path/to/file.test.ts` — Test a specific file
   - `bun run check` — Full quality gate before committing

## Essentials

- **Package manager:** Bun (use `bun install` for dependency updates, reserve `bun install --frozen-lockfile` for reproducible/CI installs, and run scripts with `bun run ...`).
- **Quality gate for JS/TS edits:** run `bun run check` (Biome check + typecheck + tests) before committing.
- **Commit metadata:** use sentence case commit titles with no trailing period.
- **PR metadata:** include a short summary plus explicit lists of tests run and docs touched/added.

## Recommended execution order

1. **Understand the task**: Open [`docs/agents/README.md`](./docs/agents/README.md) for progressive-disclosure guidance.
2. **Plan and implement**: Use [`docs/agents/tooling-and-quality.md`](./docs/agents/tooling-and-quality.md) before editing code.
3. **Verify during dev**: Use [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) after each change to validate quickly.
4. **Test visually**: Use [`docs/agents/visual-testing.md`](./docs/agents/visual-testing.md) when you need browser-based verification.
5. **Finalize**: Use [`docs/agents/metadata-and-docs.md`](./docs/agents/metadata-and-docs.md) before commit/PR text.
6. **Docs changes**: Use [`docs/README.md`](./docs/README.md) as the canonical index when restructuring docs.
7. **Synchronize**: Follow [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md) for cross-link alignment.

## Alignment requirements

- Keep links and workflow docs aligned according to [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md).
