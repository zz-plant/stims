# Cline Agent Quick Start — Stims

Single-page entry for Cline working on the Stims visualizer. Read this first, then dive deep via progressive disclosure when needed.

## 5-second bootstrap

```bash
bun run setup:codex --status   # is the repo ready?
bun run setup:codex             # install + quick-check if not
```

## Daily commands

| Intent | Command | Time |
|--------|---------|------|
| Start dev server | `bun run dev` | — |
| Fast syntax/lint/type check | `bun run check:quick` | < 30s |
| Full quality gate | `bun run check` | 2–5 min |
| Run specific test | `bun run test tests/path/to/spec.test.ts` | varies |
| Integration tests | `bun run test:integration` | 1–2 min |
| Compatibility tests | `bun run test:compat` | 1–2 min |
| Warm long-lived session | `bun run session:codex -- --profile review` | — |
| Check everything at once | `bun run agent:status` | < 5s |
| Quick verify loop | `bun run agent:verify` | < 1 min |

## Where things live

| Area | Path | Use when changing… |
|------|------|-------------------|
| Workspace UI | `assets/js/frontend/` | React UI, URL state, engine adapter |
| Shared runtime | `assets/js/core/` | Renderer, shell, audio, capabilities |
| Preset system | `assets/js/milkdrop/` | Presets, editor, catalog, VM |
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
| runtime, loader, renderer, shell, controls, audio, routing | `.agent/skills/modify-visualizer-runtime/SKILL.md` |
| presets, catalog, editor, import/export, compatibility | `.agent/skills/modify-preset-workflow/SKILL.md` |
| browser QA or visual confirmation | `.agent/skills/play-visualizer/SKILL.md` |
| quick iterative verification | `.agent/skills/verify-visualizer-work/SKILL.md` |
| end-to-end product change → PR | `.agent/skills/ship-visualizer-change/SKILL.md` |
| UI iteration, shell chrome, CSS | `.agent/skills/iterate-visualizer-ui/SKILL.md` |

Use `.agent/workflows/*.md` when you need a step-by-step runbook with explicit phase order.

## Agent mode URL

Always use `http://localhost:5173/?agent=true` for browser-based QA. It persists state across reloads and enables cleaner debug output.

## Quality gate reminder

- `bun run check:quick` = Biome + types + `@ts-nocheck` guard + catalog sync
- `bun run check` = everything above + all tests + architecture + SEO + toy manifest
- Run `check:quick` often; run `check` before any commit/PR

## Progressive disclosure

| Depth | Doc | When |
|-------|-----|------|
| This page | `.claude/CLAUDE.md` | Every session start |
| Agent essentials | `AGENTS.md` | Non-negotiable defaults |
| Bootstrap + handoffs | `docs/agents/agent-handoffs.md` | Delegating work |
| Capability index | `docs/agents/custom-capabilities.md` | Choosing skills/workflows |
| Tooling reference | `docs/agents/tooling-and-quality.md` | Command details |
| Visual testing | `docs/agents/visual-testing.md` | Browser QA procedures |
| Deep reference | `docs/agents/reference-docs.md` | Unfamiliar code areas |
