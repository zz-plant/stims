# Cline Agent Quick Start — Stims

Single-page entry for Cline working on the Stims visualizer. Read this first, then dive deep via progressive disclosure when needed.

## 5-second bootstrap

```bash
bun run setup:codex --status   # is the repo ready?
bun run setup:codex             # install + quick-check if not
```

## Finding a command

This repo has **127 scripts**. The tables below are a shortlist, not an inventory — never conclude a capability is missing because it isn't listed here.

```bash
bun run help                 # every script, grouped by namespace, with a one-line purpose
bun run help --json          # same index as {name, command, purpose} records
bun run help --for "<symptom>"   # symptom → instrument ("my preset looks wrong" → parity:capture)
```

`--for` exists because knowing a script exists is not the same as knowing it is
the right one. Reach for it before hand-rolling a measurement.

Each purpose line is generated from the docblock atop the script's file, so the index cannot drift from the code. `bun run check` fails if a script has no docblock summary (`bun run check:script-docs`).

Namespaces worth knowing before you hand-roll something: `lab:` (preset measurement), `parity:` (MilkDrop reference capture → diff → promote), `sweep:` (batch corpus runs), `perf:` / `bench:` / `profile:` (performance), `catalog:` (preset curation), `check:` (guards), `generate:` (idempotent artifacts, most take `--check`), `site:` / `preview:` (deploy).

## Daily commands

| Intent | Command | Time |
|--------|---------|------|
| Start dev server | `bun run dev` | — |
| Find the right script | `bun run help` | < 2s |
| Diagnose a broken environment | `bun run doctor` | < 30s |
| Fast syntax/lint/type check | `bun run check:quick` | < 30s |
| Full quality gate | `bun run check` | 2–5 min |
| Run specific test | `bun run test tests/path/to/spec.test.ts` | varies |
| Run only tests affected by uncommitted changes | `bun run test:changed` | seconds |
| Integration tests | `bun run test:integration` | 1–2 min |
| Compatibility tests | `bun run test:compat` | 1–2 min |
| Warm long-lived session | `bun run session:codex -- --profile review` | — |
| Check everything at once | `bun run agent:status` | < 5s |
| Quick verify loop | `bun run agent:verify` | < 1 min |
| Measure preset audio reactivity (no browser) | `bun run lab:reactivity -- --preset <id>` | ~15s |
| Measure preset visuals + pixel reactivity | `bun run lab:visual -- --preset <id>` | 1–3 min |
| Sweep whole corpus for NaN/compile/step failures (no browser) | `bun run lab:nan-sweep` | ~5–10 min |
| Record/replay a deterministic VM trace, bisect semantic drift | `bun run lab:replay -- --preset <id> --record t.json` | seconds |
| Diff a trace's compute-VM (GPU) replay against CPU, first divergent frame | `bun run lab:replay -- --replay t.json --tier gpu` | ~1 min |
| Capture a live-session trace for headless replay (agent mode) | `__milkdropRuntimeDebug.startTraceCapture()` / `stopTraceCapture()` in `?agent=true` | — |
| Audit preset flash-risk against WCAG 2.3.1 (the real instrument) | `bun run lab:flash-audit -- --count=50 --beat-pulse` | ~12min |
| Eyeball one preset's relative flash activity (placeholder heuristic, not a WCAG check) | `bun run lab:flash-risk -- --preset <id>` | ~10s |

## Driving the running visualizer

Don't scrape the DOM or hand-roll sleep-and-poll loops — there is a first-class agent API, installed in **all** modes by `src/js/frontend/agent-state.ts`:

| Intent | Entry point |
|--------|-------------|
| Read engine/preset/audio/fps state as one JSON snapshot | `__stims_agent.getState()` |
| Wait for a condition instead of sleeping | `await __stims_agent.waitFor((s) => s.engineState === 'live')` |
| Run a command-palette action by stable id | `await __stims_agent.run('audio-demo')` — `listActions()` enumerates ~21 |
| Verify an effect after a transient toast vanished | `getState().statusLog` / `getEvents(sinceSeq)` |
| Assert the canvas is actually animating | `__stims_agent.captureStats()` twice, check `motionEstimate` |
| Drive a session from the shell, no MCP client | `bun run ctl` |
| Expose these surfaces to an MCP client | `bun run mcp` |

