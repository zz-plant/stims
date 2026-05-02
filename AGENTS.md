# Agent Guidelines (Essentials)

Stims is a browser-native MilkDrop-inspired visualizer built with Three.js/WebGL for responsive, audio-reactive visual play.

## Quick start (yes, read this first)

You're about to code on Stims. Before you dive into docs, grab these five things:

1. **Cline fast path** — If you're using Cline, start with [`.claude/CLAUDE.md`](./.claude/CLAUDE.md) for a single-page quick start, then return here for non-negotiable defaults.

2. **Bootstrap the repo state first** — Run `bun run setup:codex --status` for a quick local readiness read, then `bun run setup:codex --print-plan` to see the install/check plan, then `bun run setup:codex` when the workspace state is unknown. See [`docs/agents/agent-handoffs.md`](./docs/agents/agent-handoffs.md) for the fast-start and delegation contract.
   On higher-memory local machines, use `bun run session:codex -- --profile review` when you want to keep the dev server, local model roles, and a verification watcher warm between edits.

3. **Verify your code as you go** — Use [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) during implementation to catch bugs early. Don't wait until the end for the full quality gate.

4. **Test visually in the browser** — Run `bun run dev` and visit `http://localhost:5173/?agent=true` to test your changes with persistent state on the canonical workspace route. Use `http://localhost:5173/milkdrop/?agent=true` only when verifying the compatibility alias redirect. See [`docs/agents/visual-testing.md`](./docs/agents/visual-testing.md) for the full visual testing guide.

5. **Know your commands** — Bookmark the CLI quick reference in [`docs/agents/tooling-and-quality.md`](./docs/agents/tooling-and-quality.md#quick-cli-reference-for-agents). The three you'll use most:
   - `bun run check:quick` — Fast syntax/lint/type check (use often)
   - `bun run test tests/path/to/file.test.ts` — Test a specific file
   - `bun run check` — Full quality gate before committing

## Task routing

Use the repo-local capability guide in [`docs/agents/custom-capabilities.md`](./docs/agents/custom-capabilities.md) when the task maps to a repeatable workflow. Fast path:

| If the task is mainly about... | Start here |
| --- | --- |
| shared runtime, loader, renderer, shell, controls, audio, or routing | [`.agent/skills/modify-visualizer-runtime/SKILL.md`](./.agent/skills/modify-visualizer-runtime/SKILL.md) |
| bundled presets, catalog/editor behavior, import/export, or compatibility | [`.agent/skills/modify-preset-workflow/SKILL.md`](./.agent/skills/modify-preset-workflow/SKILL.md) |
| browser QA or visual confirmation | [`.agent/skills/play-visualizer/SKILL.md`](./.agent/skills/play-visualizer/SKILL.md) and [`docs/agents/visual-testing.md`](./docs/agents/visual-testing.md) |
| quick implementation-time verification | [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) |
| end-to-end product-facing change that should go to PR-ready | [`.agent/skills/ship-visualizer-change/SKILL.md`](./.agent/skills/ship-visualizer-change/SKILL.md) |

## Essentials

- **Package manager:** Bun (use `bun install` for dependency updates, reserve `bun install --frozen-lockfile` for reproducible/CI installs, and run scripts with `bun run ...`).
- **Quality gate for JS/TS edits:** run `bun run check` (Biome check + typecheck + tests) before committing.
- **Done criteria by change type:** JS/TS changes need `bun run check`; runtime, preset, audio, shell, or routing changes also need browser verification on `http://localhost:5173/?agent=true`; docs-only edits can skip typecheck/tests unless commands, paths, or workflow-critical instructions changed.
- **Cloudflare Pages deploy default:** GitHub Actions direct-upload jobs in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) own preview and production deploys; keep local `pages:deploy:*` scripts as the manual fallback.
- **Commit metadata:** use sentence case commit titles with no trailing period.
- **PR metadata:** include a short summary plus explicit lists of tests run and docs touched/added.

## Recommended execution order

1. **Understand the task**: Open [`docs/agents/README.md`](./docs/agents/README.md) for progressive-disclosure guidance.
2. **Bootstrap and slice work**: Use [`docs/agents/agent-handoffs.md`](./docs/agents/agent-handoffs.md) when the repo state is unclear or the task may be delegated.
3. **Plan and route**: Use [`docs/agents/custom-capabilities.md`](./docs/agents/custom-capabilities.md) when the task maps to a repo-local skill/workflow, then use [`docs/agents/tooling-and-quality.md`](./docs/agents/tooling-and-quality.md) before editing code.
4. **Verify during dev**: Use [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) after each change to validate quickly.
5. **Test visually**: Use [`docs/agents/visual-testing.md`](./docs/agents/visual-testing.md) when you need browser-based verification.
6. **Finalize**: Use [`docs/agents/metadata-and-docs.md`](./docs/agents/metadata-and-docs.md) before commit/PR text.
7. **Coordinate successor work**: Use [`docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md) when a task spans parity, runtime performance, browser-native UX, or proof/release claims.
8. **Docs changes**: Use [`docs/README.md`](./docs/README.md) as the canonical index when restructuring docs.
9. **Synchronize**: Follow [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md) for cross-link alignment.

## Alignment requirements

- Keep links and workflow docs aligned according to [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md).
- If `.agent/skills/*` or `.agent/workflows/*` changes, update [`docs/agents/custom-capabilities.md`](./docs/agents/custom-capabilities.md) and any route/command docs that mention the changed capability in the same change.
