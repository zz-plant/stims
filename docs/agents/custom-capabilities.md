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

- runtime and shell work: prefer one owner across `src/js/core/`, `src/js/frontend/`, `src/css/`, and app entry points that must evolve together
- preset and compatibility work: keep `src/js/milkdrop/`, preset fixtures, and catalog metadata with one owner
- docs and MCP-facing metadata: keep `docs/`, `AGENTS.md`, `.agent/`, and `scripts/mcp-shared.ts` together when the change is about discoverability or workflow guidance
- browser QA: keep Playwright helpers, integration tests, and QA docs together when the task is primarily verification

If a task cannot be described with a clean file boundary and a small validation set, it is usually a bad candidate for delegation.

## Skills

| Skill | Use when | Primary validation |
| --- | --- | --- |
| `.agent/skills/modify-visualizer-runtime/SKILL.md` | Updating shared runtime, loader, renderer, shell, controls, audio, capability checks, or routing. | targeted tests while iterating, then `bun run check` |
| `.agent/skills/modify-preset-workflow/SKILL.md` | Updating bundled presets, catalog/editor flows, import/export, compatibility, or preset fixtures/metadata. | targeted tests, then `bun run test:compat` or `bun run test:integration` as needed, then `bun run check` |
| `.agent/skills/improve-preset-fidelity/SKILL.md` | Tuning a preset's visual fidelity or audio reactivity with measured baseline→edit→compare loops; works without vision or hearing (numeric reports), with contact-sheet images for vision-capable agents. | `bun run lab:reactivity -- --preset <id> --compare`, `bun run lab:visual -- --preset <id> --compare`, then `bun run check:quick` |
| `.agent/skills/play-visualizer/SKILL.md` | Launching or visually checking the flagship visualizer in the browser. | `bun run play:toy milkdrop` or local `bun run dev` session |
| `.agent/skills/perform-livecoding/SKILL.md` | Performing or jamming on the instrument: live-coded Strudel audio driving the visuals, plus timed visual gestures. Not for fidelity tuning or QA. | MCP `session_play_pattern` / `session_ramp` / `session_listen`, or `window.__stims_live` on any `?agent=true` page |
| `.agent/skills/test-visualizer/SKILL.md` | Running visualizer-focused validation or full repo quality gates. | `bun run test …`, `bun run test:integration`, `bun run test:compat`, `bun run check` |
| `.agent/skills/verify-visualizer-work/SKILL.md` | Quick validation checks during implementation; iterative testing without full quality gate. | `bun run check:quick`, `bun run test`, `bun run dev` with browser testing |
| `.agent/skills/ship-visualizer-change/SKILL.md` | End-to-end product-facing implementation + docs + PR-ready validation flow. | targeted checks as needed, then `bun run check` |
| `.agent/skills/review-webgpu-parity/SKILL.md` | Reviewing PRs that touch WebGPU/WebGL dual-backend parity (feedback, shaders, renderer adapters). | `bun run test:compat`, targeted parity tests, reference preset visual check |
| `.agent/skills/review-renderer-fallback/SKILL.md` | Reviewing PRs that touch renderer capability probing, fallback chains, timeout logic, or audio worklet init. | `bun run test:integration`, trace renderScale end-to-end, validate fallback paths |
| `.agent/skills/review-test-harness/SKILL.md` | Reviewing PRs that add, modify, or remove tests, fixtures, or integration harness code. | `bun run test`, behavior-based assertion review, fixture determinism check |
| `.agent/skills/review-workspace-ui-state/SKILL.md` | Reviewing PRs that touch React workspace UI state, URL routing, toast/panel behavior, or engine adapter boundary. | `bun run test tests/unit/frontend-url-state.test.ts`, adapter boundary inspection |
| `.agent/skills/review-deploy-tooling/SKILL.md` | Reviewing PRs that touch CI, wrangler config, build scripts, Cloudflare deploy, or package.json tooling. | `bun run build`, `bun run preview`, verify wrangler.site.jsonc and CI workflow integrity |
| `.agent/skills/review-module-loading/SKILL.md` | Reviewing PRs that touch module loading, bootstrap, toy manifest, library resolution, or gamepad polling. | `bun run check:toys`, validate manifest regeneration, gamepad lifecycle |
| `.agent/skills/audit-recurring-fixes/SKILL.md` | Auditing commit history to find recurring fix patterns and updating prevention skills. | `git log` analysis, cross-reference with `docs/RECURRING_FIX_PATTERNS_AUDIT_*.md` |
| `.agent/skills/iterate-visualizer-ui/SKILL.md` | Iterating on workspace UI, shell chrome, and CSS with fast feedback loops and component isolation. | `bun run dev:ui`, isolated component playground, screenshot diff, responsive grid |
| `.agent/skills/quick-start/SKILL.md` | First entry into the repo or after a long gap; fastest safe path to productive work. | `bun run agent:status`, `bun run setup:codex` |
| `.agent/skills/agent-ergonomics/SKILL.md` | Understanding how skills, workflows, sessions, and gates fit together; improving agent infrastructure. | Read-only, then apply changes |
| `.agent/skills/guard-agent-work/SKILL.md` | Starting any coding session; surfaces the guardrails for the surface you are about to touch. | `git diff --name-only HEAD` to classify, then the per-surface verify command |
| `.agent/skills/qa/SKILL.md` | Running the quality gate itself and knowing which profile to run at which stage. | `bun run check:quick` → `bun run check` → `bun run check:all` |

