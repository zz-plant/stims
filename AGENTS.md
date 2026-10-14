# Stims agent guide

Stims plays and live-edits MilkDrop presets in the browser: Bun and TypeScript,
rendered by Three.js on WebGL or WebGPU. Every coding agent starts here; the
tool-specific files listed at the end point back to this one.

## 5-second bootstrap

```bash
bun run setup:codex --status   # is the repo ready?
bun run setup:codex             # install + quick-check if not
```

Several sessions often share the main checkout. Make each change in its own
worktree with `bun run worktree:new -- <branch>` and work only in the path it
prints; [agent handoffs](docs/agents/agent-handoffs.md#working-in-a-tree-with-other-writers)
explains why and how to keep ports and captures apart.

## Finding a command

This repo has **well over a hundred scripts** (the exact count drifts; `bun run help` is the source of truth). The tables below are a shortlist, not an inventory — never conclude a capability is missing because it isn't listed here.

```bash
bun run help                 # every script, grouped by namespace, with a one-line purpose
bun run help --json          # same index as {name, command, purpose} records
bun run help --for "<symptom>"   # symptom → instrument ("my preset looks wrong" → parity:capture)
```

`--for` exists because knowing a script exists is not the same as knowing it is
the right one. Reach for it before hand-rolling a measurement.

Each purpose line is generated from the docblock atop the script's file, so the index cannot drift from the code. `bun run check` fails if a script has no docblock summary (`bun run check:script-docs`).

Namespaces worth knowing before you hand-roll something: `lab:` (preset measurement), `parity:` (MilkDrop reference capture → diff → promote), `sweep:` (batch corpus runs), `perf:` / `bench:` / `profile:` (performance), `catalog:` (preset curation), `check:` (guards), `generate:` (idempotent artifacts, most take `--check`), `site:` / `preview:` (deploy).

## Ergonomics notes (from the last ~500 commits)

- **Hot spots**: `fix(milkdrop)` (shader/GLSL/HLSL translation, now in `packages/milkdrop-toolchain`) and `fix(webgpu)` dominate. Reproduce with `lab:replay` / `lab:nan-sweep`, fix the *class* across the corpus (not one preset), add a fixture, and check both backends with `lab:backend-diff`.
- **Search noise**: `.ignore` hides `public/milkdrop-presets/`, `output/`, `screenshots/`, and the parity fixtures from ripgrep. Use `rg --no-ignore <pat> <path>` to search them on purpose.
- **Learn pages**: `docs/authoring/*.md` and `docs/learn/*.md` are published as static pages under `public/learn/` (toil.fyi/learn/). After editing either, run `bun run generate:learn`; `check:seo` fails on stale pages, a missing sitemap entry, or a broken `/learn/…#anchor` link.
- **Generators**: most `generate:*` scripts take `--check`, including `generate:seo` (delegates to `check:seo`, writes nothing). Running `generate:seo` without it rewrites tracked icons/sitemaps — `git checkout -- public` if that was unintended.
- **Tests**: write behavioural tests that can fail (render via the workspace harness; mutate the behaviour once and watch the test go red) — see `.agent/skills/review-test-harness/SKILL.md`. Do not add source-text greps (`check:test-source-greps` blocks them).
- **Flakes**: never assert on timing. Use `__stims_agent.waitFor`; recent history removed several timing flakes from the gate suite. A test that times out only under load is usually CPU-bound on bun's 5 s default: `bun run test:budget` lists every gate test that relies on it and uses more than half (#1360, #1361 were two).
- **Duplicate PRs**: check for an open PR on the branch before pushing (#1209/#1210 and #1234/#1236 were re-pushes).
- **PR workflow**: read `.claude/skills/steward/SKILL.md` (what CI's shapes mean, which bot comments are noise, how to verify on the branch preview). Scaffold and check the body with `bun run pr:body`, writing the body file outside the repo; after a squash-merge use `bun run branch:restart`.
- **Software rendering**: on a GPU-less host (`bun run doctor` says so) correctness tools work but frame-time tools (`lab:profile`, `profile:frame`, `perf:*`, `bench:*`) time the CPU rasterizer and warn; do not draw performance conclusions from them.

## Daily commands

| Intent | Command | Time |
|--------|---------|------|
| Warm loop: dev server + typecheck watch + fast tests watch | `bun run dev:agent` | — |
| Start dev server only | `bun run dev` | — |
| Find the right script | `bun run help` | < 2s |
| Diagnose a broken environment | `bun run doctor` | < 30s |
| Fix "Executable doesn't exist" from a browser tool | `bun run setup:browsers` | < 5s |
| Fast syntax/lint/type check | `bun run check:quick` | about 30 s |
| Run exactly the guards and tests the diff can break | `bun run verify --changed` | < 1 min |
| Full quality gate | `bun run check` | 2–5 min |
| Run specific test | `bun run test tests/path/to/spec.test.ts` | varies |
| Run only tests affected by uncommitted changes | `bun run test:changed` | seconds |
| See every failing test in one run, not just the first | `bun run test -- --no-bail <files>` | varies |
| Browser e2e file covering a surface (map in `verify-visualizer-work`) | `bun run test tests/e2e/<file>.test.ts`; `bun run test:e2e` for all | varies |
| Compatibility tests | `bun run test:compat` | 1–2 min |
| Scaffold / check a PR description | `bun run pr:body` / `bun run pr:body -- --check <file>` | < 2s |
| Restart a branch after its PR was squash-merged | `bun run branch:restart` | < 5s |
| Start a change in its own worktree (other sessions share this checkout) | `bun run worktree:new -- <branch>` | ~30s |
| Setup and session status in one shot | `bun run agent:status` | < 5s |
| Which audio reaches which control or drawn program, read from the equations (no run) | `bun run lab:dataflow -- --preset <id>` (`--all` for the corpus) | instant / ~20s |
| Measure preset audio reactivity (no browser) | `bun run lab:reactivity -- --preset <id>` | ~15s |
| Measure preset visuals + pixel reactivity | `bun run lab:visual -- --preset <id>` | 1–3 min |
| Sweep whole corpus for NaN/compile/step failures (no browser) | `bun run lab:nan-sweep` | ~5–10 min |
| Check the editor's Format button changes no preset in the corpus (no browser) | `bun run lab:format-roundtrip` | ~40s |
| Record/replay a deterministic VM trace, bisect semantic drift | `bun run lab:replay -- --preset <id> --record t.json` | seconds |
| Diff a trace's compute-VM (GPU) replay against CPU, first divergent frame | `bun run lab:replay -- --replay t.json --tier gpu` | ~1 min |
| Capture a live-session trace for headless replay (agent mode) | `__milkdropRuntimeDebug.startTraceCapture()` / `stopTraceCapture()` in `?agent=true` | — |
| Audit preset flash-risk against WCAG 2.3.1 (the real instrument) | `bun run lab:flash-audit -- --count=50 --beat-pulse` | ~12min |
| Eyeball one preset's relative flash activity (placeholder heuristic, not a WCAG check) | `bun run lab:flash-risk -- --preset <id>` | ~10s |

Other dev modes, the gate tiers, and the optional LM Studio session scripts are in [Tooling and quality](docs/agents/tooling-and-quality.md); test profiles and CI coverage are in [Testing](docs/TESTING.md).

## Driving the running visualizer

Don't scrape the DOM or hand-roll sleep-and-poll loops — there is a first-class agent API, installed in **all** modes by `src/js/frontend/agent-state.ts`:

| Intent | Entry point |
|--------|-------------|
| Read engine/preset/audio/fps state as one JSON snapshot | `__stims_agent.getState()` |
| Wait for a condition instead of sleeping | `await __stims_agent.waitFor((s) => s.engineState === 'live')` |
| Run a command-palette action by stable id | `await __stims_agent.run('audio-demo')` — `listActions()` lists every action and the targeted verbs (`select-preset`, `set-field`, …) with their params |
| Read/await a preset's equation variables (q1…, zoom…) | `await __stims_agent.getVariables()` / `waitForVariables((v) => v.q1 > 0.5)` |
| Verify an effect after a transient toast vanished | `getState().statusLog` / `getEvents(sinceSeq)` |
| Assert the canvas is actually animating | `__stims_agent.captureStats()` twice, check `motionEstimate` |
| Drive a session from the shell, no MCP client | `bun run ctl -- --run next-preset --wait-for 's.presetId !== null'` — ordered `--run` / `--wait-for` steps, summary has `agent` state and per-step `events`, exits non-zero on a failed step |
| Check the iframe `postMessage` protocol the way an embedding site sees it | `bun run ctl -- --embed --post '{"type":"toil:load_preset","presetId":"geiss-casino"}'` — each `--post` records its `toil:status` reply; `tests/e2e/embed-bridge.test.ts` is the regression test |
| Expose these surfaces to an MCP client | `bun run mcp` |

Browser QA uses `http://localhost:5173/?agent=true`: without the flag a hidden tab stops rendering, and the black canvas reads as a shader failure. Use `/milkdrop/?agent=true` only to check the compatibility alias redirect. [Browser automation](docs/agents/browser-automation.md) is the full API reference and the one list of URL flags (`?renderer=`, `?mockAudio=demo`, `?lockQualityStep=`, …).

## Heavier instruments

Reach for these before inventing a measurement; each one already exists.

| Intent | Command |
|--------|---------|
| Capture → diff → promote a MilkDrop parity reference | `bun run parity:capture`, `parity:diff`, `parity:promote-result` |
| Diff every certified reference against latest captures | `bun run parity:suite` |
| Check WebGL and native WebGPU render the same frame (no external reference) | `bun run lab:backend-diff -- --sample 24` |
| Measure a preset's run-to-run parity noise before believing a delta | `bun run parity:noise -- --preset <id> --repeats 5 --write` |
| Find certified references a blank frame would pass | `bun run parity:check-references` |
| Frame-time budget across the certification corpus | `bun run perf:certification-corpus` (`perf:low-resource` for throttled) |
| Per-frame benchmark vs Butterchurn | `bun run bench:butterchurn` |
| Which variable diverged from Butterchurn, on which frame | `bun run trace:butterchurn` |
| Profile a single frame's cost | `bun run profile:frame` |
| Find presets that render blank/frozen/slow | `bun run sweep:milkdrop-loops` |
| Tally WebGL/WebGPU support across bundled presets | `bun run sweep:butterchurn` |
| Screenshot-diff the workspace UI | `bun run ui:diff` |
| Give a human (or a GPU-less agent) a real live URL | `bun run preview:deploy` |

## Where things live

| Area | Path | Use when changing… |
|------|------|-------------------|
| Workspace UI | `src/js/frontend/` | React UI, URL state, engine adapter |
| Shared runtime | `src/js/core/` | Renderer, shell, audio, capabilities, MIDI/VJ hardware (`services/webmidi-controller.ts`) |
| Preset system | `src/js/milkdrop/` | Presets, editor, catalog, VM, renderers |
| Standalone packages | `packages/` | Compiler, EEL JIT, formatter, exporter (`milkdrop-toolchain`); audio DSP (`audio-reactive`); flash governor and analysis (`flash-guard`); EEL conformance corpus. The app imports them; test with `bun run check:packages`. See `packages/README.md` |
| Stylesheets | `src/css/` | `tokens.css` (design tokens), `chrome.css` (panel/dock control system), `app-shell.css` (workspace shell, wrapped in `@scope (.stims-shell)`), `index.css` + `base.css` (older page-level styles), `*.module.css` (component-scoped) |
| Entry points | `index.html`, `milkdrop/index.html` | Shell loading, redirects |
| Tests | `tests/` | All automated coverage |
| Agent skills | `.agent/skills/` | Reusable playbooks |
| Agent docs | `docs/agents/` | Deep guidance |

[`docs/agents/src-map.md`](docs/agents/src-map.md) maps each area to its tests and guards.

## Code conventions

- TypeScript in strict mode; no `@ts-nocheck` (`check:no-ts-nocheck` blocks new ones).
- Imports are relative within the app; workspace packages are imported by package name (`milkdrop-toolchain/src/<module>.ts`).
- Root tests live in `tests/unit`, `tests/compat`, `tests/corpus`, or `tests/e2e` (the runner rejects a test file outside them); a package's tests stay in that package's `tests/`.
- Biome formats and lints; the pre-commit hook formats staged files before running `check:quick`.

## Skills

Repeatable work classes have playbooks in `.agent/skills/<name>/SKILL.md`. Pick one from the index in [`docs/agents/custom-capabilities.md`](docs/agents/custom-capabilities.md) before starting; they are plain Markdown, so open the file — no tool loads them for you.

## Done criteria

- **JS/TS changes**: `bun run check` passes. If it fails, fix the root cause; do not chain fix-attempt commits.
- **Runtime, preset, audio, shell, or routing changes**: also verify in a browser on `http://localhost:5173/?agent=true`, or with the headless tiers in [`verify-visualizer-work`](.agent/skills/verify-visualizer-work/SKILL.md) when no GPU is available.
- **Docs-only changes**: run the checks in the table below; typecheck and tests can be skipped unless commands, paths, or workflow-critical instructions changed.
- **Before pushing a dependency change**: `bun audit --audit-level=high`. CI runs it; the local gate does not.

Run what your change can break rather than the whole gate while iterating:

| Change touches | Verify with |
| --- | --- |
| `README.md`, `docs/`, agent files only | `bun run check:doc-references` + `bun run check:readme-claims` |
| `src/`, `scripts/` code | `bun run check:quick` |
| tests | `bun run test <file>` then `bun run check:quick` |
| `expression.ts` / `builtin-docs.ts` | `bun run docs:authoring-reference` then `bun run check:authoring-docs` |
| `public/milkdrop-presets/catalog.json` | `bun run check:catalog-integrity` + `bun run check:catalog-fidelity` |
| anything | `bun run verify --changed` |

Every guard, its tier and its rationale are in [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md), generated from the guard scripts; `check:*` scripts are read-only, so regenerate stale output with the matching `generate:*` script or `--write` flag. `bun run check` also runs three invariant tests worth knowing by name: `tests/unit/catalog-compiler-smoke.test.ts` (every bundled preset compiles), `tests/unit/mobile-viewport-matrix.test.ts` (mobile layout invariants), and `packages/audio-reactive/tests/audio-lifecycle.test.ts` (audio ordering: no leaked contexts, permission before mount).

## Boundaries

- **`src/data/milkdrop-parity/`** — measured results, the certification corpus,
  and reference manifests are promotion outputs. Change them only through the
  capture → import → promote workflow (`parity:capture:projectm-native`,
  `parity:promote-reference`, `parity:promote-result`); direct edits break the
  provenance chain.
- **`tests/fixtures/milkdrop/projectm-reference/`** and `projectm-upstream/` —
  provenance-bound fixtures; regenerated, not hand-edited.
- **`scratch/`, `output/`, and tool output under `screenshots/`** — measurement
  output, not source. `scratch/` and `output/` are gitignored outright.
  `screenshots/` is not: `.gitignore` ignores each capture tool's output
  directory there and allowlists the certified parity captures, so a new file
  can show up as committable. Commit a screenshot only when a tracked report or
  manifest cites it, and never with `git add -f`.
- **`docs/authoring/reference.md`** — generated from `expression.ts` /
  `builtin-docs.ts`. Edit the source, then `bun run docs:authoring-reference`.
- **`docs/archive/` and dated `STATUS_*` docs** — historical records.
  `check:doc-references` intentionally skips them; don't rewrite the past.
- **Canonical route** — product behaviour lives on `/`; `/milkdrop/` is a redirect alias.

## Commits, PRs, and deploys

- **Commits**: Conventional Commits (`type(scope): summary`), lowercase after the colon, no trailing period, at most 72 characters. The `commit-msg` hook and `check:commit-msg` reject a missing type prefix and vague subjects. See [`docs/COMMIT_CONVENTIONS.md`](docs/COMMIT_CONVENTIONS.md).
- **PRs**: the body says what changed, each check run with its result, and the docs touched; `bun run pr:body` scaffolds it and the [steward skill](.claude/skills/steward/SKILL.md) covers CI, bot comments and squash-merges.
- **Deploys**: Cloudflare Workers Builds deploys the `stims` Worker on push (production from `main`, previews from other branches; config in `wrangler.site.jsonc`). CI in `.github/workflows/ci.yml` only gates merges; `bun run site:deploy` is the manual fallback. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Further reading

| Doc | When |
|-----|------|
| [`docs/agents/agent-handoffs.md`](docs/agents/agent-handoffs.md) | Bootstrap detail, shared-checkout rules, delegating work |
| [`docs/agents/tooling-and-quality.md`](docs/agents/tooling-and-quality.md) | Command details, gate tiers, dev modes |
| [`docs/agents/custom-capabilities.md`](docs/agents/custom-capabilities.md) | Choosing a skill |
| [`docs/agents/browser-automation.md`](docs/agents/browser-automation.md) | Agent API and URL flags |
| [`docs/agents/visual-testing.md`](docs/agents/visual-testing.md) | Browser QA procedures and GPU-less environments |
| [`docs/TESTING.md`](docs/TESTING.md) | Test profiles and CI coverage |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Boot path, engine seam, per-frame data flow |
| [`docs/PRODUCT_MOMENTS.md`](docs/PRODUCT_MOMENTS.md) | Which visitor moment a change serves, what counts as correct there, standing product policies |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Priorities and workstreams across parity, runtime performance, product UX and release claims |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Current user-facing behaviour |
| [`docs/README.md`](docs/README.md) and [`docs/DOCS_MAINTENANCE.md`](docs/DOCS_MAINTENANCE.md) | The docs index and the rules for changing docs |

## Tool-specific files

| File | Read by | Adds |
| --- | --- | --- |
| [`.claude/CLAUDE.md`](.claude/CLAUDE.md) | Claude Code | Imports this file, plus Claude Code notes |
| [`.claude/skills/steward/SKILL.md`](.claude/skills/steward/SKILL.md) | Claude Code (auto-loaded); any agent opening a PR | PR and CI conventions |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md), `.github/prompts/` | GitHub Copilot | Copilot notes and prompt files |
| `.opencode/` | opencode (locally and via `/oc` comments on PRs) | Commands and modes |
| [`.github/AGENTS.md`](.github/AGENTS.md) | Tools that look under `.github/` | A pointer here |
