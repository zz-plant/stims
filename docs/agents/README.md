# Agent Guidance Index

Pages here add detail behind the root [`AGENTS.md`](../../AGENTS.md), in
progressive-disclosure order: open the next one only when the task needs it.

## Read order

1. Root [`AGENTS.md`](../../AGENTS.md) for the bootstrap, daily commands and non-negotiable defaults. Claude Code loads it through [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md), which adds only Claude Code notes.
2. [`agent-handoffs.md`](./agent-handoffs.md) for the bootstrap sequence, working beside other sessions, and delegation.
3. [`tooling-and-quality.md`](./tooling-and-quality.md) before code edits.
4. [`custom-capabilities.md`](./custom-capabilities.md) when the task may match a repo-local skill.
5. [`browser-automation.md`](./browser-automation.md) and [`visual-testing.md`](./visual-testing.md) before browser QA.
6. [`src-map.md`](./src-map.md) when triaging an unfamiliar area.

For product priorities read [`../ROADMAP.md`](../ROADMAP.md); for which visitor moment a change serves, [`../PRODUCT_MOMENTS.md`](../PRODUCT_MOMENTS.md). Current certification inventories live in the manifests under `src/data/milkdrop-parity/`; the [May evidence ledger](../evidence/RELEASE_EVIDENCE_LEDGER_2026-05.md) is a historical snapshot.

## Pages

| Page | Covers |
| --- | --- |
| [`agent-handoffs.md`](./agent-handoffs.md) | Bootstrap, worktrees and shared-checkout rules, task slicing, the handoff packet and return contract |
| [`tooling-and-quality.md`](./tooling-and-quality.md) | Dev loops, quality gates and their timings, task-specific checks, the optional LM Studio session scripts |
| [`custom-capabilities.md`](./custom-capabilities.md) | The skill index and how to change a skill |
| [`browser-automation.md`](./browser-automation.md) | `__stims_agent`, `bun run ctl`, and every URL flag (`?agent=true`, `?mockAudio=demo`, …) |
| [`visual-testing.md`](./visual-testing.md) | Browser QA by change type, measured preset labs, GPU-less environments |
| [`src-map.md`](./src-map.md) | Where code lives, which tests cover it, which guards scan it |

Documentation changes follow [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md); [`../README.md`](../README.md) is the canonical docs index.