### Review skills are data-driven

The six `review-*` skills aren't generic checklists — each targets the category responsible for the largest share of historical fix commits in this repo (125 sampled), ranked here from highest to lowest:

| Rank | Category | Share of fix commits | Skill |
| --- | --- | --- | --- |
| 1 | WebGPU/WebGL parity drift | ~22% | `.agent/skills/review-webgpu-parity/SKILL.md` |
| 2 | Workspace UI state races | ~18% | `.agent/skills/review-workspace-ui-state/SKILL.md` |
| 3 | Deploy/tooling (CI, wrangler, build) | ~16% | `.agent/skills/review-deploy-tooling/SKILL.md` |
| 4 | Test harness drift | ~15% | `.agent/skills/review-test-harness/SKILL.md` |
| 5 | Module-loading regressions | ~11% | `.agent/skills/review-module-loading/SKILL.md` |
| 6 | Renderer fallback chain | ~8% | `.agent/skills/review-renderer-fallback/SKILL.md` |

Apply the matching skill whenever a PR touches that category — reviewing with it catches the exact regression classes this repo has shipped most often. The ranking is not static: `.agent/skills/audit-recurring-fixes/SKILL.md` re-mines commit history periodically and updates these skills (and this table) when the distribution shifts.

## Workflows

| Workflow | Use when | Notes |
| --- | --- | --- |
| `.agent/workflows/modify-visualizer-runtime.md` | A runtime change touches shared product behavior and needs implementation plus validation order. | Good default for loader/shell/audio/renderer work |
| `.agent/workflows/modify-preset-workflow.md` | A preset-system change touches catalog, editor, import/export, or compatibility behavior. | Good default for MilkDrop runtime work |
| `.agent/workflows/play-visualizer.md` | You need a real-browser visualizer verification runbook. | Prefer `?agent=true` URLs for stateful checks |
| `.agent/workflows/test-visualizer.md` | You need a deterministic testing checklist. | Prefer `bun run test`, not raw `bun test` |
| `.agent/workflows/ship-visualizer-change.md` | You need the full “implement, verify, finalize” sequence. | Best fit for PR-ready product work |
| `.agent/workflows/qa.md` | You need the full QA suite run and summarized. | Pairs with the `qa` skill |
| `.agent/workflows/deploy.md` | You are deploying to Cloudflare Pages. | Confirm the target environment before running deploy scripts |

## Related docs

- Day-to-day repo commands: [`../DEVELOPMENT.md`](../DEVELOPMENT.md)
- Visualizer runtime and preset details: [`../MILKDROP_PRESET_RUNTIME.md`](../MILKDROP_PRESET_RUNTIME.md)
- Runtime architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Current project status and next targets: [`../STATUS_2026-05.md`](../STATUS_2026-05.md)
- Release evidence ledger (certified/open/pending): [`../evidence/RELEASE_EVIDENCE_LEDGER_2026-05.md`](../evidence/RELEASE_EVIDENCE_LEDGER_2026-05.md)
- Public claim audit findings: [`../evidence/public-claim-audit.md`](../evidence/public-claim-audit.md)
- Shader compiler support inventory: [`../architecture/shader-support-inventory.md`](../architecture/shader-support-inventory.md)
- Renderer fallback state machine design: [`../architecture/fallback-state-machine.md`](../architecture/fallback-state-machine.md)
- Rasterization fidelity audit (WebGL vs WebGPU): [`../architecture/rasterization-fidelity-audit.md`](../architecture/rasterization-fidelity-audit.md)
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
