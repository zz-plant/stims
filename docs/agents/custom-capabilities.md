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
| `.agent/skills/modify-visualizer-runtime/SKILL.md` | Updating shared runtime, loader, renderer, shell, controls, audio, capability checks, or routing. | targeted tests while iterating, then `bun run check` |
| `.agent/skills/modify-preset-workflow/SKILL.md` | Updating bundled presets, catalog/editor flows, import/export, compatibility, or preset fixtures/metadata. | targeted tests, then `bun run test:compat` or `bun run test:integration` as needed, then `bun run check` |
| `.agent/skills/play-visualizer/SKILL.md` | Launching or visually checking the flagship visualizer in the browser. | `bun run play:toy milkdrop` or local `bun run dev` session |
| `.agent/skills/test-visualizer/SKILL.md` | Running visualizer-focused validation or full repo quality gates. | `bun run test …`, `bun run test:integration`, `bun run test:compat`, `bun run check` |
| `.agent/skills/verify-visualizer-work/SKILL.md` | Quick validation checks during implementation; iterative testing without full quality gate. | `bun run check:quick`, `bun run test`, `bun run dev` with browser testing |
| `.agent/skills/ship-visualizer-change/SKILL.md` | End-to-end product-facing implementation + docs + PR-ready validation flow. | targeted checks as needed, then `bun run check` |

## Workflows

| Workflow | Use when | Notes |
| --- | --- | --- |
| `.agent/workflows/modify-visualizer-runtime.md` | A runtime change touches shared product behavior and needs implementation plus validation order. | Good default for loader/shell/audio/renderer work |
| `.agent/workflows/modify-preset-workflow.md` | A preset-system change touches catalog, editor, import/export, or compatibility behavior. | Good default for MilkDrop runtime work |
| `.agent/workflows/play-visualizer.md` | You need a real-browser visualizer verification runbook. | Prefer `?agent=true` URLs for stateful checks |
| `.agent/workflows/test-visualizer.md` | You need a deterministic testing checklist. | Prefer `bun run test`, not raw `bun test` |
| `.agent/workflows/ship-visualizer-change.md` | You need the full “implement, verify, finalize” sequence. | Best fit for PR-ready product work |

## Related docs

- Day-to-day repo commands: [`../DEVELOPMENT.md`](../DEVELOPMENT.md)
- Visualizer runtime and preset details: [`../MILKDROP_PRESET_RUNTIME.md`](../MILKDROP_PRESET_RUNTIME.md)
- Runtime architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Agent overlay index: [`./README.md`](./README.md)
- Visualizer workflow quick reference: [`./visualizer-workflows.md`](./visualizer-workflows.md)
- MCP capability discovery for `.agent/*`: [`../MCP_SERVER.md`](../MCP_SERVER.md)

## Maintenance rules

When you change `.agent/skills/*` or `.agent/workflows/*`, update in the same change:

- this file,
- [`./visualizer-workflows.md`](./visualizer-workflows.md) if command guidance changed,
- [`../README.md`](../README.md) if routing/discoverability changed,
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) if the maintenance contract changed.

Keep commands aligned with `package.json` scripts. Prefer:

- `bun run test …` over raw `bun test`,
- `bun run check` for the main JS/TS quality gate,
- targeted `bun run test:integration` or `bun run test:compat` when runtime or preset behavior changed.
