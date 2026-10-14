# Agent bootstrap and handoffs

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

3. Start your own worktree before editing (see [below](#working-in-a-tree-with-other-writers)), then keep a warm loop running there with `bun run dev:agent`: the dev server, a typecheck watcher and the fast test suite in watch mode.

4. Read in this order:
   - [`../../AGENTS.md`](../../AGENTS.md)
   - [`./custom-capabilities.md`](./custom-capabilities.md) when the task matches a repo-local skill
   - [`./tooling-and-quality.md`](./tooling-and-quality.md) before code edits

5. Choose the smallest validation loop that matches the task, then widen only when behavior changes justify it.

## Safe ownership slices

Use one owner per slice when work is parallelized:

| Slice | Primary files | Typical validation |
| --- | --- | --- |
| Runtime and shell | `src/js/core/`, `src/js/frontend/`, `src/css/`, app entry points | targeted test file, the covering `tests/e2e/` file, then `bun run check` |
| Presets and compatibility | `src/js/milkdrop/`, preset fixtures, catalog assets | targeted test file, `bun run test:compat`, then `bun run check` |
| Browser verification | tests, Playwright helpers, visual QA docs | `bun run dev`, `http://localhost:5173/?agent=true`, targeted browser checks |
| Docs and metadata | `docs/`, `AGENTS.md`, `.agent/`, MCP-facing markdown wiring | `bun run check:doc-references`, `bun run check:skill-index`, and `bun run test tests/unit/mcp-server.test.ts` if MCP wiring changed |

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

- **Work in your own worktree, on your own port.** `bun run worktree:new -- <branch>`
  creates a worktree off the latest `origin/main`, installs its dependencies,
  and prints its path; work only there. Run the dev server with
  `bun run dev -- --port <yours> --strictPort`. Anything you intend to trust —
  screenshots, parity captures, frame diffs — comes from that server, not from
  `:5173`. Remove the worktree with `git worktree remove <path>` once the branch
  is merged.
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

[`custom-capabilities.md`](./custom-capabilities.md#skills) is the skill index — use it to pick the right playbook before splitting or starting work.

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
