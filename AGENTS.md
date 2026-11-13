# Stims agent guide

Stims plays and live-edits MilkDrop presets in the browser: Bun and TypeScript,
rendered by Three.js on WebGL or WebGPU. Every coding agent starts here; the
tool-specific files listed at the end point back to this one.

## Hobby project (since 2026-11-10)

Stims is a hobby: the owner decided on 2026-11-10 to keep it for enjoyment, not develop it as a product. Until this section is removed, it overrides the roadmap and any other document that names work to do next.

**Budget:** two merged pull requests a week across Video Night (`zz-plant/video-night`) and Stims (`zz-plant/stims`) together. A fix for something broken does not count against it. Before starting other work, count this repository's merges in the last seven days (`git log --first-parent --since="7 days ago" --oneline origin/main`). When the two repositories together are at two, stop and say the budget is spent; the owner can still ask for more.

Always take:

- a fix for something broken: a failing build or check, a page error, a deploy that stopped;
- security updates and the monthly dependency pull request;
- a preset that no longer compiles or renders, and breakage on either backend.

The player and the editor are the hobby. The Workers (embed, MCP, sync), their D1, Durable Objects and Workers AI bindings, and the parity and certification pipeline do not grow.

Decline, and say in your reply that this is a hobby project:

- new paid services, Workers, bindings, secrets or scheduled jobs;
- work aimed at audience growth, accounts, sign-ups or anything else that leaves the owner owing users;
- large refactors and redesigns.

The owner can still ask for any of these. Do one only when the request says it overrides this section.

### Optional surface (parked)

Core surface is the player, the editor, sharing, accessibility, and fidelity
measurement. Everything else is **optional** and does not grow: adding an
optional file or route means removing one, or getting an explicit override.

Parked, in rough order of how little a priority-1 listener touches it:

- **Agent-discovery metadata** — `public/llms.txt`, `llms-full.txt`,
  `openapi.json`, `auth.md`, `.well-known/api-catalog`,
  `.well-known/mcp/server-card.json`, `.well-known/agent-skills/`.
- **Model-backed API routes** — `functions/api/{generate,refine,blend,image-to-preset,visual-search,patch,validate,batch-generate,decide,feed}-*.ts`.
  They are rate-limited and documented, and they stay, but they are not the
  product and do not get new siblings.
- **The GPU compute VM** (`gpuComputeVM`, `vm-gpu.ts`) — an opt-in
  experiment. `preset-lab-vm-tier-bench` measured the per-frame round trip as
  not worth it; it is kept for per-vertex work, not expanded.

A useful test for new surface: *does a priority-1 listener touch it, and does a
named instrument measure it?* If neither, it is optional.

## Start here

```bash
bun run agent:start              # branch, dirty files, worktrees, next commands
bun run setup:codex --status     # is the repo ready?
bun run setup:codex              # install + quick-check if not
```

Several sessions share the main checkout's index and working tree. Start each
change in its own worktree, and work only in the path it prints:

```bash
bun run worktree:new -- <branch>
bun run worktree:prune           # dry run: clean, merged worktrees to delete
```

