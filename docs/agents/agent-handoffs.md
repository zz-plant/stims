# Agent bootstrap and handoffs

Use this page when you need the fastest safe repo entry or when work may be split across multiple agents.

## 60-second bootstrap

1. Check local readiness, then print the repo bootstrap plan:

   ```bash
   bun run setup:codex --status
   ```

   ```bash
   bun run setup:codex --print-plan
   ```

2. If the workspace state is unknown, run the default bootstrap:

   ```bash
   bun run setup:codex
   ```

   This installs dependencies and runs `bun run check:quick`. Repeated runs skip `bun install` automatically when `node_modules` and the local manifest fingerprint already look current.

   When you want a warmer long-lived session on a machine that exposes the local helper commands, use:

   ```bash
   bun run session:codex -- --profile review
   ```

3. Read in this order:
   - [`../../AGENTS.md`](../../AGENTS.md)
   - [`./README.md`](./README.md)
   - [`./custom-capabilities.md`](./custom-capabilities.md) when the task matches a repo-local skill/workflow
   - [`./tooling-and-quality.md`](./tooling-and-quality.md) before code edits

4. Choose the smallest validation loop that matches the task, then widen only when behavior changes justify it.

## Session profiles

Use the profile that matches the work:

- `fast`: warm the fast local model role and keep the dev server hot
- `review`: warm fast and quality local model roles, keep the dev server hot, and run a background typecheck watcher
- `compat`: keep the dev server hot and run a compatibility watcher
- `integration`: keep the dev server hot and run an integration watcher
- `parity`: keep the dev server hot for parity and perf capture runs
- `visual`: keep the dev server hot for browser QA without extra watchers
- `full`: keep the dev server hot and run a unit-test watcher

Useful controls:

```bash
bun run session:codex -- --status
bun run session:codex -- --stop
# If you started a non-default port, repeat it here:
bun run session:codex -- --port 4173 --stop
```

For local model routing before you split work, use:

```bash
bun run model:codex -- --mode auto --task "triage a runtime regression" --no-exec
```

## Safe ownership slices

Use one owner per slice when work is parallelized:

| Slice | Primary files | Typical validation |
| --- | --- | --- |
| Runtime and shell | `src/js/core/`, `src/js/frontend/`, `src/css/`, app entry points | targeted test file, `bun run test:integration`, then `bun run check` |
| Presets and compatibility | `src/js/milkdrop/`, preset fixtures, catalog assets | targeted test file, `bun run test:compat`, then `bun run check` |
| Browser verification | tests, Playwright helpers, visual QA docs | `bun run dev`, `http://localhost:5173/?agent=true`, targeted browser checks |
| Docs and metadata | `docs/`, `AGENTS.md`, `.agent/`, MCP-facing markdown wiring | docs link review, targeted tests if MCP/doc wiring changed |

Keep ownership crisp:

- Avoid splitting a single file family across multiple agents unless the task is already partitioned by file.
- Do not mix product code and docs cleanup in a sidecar task unless the docs must move with that code.
- Treat `/milkdrop/` as a compatibility alias; canonical product behavior lives on `/`.
- Avoid opportunistic refactors when the handoff is about a bounded fix.

## Working in a tree with other writers

Several agents and sessions routinely share this checkout, and the tooling
assumes a single writer: one dev server on `:5173`, fixed lab ports, artifacts
in shared `screenshots/` paths. That assumption has produced measurably wrong
results — a screenshot taken while another session's edit hot-reloaded, a
capture of a preset another session had edited in place. Treat the shared tree
as read-mostly:

- **Verify in your own worktree, on your own port.** `git worktree add --detach
  <tmpdir> HEAD`, symlink the repo's `node_modules` into it, copy in only the
  files you changed, and run `bunx vite --port <yours> --strictPort` there.
  Anything you intend to trust — screenshots, parity captures, frame diffs —
  comes from that server, not from `:5173`. Remove the worktree when done.
- **Never `git stash` and never `git checkout` a file you did not write.** A
  `stash pop` in a shared tree can pop someone else's entry and conflict in a
  file you have never opened. Stage and commit by explicit path, never `-A`.
- **Capture serially.** Parallel GPU captures contend and silently produce black
  or over-bright frames, which read as parity failures.
- **A red gate is not always yours.** When `check:quick` fails on a file you did
  not touch, do not bypass the hook: commit through a clean worktree instead —
  apply your staged diff there, run the gate against an otherwise-clean tree,
  commit, then fast-forward the branch to that commit. The gate still ran on
  your change; it just ran without someone else's half-finished work in frame.

## Fast routing

[`custom-capabilities.md`](./custom-capabilities.md#skills) is the canonical skill/workflow routing table — use it to pick the right playbook before splitting or starting work.

## Handoff packet

When assigning work to a subagent, include:

- **Task**: one sentence describing the desired outcome.
- **Owned files or directories**: the exact write scope.
- **Constraints**: product rules, compatibility expectations, or docs that must stay aligned.
- **Validation**: the minimum commands or browser checks expected before return.
- **Return contract**: changed files, tests run, open questions, and any follow-up risk.

Use this template:

```text
Task:
Owned files:
Do not edit:
Constraints:
Validation:
Return with:
- changed files
- tests run
- open questions / risks
```

## Return contract

A useful subagent return should answer these questions without extra digging:

- What changed?
- Which files were touched?
- Which commands were run, and did they pass?
- What was not verified?
- Is there any cross-slice follow-up for the integrating agent?

## When not to split work

Keep the task with one agent when:

- the next action is blocked on immediate code understanding in one file cluster,
- the change is mostly exploration rather than implementation,
- the work depends on fast iteration between code edits and browser verification,
- or the write scope is too intertwined to assign clean ownership.
