# Stims Agent Instructions

Fast conventions for agents working on Stims (browser-native MilkDrop visualizer).

## What is Stims?

Single-page MilkDrop-inspired audio-reactive visualizer. Built with Three.js/WebGL. Core features: preset browser, live editing, import/export, audio reactivity.

## Stack & Tools

| What | How |
|------|-----|
| Package manager | Bun (`bun install`, `bun run <script>`) |
| Language + types | TypeScript (strict mode, no `@ts-nocheck`) |
| Formatter/linter | Biome (via `bun run lint`, `bun run format`) |
| Testing | Vitest (unit), Playwright (integration) |
| Dev server | Vite (`bun run dev` → http://localhost:5173) |

## Iteration Loop (Fast → Full)

Use these in sequence during implementation:

```bash
# 1. Syntax + types + lint (15s)
bun run check:quick

# 2. Targeted test for your change (30-90s)
bun run test tests/path/to/spec.test.ts

# 3. Visual verification (launch dev server)
bun run dev
# Visit:
# - http://localhost:5173/milkdrop/       (visualizer)
# - http://localhost:5173/milkdrop/?agent=true  (agent testing mode)

# 4. Full quality gate (before commit, 2-5 min)
bun run check
```

**For quick feedback during iteration, run only steps 1-2.** Don't wait for full `bun run check` until you're ready to commit.

## Code Conventions

- **Commit messages**: Sentence case, no trailing period (e.g., "Add audio frequency detection")
- **PR title**: Same style, include test/docs summary in description
- **Imports**: Relative paths within `assets/js/`, absolute paths for sibling packages
- **No `@ts-nocheck`**: All code must pass strict typecheck
- **Tests**: Match your code file path (e.g., `foo.ts` → `tests/foo.test.ts`)

## Project Structure (Key Paths)

| Path | Purpose |
|------|---------|
| `assets/js/core/` | Shared runtime (loader, shell, renderer, audio) |
| `assets/js/milkdrop/` | Preset engine (runner, editor, compiler, VM) |
| `assets/js/bootstrap/` | Page wiring (home, library, visualizer) |
| `assets/data/toys.json` | Preset manifest |
| `tests/` | Test suite (unit + integration) |
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
| Testing approach | [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md) |
| End-to-end change (code + docs + validation) | [`.agent/skills/ship-visualizer-change/SKILL.md`](./.agent/skills/ship-visualizer-change/SKILL.md) |
| Unclear which docs to use | [`docs/agents/README.md`](../docs/agents/README.md) (progressive-disclosure index) |

## Quality Gate Commands

```bash
bun run check:quick        # Fast check (syntax, types, lint)
bun run check              # Full gate (includes tests, architecture, SEO)
bun run check:architecture # Boundary violations
bun run check:toys         # Manifest drift
bun run check:seo          # SEO surface
```

## Dev Environment

**Start server**: `bun run dev` (watches files, hot-reload)

**URLs to test**:
- `http://localhost:5173/` — Home + library
- `http://localhost:5173/milkdrop/` — Main visualizer
- `http://localhost:5173/milkdrop/?agent=true` — Agent testing mode (persistent state, cleaner UI)

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
- **Unsure about testing**: open [`.agent/skills/verify-visualizer-work/SKILL.md`](./.agent/skills/verify-visualizer-work/SKILL.md)
- **Visual/UI changes**: see [`docs/agents/visual-testing.md`](../docs/agents/visual-testing.md)
- **Architecture questions**: check [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- **Docs/cross-linking**: follow [`docs/DOCS_MAINTENANCE.md`](../docs/DOCS_MAINTENANCE.md)

## Example: Add a feature

1. Start at task routing table above → pick matching skill
2. Run `bun run check:quick` and targeted test
3. Launch `bun run dev` and test in browser at `?agent=true` URL
4. When confident, run `bun run check` before committing
5. Use sentence-case commit message

## Non-Negotiable Checks (Before Pushing)

```bash
bun run check
```

If this passes, you're good to push/PR.

---

For detailed task runbooks, see [`docs/agents/`](../docs/agents/).
For architecture deep-dives, see [`docs/`](../docs/).