[Agent handoffs](docs/agents/agent-handoffs.md#working-in-a-tree-with-other-writers)
explains why, and how to keep ports and captures apart.

## Finding a command

This repo has well over a hundred scripts (`bun run help` is the source of
truth). Reach for the symptom index before hand-rolling a measurement:

```bash
bun run help                 # every script, grouped by namespace
bun run help parity lab:     # only the scripts whose name contains a term
bun run help --for "<symptom>"   # "my preset looks wrong" → parity:capture
```

Namespaces worth knowing: `lab:` (preset measurement), `parity:` (MilkDrop
reference capture → diff → promote), `sweep:` (batch corpus runs), `perf:` /
`bench:` / `profile:` (performance), `catalog:` (preset curation), `check:`
(guards), `generate:` (idempotent artifacts, most take `--check`), `site:` /
`preview:` (deploy).

Purpose lines come from the docblock atop each script, so the index cannot
drift (`check:script-docs` enforces it).

## Finding code

Source files here run to 4,800 lines. Ask for the map, then read the line
range it names:

```bash
bun run outline <file>                 # each declaration with its line range
bun run outline <file> --match <name>  # one declaration, however deeply nested
bun run where <symbol>                 # where it is declared, what uses it, which tests touch it
```

## What costs time if you learn it the hard way

- **Hot spots**: `fix(milkdrop)` (shader/GLSL/HLSL translation, in
  `packages/milkdrop-toolchain`) and `fix(webgpu)` dominate. Reproduce with
  `lab:replay` / `lab:nan-sweep`, fix the _class_ across the corpus (not one
  preset), add a fixture, and check both backends with `lab:backend-diff`.
- **Search noise**: `.ignore` hides `public/milkdrop-presets/`,
  `screenshots/`, and the parity fixtures from ripgrep. Use
  `rg --no-ignore <pat> <path>` on purpose.
- **Learn pages**: `docs/authoring/*.md` and `docs/learn/*.md` are published
  under `public/learn/`. After editing either, run `bun run generate:learn`;
  `check:seo` fails on a stale page, a missing sitemap entry, or a broken
  `/learn/…#anchor` link.
- **Generators**: most `generate:*` scripts take `--check`, including
  `generate:seo` (writes nothing). Without `--check`, `generate:seo` rewrites
  tracked sitemaps, icons, OG cards, route pages and the `index.html` footer.
  If that was unintended, restore only the paths it rewrote: `git checkout --
  public` also discards your own unstaged edits there.
- **Tests**: write behavioural tests that can fail (render via the workspace
  harness; mutate the behaviour once and watch the test go red). Do not add
  source-text greps (`check:test-source-greps` blocks them). Never assert on
  timing: wait on a condition (`__stims_agent.waitFor`). A test that times out
  only under load is usually CPU-bound on bun's 5 s default; `test:budget`
  ranks those.
- **CI**: `bun run ci:why` prints the failing job, test, error and first stack
  frames, and links the job. Use it instead of `gh run view --log-failed`,
  which returns runner setup noise and can miss the step output.
- **Duplicate PRs**: check for an open PR on the branch before pushing.
- **PR workflow**: read [the steward skill](.claude/skills/steward/SKILL.md)
  for CI's shapes, bot-comment noise, and squash-merge conventions. Scaffold
  and check the body with `bun run pr:body`, writing the body file outside the
  repo; after a squash-merge use `bun run branch:restart`.
- **Software rendering**: on a GPU-less host (`bun run doctor` says so)
  correctness tools work but frame-time tools (`lab:profile`, `profile:frame`,
  `perf:*`, `bench:*`) time the CPU rasterizer and warn. Do not draw
  performance conclusions from them.

## The loop

| Intent | Command | Time |
| --- | --- | --- |
| Dev server + typecheck + fast-test watchers | `bun run dev:agent` | — |
| Fast syntax/lint/type check | `bun run check:quick` | about 30 s |
| Guards and tests the diff can break | `bun run verify --changed` | < 1 min |
| Full quality gate | `bun run check` | 2–5 min |
| One test file / affected tests | `bun run test <file>` / `bun run test:changed` | varies |
| Diagnose a broken environment | `bun run doctor` | < 30 s |
| Start a change in its own worktree | `bun run worktree:new -- <branch>` | ~30 s |

Dev modes, gate tiers, test profiles and the full task-to-check table live in
[Tooling and quality](docs/agents/tooling-and-quality.md) and
[Testing](docs/TESTING.md).

## Driving the running visualizer

Do not scrape the DOM or hand-roll sleep-and-poll loops. `__stims_agent` is
installed in every mode: `getState()`, `waitFor(fn)`, `run(actionId)`,
`getVariables()`, `getEvents()`. Drive it from the shell with `bun run ctl`
(one-shot) or expose it to an MCP client with `bun run mcp`. The full API, URL
flags and the live channel are in
[Browser automation](docs/agents/browser-automation.md).

Browser QA uses `http://localhost:5173/?agent=true`: without the flag a hidden
tab stops rendering, and the black canvas reads as a shader failure. Use
`/milkdrop/?agent=true` only to check the compatibility alias redirect.

## Where things live

| Area | Path | Use when changing… |
| --- | --- | --- |
| Workspace UI | `src/js/frontend/` | React UI, URL state, engine adapter |
| Shared runtime | `src/js/core/` | Renderer, shell, audio, capabilities, MIDI/VJ hardware |
| Preset system | `src/js/milkdrop/` | Presets, editor, catalog, VM, renderers |
| Standalone packages | `packages/` | Compiler, EEL JIT, formatter, exporter, audio DSP, flash guard, gamepad focus, recording. See `packages/README.md` |
| Stylesheets | `src/css/` | `tokens.css` (design tokens), `chrome.css` (controls), `app-shell.css` (shell), `*.module.css` (component) |
| Entry points | `index.html`, `milkdrop/index.html` | Shell loading, redirects |
| Tests | `tests/` | All automated coverage |
| Agent skills | `.agent/skills/` | Reusable playbooks |
| Agent docs | `docs/agents/` | Deep guidance |

[`docs/agents/src-map.md`](docs/agents/src-map.md) maps each area to its tests
and guards.

## Code conventions

- TypeScript in strict mode; no `@ts-nocheck` (`check:no-ts-nocheck` blocks new
  ones).
- Imports are relative within the app; workspace packages are imported by
  package name (`milkdrop-toolchain/src/<module>.ts`).
- Root tests live in `tests/unit`, `tests/compat`, `tests/corpus`, or
  `tests/e2e` (the runner rejects a test file outside them); a package's tests
  stay in that package's `tests/`.
- Biome formats and lints; the pre-commit hook formats staged files before
  running `check:quick`.

## Done criteria

- **JS/TS changes**: `bun run check` passes. Fix the root cause; do not chain
  fix-attempt commits.
- **Runtime, preset, audio, shell, or routing changes**: also verify in a
  browser on `http://localhost:5173/?agent=true`, or with the headless tiers in
  [`verify-visualizer-work`](.agent/skills/verify-visualizer-work/SKILL.md).
- **Docs-only changes**: `bun run check:doc-references` and
  `bun run check:readme-claims`. Skip typecheck and tests unless commands,
  paths, or workflow-critical instructions changed.
- **Before pushing a dependency change**: `bun audit --audit-level=high`.

Run what your change can break rather than the whole gate while iterating:

| Change touches | Verify with |
| --- | --- |
| `README.md`, `docs/`, agent files only | `check:doc-references` + `check:readme-claims` |
| `src/`, `scripts/` code | `check:quick` |
| tests | `test <file>` then `check:quick` |
| `expression.ts` / `builtin-docs.ts` | `docs:authoring-reference` then `check:authoring-docs` |
| `public/milkdrop-presets/catalog.json` | `check:catalog-integrity` + `check:catalog-fidelity` |
| anything | `verify --changed` |

Every guard, its tier and its rationale are in
[`docs/GUARDRAILS.md`](docs/GUARDRAILS.md), generated from the guard scripts.
`check:*` scripts are read-only; regenerate stale output with the matching
`generate:*` script or `--write` flag. `bun run check` also runs three
invariant tests worth knowing by name:
`tests/unit/catalog-compiler-smoke.test.ts` (every bundled preset compiles),
`tests/unit/mobile-viewport-matrix.test.ts` (mobile layout invariants), and
`packages/audio-reactive/tests/audio-lifecycle.test.ts` (audio ordering).

## Boundaries

- **`src/data/milkdrop-parity/`** — measured results, the certification corpus,
  and reference manifests are promotion outputs. Change them only through
  `parity:capture:projectm-native`, `parity:promote-reference`,
  `parity:promote-result`; direct edits break the provenance chain.
- **`tests/fixtures/milkdrop/projectm-reference/`** and `projectm-upstream/` —
  provenance-bound fixtures; regenerated, not hand-edited.
- **`scratch/`, `output/`, `screenshots/`** — measurement output, not source.
  `scratch/` and `output/` are gitignored. `screenshots/` is ignored except
  `aesthetic-audit/`, `butterchurn-support-sweep/` and `parity/`. Commit a
  screenshot only when a tracked report or manifest cites it, and never with
  `git add -f`.
- **`docs/authoring/reference.md`** — generated from `expression.ts` /
  `builtin-docs.ts`. Edit the source, then `bun run docs:authoring-reference`.
- **`docs/archive/` and dated `STATUS_*` docs** — historical records;
  `check:doc-references` skips them. Don't rewrite the past.
- **Canonical route** — product behaviour lives on `/`; `/milkdrop/` is a
  redirect alias.

## Commits, PRs, and deploys

- **Commits**: Conventional Commits (`type(scope): summary`), lowercase after
  the colon, no trailing period, at most 72 characters. The `commit-msg` hook
  and `check:commit-msg` reject a missing type prefix and vague subjects. See
  [`docs/COMMIT_CONVENTIONS.md`](docs/COMMIT_CONVENTIONS.md).
- **PRs**: the body says what changed, each check run with its result, and the
  docs touched; `bun run pr:body` scaffolds it and the
  [steward skill](.claude/skills/steward/SKILL.md) covers CI and squash-merges.
- **Deploys**: Cloudflare Workers Builds deploys the `stims` Worker on push
  (production from `main`, previews from other branches; config in
  `wrangler.site.jsonc`). CI only gates merges; `bun run site:deploy` is the
  manual fallback. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Further reading

| Doc | When |
| --- | --- |
| [`docs/agents/agent-handoffs.md`](docs/agents/agent-handoffs.md) | Bootstrap detail, shared-checkout rules, delegating work |
| [`docs/agents/tooling-and-quality.md`](docs/agents/tooling-and-quality.md) | Command details, gate tiers, dev modes |
| [`docs/agents/custom-capabilities.md`](docs/agents/custom-capabilities.md) | Choosing a skill |
| [`docs/agents/browser-automation.md`](docs/agents/browser-automation.md) | Agent API and URL flags |
| [`docs/agents/visual-testing.md`](docs/agents/visual-testing.md) | Browser QA with and without a GPU |
| [`docs/TESTING.md`](docs/TESTING.md) | Test profiles and CI coverage |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Boot path, engine seam, per-frame data flow |
| [`docs/PRODUCT_MOMENTS.md`](docs/PRODUCT_MOMENTS.md) | Which visitor moment a change serves |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Priorities and workstreams |
| [`docs/README.md`](docs/README.md) / [`docs/DOCS_MAINTENANCE.md`](docs/DOCS_MAINTENANCE.md) | Docs index and rules for changing docs |

## Tool-specific files

| File | Read by | Adds |
| --- | --- | --- |
| [`.claude/CLAUDE.md`](.claude/CLAUDE.md) | Claude Code | Imports this file, plus Claude Code notes |
| [`.claude/skills/steward/SKILL.md`](.claude/skills/steward/SKILL.md) | Claude Code; any agent opening a PR | PR and CI conventions |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md), `.github/prompts/` | GitHub Copilot | Copilot notes and prompt files |
| `.opencode/` | opencode (locally and via `/oc` on PRs) | Commands and modes |
| [`.github/AGENTS.md`](.github/AGENTS.md) | Tools that look under `.github/` | A pointer here |
