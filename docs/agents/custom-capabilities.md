# Repo-local Agent Capabilities

This repository ships reusable agent playbooks under `.agent/skills/` and `.agent/workflows/`.

Use this page when you need to decide:

- which repo-local skill or workflow to invoke,
- whether a capability is still aligned with current repo commands,
- which docs and validation steps should move with a capability change.

## How to choose

Use a **skill** when the request matches a repeatable class of work and you want concise instructions.

Use a **workflow** when you need a longer, step-by-step playbook with implementation and validation order.

In practice:

- reach for `.agent/skills/*/SKILL.md` first,
- open the matching `.agent/workflows/*.md` when the task spans multiple phases or needs a more explicit runbook.

## Skills

| Skill | Use when | Primary validation |
| --- | --- | --- |
| `.agent/skills/create-toy/SKILL.md` | Creating a new toy or scaffolding new toy files. | `bun run check:toys`, then `bun run check` |
| `.agent/skills/modify-toy/SKILL.md` | Updating an existing toy’s behavior, controls, metadata, or docs. | targeted tests while iterating, then `bun run check` |
| `.agent/skills/play-toy/SKILL.md` | Launching or visually checking a toy in the browser. | `bun run play:toy <slug>` or local `bun run dev` session |
| `.agent/skills/test-toy/SKILL.md` | Running toy-focused validation or full repo quality gates. | `bun run test …`, `bun run check:toys`, `bun run check` |
| `.agent/skills/ship-toy-change/SKILL.md` | End-to-end toy implementation + docs + PR-ready validation flow. | `bun run check:toys` when needed, then `bun run check` |

## Workflows

| Workflow | Use when | Notes |
| --- | --- | --- |
| `.agent/workflows/create-toy.md` | A new toy needs the full scaffold/register/validate flow. | Pairs with `docs/TOY_DEVELOPMENT.md` |
| `.agent/workflows/modify-toy.md` | A toy edit touches code plus metadata/docs/tests. | Good default for most toy refactors |
| `.agent/workflows/play-toy.md` | You need a real-browser toy verification runbook. | Prefer `?agent=true` URLs for stateful checks |
| `.agent/workflows/test-toy.md` | You need a deterministic testing checklist. | Prefer `bun run test`, not raw `bun test` |
| `.agent/workflows/ship-toy-change.md` | You need the full “implement, verify, finalize” sequence. | Best fit for PR-ready toy work |

## Related docs

- Day-to-day repo commands: [`../DEVELOPMENT.md`](../DEVELOPMENT.md)
- Toy implementation details: [`../TOY_DEVELOPMENT.md`](../TOY_DEVELOPMENT.md)
- Agent overlay index: [`./README.md`](./README.md)
- Toy workflow quick reference: [`./toy-workflows.md`](./toy-workflows.md)
- MCP capability discovery for `.agent/*`: [`../MCP_SERVER.md`](../MCP_SERVER.md)

## Maintenance rules

When you change `.agent/skills/*` or `.agent/workflows/*`, update in the same change:

- this file,
- [`./toy-workflows.md`](./toy-workflows.md) if command guidance changed,
- [`../README.md`](../README.md) if routing/discoverability changed,
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) if the maintenance contract changed.

Keep commands aligned with `package.json` scripts. Prefer:

- `bun run test …` over raw `bun test`,
- `bun run check` for the main JS/TS quality gate,
- `bun run check:toys` when toy metadata, slugs, or docs changed.
