# Stims Agent Instructions

Fast conventions for agents working on Stims (browser-native MilkDrop visualizer).

## What is Stims?

Single-page app for playing and live-editing MilkDrop presets with supported audio inputs. Built with Three.js/WebGL. Core features: preset browser, live editing, import/export, audio reactivity.

## Stack & Tools

| What | How |
|------|-----|
| Package manager | Bun (`bun install`, `bun run <script>`) |
| Language + types | TypeScript (strict mode, no `@ts-nocheck`) |
| Formatter/linter | Biome (via `bun run lint`, `bun run format`) |
| Testing | Bun (`bun:test`), happy-dom (simulation), Playwright (browser) |
| Dev server | Vite (`bun run dev` → http://localhost:5173) |

## Iteration Loop (Fast → Full)

Use these in sequence during implementation:

```bash
# 1. Lint + types + guards, no tests
bun run check:quick

# 2. Targeted test for your change
bun run test tests/path/to/spec.test.ts

# 3. Visual verification (launch dev server)
bun run dev
# Visit:
# - http://localhost:5173/           (root workspace)
# - http://localhost:5173/?agent=true (agent testing mode)

# 4. Full quality gate (includes corpus and package checks)
bun run check
```

**For quick feedback during iteration, run only steps 1-2.** Don't wait for full `bun run check` until you're ready to commit.

## Code Conventions

- **Commit messages**: Conventional Commits, lowercase after the colon, no trailing period (e.g., `feat(audio): detect the dominant frequency`); see [Commit conventions](../docs/COMMIT_CONVENTIONS.md)
- **PR title**: Same style, include test/docs summary in description
- **Imports**: Relative paths within the app; package-name imports for workspace libraries
- **No `@ts-nocheck`**: All code must pass strict typecheck
- **Tests**: Use `tests/unit`, `tests/compat`, `tests/corpus`, or `tests/e2e`; package suites stay inside the package

## Project Structure (Key Paths)

| Path | Purpose |
|------|---------|
| `src/js/core/` | Shared runtime (loader, shell, renderer, audio) |
| `src/js/milkdrop/` | Preset engine (runner, editor, VM; compiler in `packages/milkdrop-toolchain/`) |
| `src/js/frontend/` | React workspace, URL state, and runtime adapter |
| `packages/` | Standalone compiler, DSP, flash-analysis, and conformance libraries |
| `tests/` | Unit, compatibility, corpus, and browser E2E suites |
| `docs/agents/` | Agent guidance (task routing, tools, verification) |
| `.agent/skills/` | Reusable agent workflows |
| `public/milkdrop-presets/` | Shipped preset catalog |

## Task Routing

Pick the right starting point:

| Task Type | Start Here |
|-----------|-----------|
| Runtime/loader/renderer/audio changes | [`docs/agents/custom-capabilities.md`](../docs/agents/custom-capabilities.md) → modify-visualizer-runtime skill |
| Preset/editor/catalog/compatibility | [`docs/agents/custom-capabilities.md`](../docs/agents/custom-capabilities.md) → modify-preset-workflow skill |
| UI/styling/layout | [`docs/agents/visual-testing.md`](../docs/agents/visual-testing.md) + `bun run dev` |
| Testing approach | [`.agent/skills/verify-visualizer-work/SKILL.md`](../.agent/skills/verify-visualizer-work/SKILL.md) |
| End-to-end change (code + docs + validation) | [`.agent/skills/ship-visualizer-change/SKILL.md`](../.agent/skills/ship-visualizer-change/SKILL.md) |
| Unclear which docs to use | [`docs/agents/README.md`](../docs/agents/README.md) (progressive-disclosure index) |

## Quality Gate Commands

```bash
bun run check:quick        # Fast check (syntax, types, lint)
bun run check              # Full gate (includes tests, architecture, SEO)
bun run check:architecture # Boundary violations
bun run check:seo          # SEO surface
```

## Dev Environment

**Start server**: `bun run dev` (watches files, hot-reload)

**URLs to test**:
- `http://localhost:5173/` — Home + library
- `http://localhost:5173/` — Main visualizer
- `http://localhost:5173/?agent=true` — Agent browser verification on the canonical route

**Browser DevTools** (F12): Check console for errors, Network for asset loading, Performance for frame rate.

## Reusable Task Prompts

Use these slash commands (`/implement-feature`, `/fix-bug`, etc.) to jump-start common tasks:

| Prompt | Use for |
|--------|---------|
| `/implement-feature` | Adding a new capability, UI element, or behavior |
| `/fix-bug` | Diagnosing and fixing reported issues |
| `/update-test` | Writing or fixing unit/integration tests |
| `/refactor-module` | Improving code structure, removing duplication |
| `/update-docs` | Adding or updating agent/architecture documentation |
| `/review-changes` | Self-review before committing or opening PR |

Each prompt provides a checklist to keep you focused and avoid common mistakes.

## When to Read Full Docs

- **Before writing code**: skim [`docs/agents/README.md`](../docs/agents/README.md) (2 min read-order)
- **Unsure about testing**: open [`.agent/skills/verify-visualizer-work/SKILL.md`](../.agent/skills/verify-visualizer-work/SKILL.md)
- **Visual/UI changes**: see [`docs/agents/visual-testing.md`](../docs/agents/visual-testing.md)
- **Architecture questions**: check [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- **Docs/cross-linking**: follow [`docs/DOCS_MAINTENANCE.md`](../docs/DOCS_MAINTENANCE.md)

## Example: Add a feature

1. Start at task routing table above → pick matching skill
2. Run `bun run check:quick` and targeted test
3. Launch `bun run dev` and test in browser at `?agent=true` URL
4. When confident, run `bun run check` before committing
5. Write a Conventional Commits subject, lowercase after the colon

## Non-Negotiable Checks (Before Pushing)

```bash
bun run check
```

If this passes, you're good to push/PR.

---

For detailed task runbooks, see [`docs/agents/`](../docs/agents/).
For architecture deep-dives, see [`docs/`](../docs/).
