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

## Delegation guidance

When the work may be split across multiple agents, start with [`agent-handoffs.md`](./agent-handoffs.md) before assigning ownership. Use these boundaries:

- runtime and shell work: prefer one owner across `assets/js/core/`, `assets/js/frontend/`, and routing/bootstrap files that must evolve together
- preset and compatibility work: keep `assets/js/milkdrop/`, preset fixtures, and catalog metadata with one owner
- docs and MCP-facing metadata: keep `docs/`, `AGENTS.md`, `.agent/`, and `scripts/mcp-shared.ts` together when the change is about discoverability or workflow guidance
- browser QA: keep Playwright helpers, integration tests, and QA docs together when the task is primarily verification

If a task cannot be described with a clean file boundary and a small validation set, it is usually a bad candidate for delegation.

## Skills

| Skill | Use when | Primary validation |
| --- | --- | --- |
| `.agent/skills/modify-visualizer-runtime/SKILL.md` | Updating shared runtime, loader, renderer, shell, controls, audio, capability checks, or routing. | targeted tests while iterating, then `bun run check` |
| `.agent/skills/modify-preset-workflow/SKILL.md` | Updating bundled presets, catalog/editor flows, import/export, compatibility, or preset fixtures/metadata. | targeted tests, then `bun run test:compat` or `bun run test:integration` as needed, then `bun run check` |
| `.agent/skills/play-visualizer/SKILL.md` | Launching or visually checking the flagship visualizer in the browser. | `bun run play:toy milkdrop` or local `bun run dev` session |
| `.agent/skills/test-visualizer/SKILL.md` | Running visualizer-focused validation or full repo quality gates. | `bun run test …`, `bun run test:integration`, `bun run test:compat`, `bun run check` |
| `.agent/skills/verify-visualizer-work/SKILL.md` | Quick validation checks during implementation; iterative testing without full quality gate. | `bun run check:quick`, `bun run test`, `bun run dev` with browser testing |
| `.agent/skills/ship-visualizer-change/SKILL.md` | End-to-end product-facing implementation + docs + PR-ready validation flow. | targeted checks as needed, then `bun run check` |
| `.agent/skills/review-webgpu-parity/SKILL.md` | Reviewing PRs that touch WebGPU/WebGL dual-backend parity (feedback, shaders, renderer adapters). | `bun run test:compat`, targeted parity tests, reference preset visual check |
| `.agent/skills/review-renderer-fallback/SKILL.md` | Reviewing PRs that touch renderer capability probing, fallback chains, timeout logic, or audio worklet init. | `bun run test:integration`, trace renderScale end-to-end, validate fallback paths |
| `.agent/skills/review-test-harness/SKILL.md` | Reviewing PRs that add, modify, or remove tests, fixtures, or integration harness code. | `bun run test`, behavior-based assertion review, fixture determinism check |
| `.agent/skills/review-workspace-ui-state/SKILL.md` | Reviewing PRs that touch React workspace UI state, URL routing, toast/panel behavior, or engine adapter boundary. | `bun run test tests/frontend-url-state.test.ts`, adapter boundary inspection |
| `.agent/skills/audit-recurring-fixes/SKILL.md` | Auditing commit history to find recurring fix patterns and updating prevention skills. | `git log` analysis, cross-reference with `docs/RECURRING_FIX_PATTERNS_AUDIT_*.md` |
| `.agent/skills/iterate-visualizer-ui/SKILL.md` | Iterating on workspace UI, shell chrome, and CSS with fast feedback loops and component isolation. | `bun run dev:ui`, isolated component playground, screenshot diff, responsive grid |
| `.agent/skills/quick-start/SKILL.md` | First entry into the repo or after a long gap; fastest safe path to productive work. | `bun run agent:status`, `bun run setup:codex` |
| `.agent/skills/agent-ergonomics/SKILL.md` | Understanding how skills, workflows, sessions, and gates fit together; improving agent infrastructure. | Read-only, then apply changes |

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
- Agent bootstrap and handoffs: [`./agent-handoffs.md`](./agent-handoffs.md)
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