Full reference: [`docs/agents/browser-automation.md`](../docs/agents/browser-automation.md). Useful URL flags: `?agent=true` (keeps rendering while the tab reports hidden — a Browser-pane tab always does, and without it the canvas goes black and reads as a shader failure), `?renderer=webgl`, `?mockAudio=1`, `?lockQualityStep=`.

## Heavier instruments

Reach for these before inventing a measurement; each one already exists.

| Intent | Command |
|--------|---------|
| Capture → diff → promote a MilkDrop parity reference | `bun run parity:capture`, `parity:diff`, `parity:promote-result` |
| Diff every certified reference against latest captures | `bun run parity:suite` |
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
| Preset system | `src/js/milkdrop/` | Presets, editor, catalog, VM |
| Stylesheets | `src/css/` | `tokens.css` (design tokens), `chrome.css` (panel/dock control system), `app-shell.css` (workspace shell, wrapped in `@scope (.stims-shell)`), `index.css` + `base.css` (older page-level styles), `*.module.css` (component-scoped) |
| Entry points | `index.html`, `milkdrop/index.html` | Shell loading, redirects |
| Tests | `tests/` | All automated coverage |
| Agent skills | `.agent/skills/` | Reusable playbooks |
| Agent docs | `docs/agents/` | Deep guidance |

## "What do I do now?" decision tree

1. **Repo state unknown?** → `bun run setup:codex`
2. **Need a skill for this task?** → See [Task routing](#task-routing)
3. **Just editing code?** → `bun run check:quick` after edits
4. **Ready to commit?** → `bun run check`
5. **Need browser QA?** → `bun run dev` → `http://localhost:5173/?agent=true`
6. **Need a long-lived session?** → `bun run session:codex -- --profile review`

## Task routing

Use `.agent/skills/*/SKILL.md` for repeatable work classes:

| If the task is mainly about… | Skill |
| --- | --- |
| runtime, renderer, shell, controls, audio, URL state | `.agent/skills/modify-visualizer-runtime/SKILL.md` |
| presets, catalog, editor, import/export, compatibility | `.agent/skills/modify-preset-workflow/SKILL.md` |
| preset visual fidelity / audio reactivity tuning (measured baseline→edit→compare) | `.agent/skills/improve-preset-fidelity/SKILL.md` |
| browser QA or visual confirmation | `.agent/skills/play-visualizer/SKILL.md` |
| performing / jamming — live-coded audio + timed visual gestures | `.agent/skills/perform-livecoding/SKILL.md` |
| quick iterative verification | `.agent/skills/verify-visualizer-work/SKILL.md` |
| end-to-end product change → PR | `.agent/skills/ship-visualizer-change/SKILL.md` |
| UI iteration, shell chrome, CSS | `.agent/skills/iterate-visualizer-ui/SKILL.md` |
| knowing which guardrails apply before editing | `.agent/skills/guard-agent-work/SKILL.md` |

Use `.agent/workflows/*.md` when you need a step-by-step runbook with explicit phase order.

## Agent mode URL

Always use `http://localhost:5173/?agent=true` for browser-based QA. It persists state across reloads and enables cleaner debug output.

## Quality gate reminder

- Every enforced rule, with its rationale, is listed in [`docs/GUARDRAILS.md`](../docs/GUARDRAILS.md) (generated from the guard scripts by `bun run generate:guardrails`)
- `bun run check:quick` = `@ts-nocheck` guard + Biome + catalog fidelity/integrity + toy manifest + SEO + architecture + typecheck, no tests
- `bun run check` = everything above, preceded by `assets:check`, plus the fast test suite (`unit` + `compat`; skips the slow corpus/e2e tests)
- `bun run check:all` = the same gate with the full test suite, including corpus and e2e
- Run `check:quick` often; run `check` before any commit/PR

## Progressive disclosure

| Depth | Doc | When |
|-------|-----|------|
| This page | `.claude/CLAUDE.md` | Every session start |
| Agent essentials | `AGENTS.md` | Non-negotiable defaults |
| Bootstrap + handoffs | `docs/agents/agent-handoffs.md` | Delegating work |
| Capability index | `docs/agents/custom-capabilities.md` | Choosing skills/workflows |
| System map | `docs/ARCHITECTURE.md` | Boot path, engine seam, per-frame data flow |
| Tooling reference | `docs/agents/tooling-and-quality.md` | Command details |
| Visual testing | `docs/agents/visual-testing.md` | Browser QA procedures |
| Deep reference | `docs/agents/reference-docs.md` | Unfamiliar code areas |
