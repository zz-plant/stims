# Agent ergonomics retro — 2026-11-08

A review of what makes agent work in this repo slower than it needs to be, and
the changes that follow from it. The audience is the next agent session, not a
release note.

## Method

- 60 days of commit history (`453` commits) and 60 CI runs.
- The 65-entry worktree list and its disk use.
- The gate implementation and its output, measured on the same tree in text and
  quiet modes.
- The commands agents actually run: `check:quick`, `test:fast`,
  `test:changed`, `help`, `agent:status`.

## What already works

- `bun run help --for "<symptom>"` routes a symptom to the instrument that
  measures it. It is better than a script inventory because it says which
  instrument answers the question.
- `check:quick` is about 13 s, `check` about 2.5 min, and CI about 3 min.
- `test:fast` runs 4,465 tests across 478 files in about 101 s.
  `test:budget` ranks tests by CPU cost rather than wall time.
- The agent API (`__stims_agent`) and `bun run ctl` remove DOM scraping from
  browser work.
- `check:doc-references` already validates every `bun run <script>` named in
  agent-facing docs against `package.json`, so stale commands are caught.
- The guardrails page is generated from the guards, so it cannot drift.

## Findings

### 1. The main checkout is shared and actively mutated

During the review, `/Users/kanav/Dev/stims` switched from `feat/voice-vj` to
`feat/aesthetic-compass`, gained three untracked files, failed `check:quick` on
a file the reviewer had not written, went clean, and received a commit — all
inside about 20 minutes.

`docs/agents/agent-handoffs.md` documents this hazard, but nothing enforces it.
The cost is failed gates on another session's files, re-reading state, and the
risk of committing work that belongs to someone else.

### 2. Worktree sprawl

`git worktree list` returns 65 entries totalling 87.7 GB. `.claude/worktrees`
alone holds 21 GB across six worktrees, and nine branches are already merged
into `origin/main`. Each new worktree pays a full `bun install`.

There is no `worktree:prune`. Stale worktrees cost disk, slow scans, and make
the list unreadable at the moment an agent needs to pick a checkout.

### 3. The gate is about 10x louder outside Claude Code

Quiet mode auto-detected only `CLAUDECODE=1`. Measured on the same tree:

| Mode | Lines | Bytes | Approx. tokens |
| --- | --- | --- | --- |
| text | 335 | 17.5 KB | ~4.4k |
| `--quiet` | 49 | 1.7 KB | ~430 |

The failure path is worse: text mode prints every passing step and the full
diagnostic, which was 462 lines in one run.

### 4. CI red is concentrated in three browser files

Last 60 runs: 17 failures. Failing jobs: `step-budget` 7, `embed-snippet` 7,
`open-one-up` 6, `foldable-layout` 3, `engine-mount` 1, Quality gate 2, and
`CI Status` 16 (the aggregate, including false reds on superseded runs).

Observed causes:

- `step-budget`: a card position was sampled while the fold was still
  animating (`776 px` against a `<6 px` tolerance).
- `embed-snippet`: a menu click used Playwright's 15 s default.
- `open-one-up`: `bounded(..., 'waiting for startup selection')` used the 15 s
  page-call budget; a software-rendered runner can spend longer selecting and
  compiling a preset.

Each failed job costs 1.5–3 minutes plus a re-run. `step-budget` alone takes
about 170 s for six tests.

### 5. Context is duplicated across four docs

`AGENTS.md` is 220 lines / 29 KB (about 7k tokens), loaded every session and by
every subagent. It repeats the gate table, dev modes, test commands and
instrument tables that also live in `docs/agents/tooling-and-quality.md`,
`docs/TESTING.md` and `docs/DEVELOPMENT.md`. `AGENTS.md` alone contains 67
`bun run` references.

## Changes in this pass

- `agent-ergonomics.config.ts`: `gate.agentEnvs` now includes `OPENCODE`,
  `CURSOR_AGENT` and `GEMINI_CLI` alongside `CLAUDECODE`, so those sessions get
  quiet gate output. Covered by `tests/unit/run-quality-gate.test.ts`.
- `tests/e2e/open-one-up.test.ts`: `bounded` takes an optional deadline, and
  startup selection gets `LIVE_TIMEOUT_MS` (60 s) instead of the 15 s page-call
  budget.
- `tests/e2e/embed-snippet.test.ts`: the copy-menu click gets a 30 s timeout.
- `.github/workflows/ci.yml`: the CI Status aggregate treats `cancelled` as
  non-blocking. A superseded run is already marked cancelled; re-failing the
  aggregate only produced a red check on a commit nobody was watching.

## Round 2 (this PR)

The second pass acted on the backlog:

- **`ci:why`** — resolves a run (or `--pr <n>`), prints only the failing job,
  test, error, expected/received values and first stack frames, and links the
  job. It found the real `embed-snippet` failure in one call: the dock Share
  button, not the menu click the first pass patched.
- **`worktree:prune`** — dry run by default; `--apply` removes clean worktrees
  whose branch is merged into `origin/main`; `--all` widens to unmerged and
  `--force` to dirty. Bounds every git call so one stale path cannot hang the
  run.
- **`agent:start`** — branch, HEAD, dirty files, whether this is the shared
  main checkout, merged-worktree count, and the next commands.
- **`step-budget`** — the card position is read after the fold settles across
  two animation frames, and the 76 s Browse comparison gets its own CI runner.
- **`AGENTS.md`** — 29 KB → 12 KB; the full command and instrument tables moved
  to `docs/agents/tooling-and-quality.md`, which already owned them.
- **Install state** — `postinstall` records the fingerprint, so a fresh
  worktree's own `bun install` no longer reports "uncached" and invites a
  second install.

## Remaining backlog

1. **Bound quiet-mode failure output** — keep the first ~60 lines per failing
   step, write the full log to `.cache/gate/<step>.log`, and print the path.
2. **`test:changed` wording** — distinguish "no changes" from "changes have no
   dependent tests", and say how to run the affected file explicitly.

## What not to do

- Do not add guards for rules that have not recurred. The gate already has 38
  checks and the guardrails page is 898 lines.
- Do not refactor `agent-ergonomics`; extend it.
- Do not add blanket CI retries. The three flaky files have timing assumptions
  that can be fixed.
- Do not trim docs by deleting information; move it to the doc that owns it.
