# Repo-local Agent Capabilities

The repo's reusable playbooks live in `.agent/skills/<name>/SKILL.md`, and this
page is their one index. They are plain Markdown that an agent opens when a task
matches; no tool loads them automatically or exposes them as slash commands.
Claude Code auto-loads only `.claude/skills/`, which holds the
[`steward`](../../.claude/skills/steward/SKILL.md) PR skill. MCP clients reach the
same skills through `list_agent_capabilities` and `read_agent_capability`
([MCP server](../MCP_SERVER.md)).

## Check the script index first

Skills name only the commands their author needed. The repo ships well over a
hundred scripts, and the table below is not an inventory of them.

```bash
bun run help          # every script, grouped by namespace, with a one-line purpose
bun run help --json   # {name, command, purpose} records
```

Purpose lines are generated from the docblock atop each script, and
`bun run check:script-docs` fails when one is missing. Whole namespaces
(`parity:`, `sweep:`, `perf:`, `bench:`, `profile:`, `catalog:`) are absent from
the skills by omission, so check the index before concluding the repo lacks a
capability.

For driving a running visualizer, see [`browser-automation.md`](./browser-automation.md).

## Skills

| Skill | Use when | Primary validation |
| --- | --- | --- |
| `.agent/skills/guard-agent-work/SKILL.md` | Starting any coding session; surfaces the guardrails for the surface you are about to touch. | `git diff --name-only HEAD` to classify, then the per-surface verify command |
| `.agent/skills/verify-visualizer-work/SKILL.md` | Choosing and running checks: the edit-time loop, which e2e file covers a surface, visual evidence with or without a GPU, reproducing a CI failure. | `bun run check:quick` → targeted tests → `bun run check` |
| `.agent/skills/modify-visualizer-runtime/SKILL.md` | Updating shared runtime, loader, renderer, shell, controls, audio, capability checks, or routing. | targeted tests and the covering e2e file, then `bun run check` |
| `.agent/skills/modify-preset-workflow/SKILL.md` | Updating bundled presets, catalog/editor flows, import/export, compatibility, or preset fixtures/metadata. | targeted tests, `bun run test:compat`, then `bun run check` |
| `.agent/skills/improve-preset-fidelity/SKILL.md` | Tuning a preset's visual fidelity or audio reactivity with measured baseline→edit→compare loops; works without vision or hearing. | `bun run lab:reactivity -- --preset <id> --compare`, `bun run lab:visual -- --preset <id> --compare` |
| `.agent/skills/close-parity-gap/SKILL.md` | Diagnosing and closing a rendering gap against native projectM: trusting the capture before the number, picking a gradable reference, judging deltas against noise bands. | `bun run parity:capture -- --preset <id>`, `bun run parity:suite`, `bun run sweep:milkdrop-loops` for WebGL |
| `.agent/skills/play-visualizer/SKILL.md` | Launching or visually checking the visualizer in a browser. | `bun run play:toy milkdrop` or `bun run dev` |
| `.agent/skills/perform-livecoding/SKILL.md` | Performing on the instrument: live-coded Strudel audio driving the visuals, plus timed visual gestures. Not for fidelity tuning or QA. | MCP `session_play_pattern` / `session_ramp` / `session_listen`, or `window.__stims_live` on a `?agent=true` page |
| `.agent/skills/iterate-visualizer-ui/SKILL.md` | Iterating on workspace UI, shell chrome, and CSS with component isolation. | `bun run dev:ui`, `bun run ui:diff` |
| `.agent/skills/ship-visualizer-change/SKILL.md` | Carrying a product-facing change through implementation, docs and validation to PR-ready. | targeted checks, then `bun run check` |
| `.agent/skills/review-webgpu-parity/SKILL.md` | Reviewing PRs that touch WebGPU/WebGL parity (feedback, shaders, renderer adapters). | `bun run test:compat`, `bun run parity:suite` against noise bands, `bun run sweep:milkdrop-loops` |
| `.agent/skills/review-renderer-fallback/SKILL.md` | Reviewing PRs that touch renderer capability probing, fallback chains, timeouts, or audio worklet init. | renderer unit tests plus `tests/e2e/agent-boot-smoke.test.ts` and `tests/e2e/e2e-engine-mount.test.ts` |
| `.agent/skills/review-test-harness/SKILL.md` | Reviewing PRs that add, modify, or remove tests, fixtures, or harness code. | `bun run test`, behaviour-based assertion review, fixture determinism |
| `.agent/skills/review-workspace-ui-state/SKILL.md` | Reviewing PRs that touch React workspace state, URL routing, toast/panel behaviour, or the engine adapter boundary. | `bun run test tests/unit/frontend-url-state.test.ts`, adapter boundary inspection |
| `.agent/skills/review-deploy-tooling/SKILL.md` | Reviewing CI, wrangler, build or `package.json` tooling changes, and shipping the site Worker. | `bun run build`, `bun run site:check` |
| `.agent/skills/review-module-loading/SKILL.md` | Reviewing PRs that touch app boot, lazy module loading, catalog resolution, or gamepad polling. | `bun run check:readme-claims`, `bun run check:architecture` |
| `.agent/skills/audit-recurring-fixes/SKILL.md` | Mining commit history for recurring fix patterns and updating the review skills. | `git log` analysis against `docs/evidence/RECURRING_FIX_PATTERNS_AUDIT_*.md` |

### Review skills target recurring fixes

Each `review-*` skill covers a category that has produced a large share of this
repo's fix commits, and records its own measured share and the date it was
measured. Apply the matching skill whenever a PR touches that category.
[`audit-recurring-fixes`](../../.agent/skills/audit-recurring-fixes/SKILL.md)
re-mines the history and updates them when the distribution shifts.

## Delegation

When work may be split across agents, start with
[`agent-handoffs.md`](./agent-handoffs.md). Keep `docs/`, `AGENTS.md`, `.agent/`
and `scripts/mcp-shared.ts` with one owner when the change is about
discoverability; a task without a clean file boundary and a small validation set
is usually a bad candidate for delegation.

## Changing a skill

When a skill is added, removed, or renamed, or its discovery contract changes,
update in the same change:

- this table,
- the import, `markdownSources` entry and `agentCapabilities` record in
  `scripts/mcp-shared.ts`,
- [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) if the maintenance contract changed.

`bun run check:skill-index` fails when a skill is missing from this table or
from the MCP surface, and `bun run test tests/unit/mcp-server.test.ts` reads
every listed skill back through MCP. Wording-only edits need neither.
