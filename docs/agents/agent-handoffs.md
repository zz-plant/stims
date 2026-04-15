# Agent bootstrap and handoffs

Use this page when you need the fastest safe repo entry or when work may be split across multiple agents.

## 60-second bootstrap

1. Print the repo bootstrap plan:

   ```bash
   bun run setup:codex --print-plan
   ```

2. If the workspace state is unknown, run the default bootstrap:

   ```bash
   bun run setup:codex
   ```

   This installs dependencies and runs `bun run check:quick`.

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
- `visual`: keep the dev server hot for browser QA without extra watchers
- `full`: keep the dev server hot and run a unit-test watcher

Useful controls:

```bash
bun run session:codex -- --status
bun run session:codex -- --stop
# If you started a non-default port, repeat it here:
bun run session:codex -- --port 4173 --stop
```

## Safe ownership slices

Use one owner per slice when work is parallelized:

| Slice | Primary files | Typical validation |
| --- | --- | --- |
| Runtime and shell | `assets/js/core/`, `assets/js/frontend/`, router/bootstrap entrypoints | targeted test file, `bun run test:integration`, then `bun run check` |
| Presets and compatibility | `assets/js/milkdrop/`, preset fixtures, catalog assets | targeted test file, `bun run test:compat`, then `bun run check` |
| Browser verification | tests, Playwright helpers, visual QA docs | `bun run dev`, `http://localhost:5173/?agent=true`, targeted browser checks |
| Docs and metadata | `docs/`, `AGENTS.md`, `.agent/`, MCP-facing markdown wiring | docs link review, targeted tests if MCP/doc wiring changed |

Keep ownership crisp:

- Avoid splitting a single file family across multiple agents unless the task is already partitioned by file.
- Do not mix product code and docs cleanup in a sidecar task unless the docs must move with that code.
- Treat `/milkdrop/` as a compatibility alias; canonical product behavior lives on `/`.
- Avoid opportunistic refactors when the handoff is about a bounded fix.

## Fast routing

Use this map before opening deeper docs:

- runtime, shell, loader, renderer, audio, or routing: [`../../.agent/skills/modify-visualizer-runtime/SKILL.md`](../../.agent/skills/modify-visualizer-runtime/SKILL.md)
- presets, catalog, editor, import/export, or compatibility: [`../../.agent/skills/modify-preset-workflow/SKILL.md`](../../.agent/skills/modify-preset-workflow/SKILL.md)
- browser verification: [`../../.agent/skills/play-visualizer/SKILL.md`](../../.agent/skills/play-visualizer/SKILL.md) and [`./visual-testing.md`](./visual-testing.md)
- iterative checks during implementation: [`../../.agent/skills/verify-visualizer-work/SKILL.md`](../../.agent/skills/verify-visualizer-work/SKILL.md)
- end-to-end product work: [`../../.agent/skills/ship-visualizer-change/SKILL.md`](../../.agent/skills/ship-visualizer-change/SKILL.md)

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
