# Visualizer Workflows and Commands

## Reusable agent workflows

The repository includes markdown workflows under `.agent/workflows/`:

- [`/modify-visualizer-runtime`](../../.agent/workflows/modify-visualizer-runtime.md) — update shared runtime, loader, renderer, shell, audio, or capability behavior.
- [`/modify-preset-workflow`](../../.agent/workflows/modify-preset-workflow.md) — update bundled presets, catalog/editor flows, import/export, or compatibility behavior.
- [`/play-visualizer`](../../.agent/workflows/play-visualizer.md) — run and manually verify the flagship visualizer.
- [`/test-visualizer`](../../.agent/workflows/test-visualizer.md) — execute visualizer-focused tests.
- [`/ship-visualizer-change`](../../.agent/workflows/ship-visualizer-change.md) — orchestrate implementation, checks, and PR-ready docs alignment.

### Review skills (prevent recurring fix categories)

The repo also ships targeted review skills under `.agent/skills/` that gate the highest-churn, highest-fix surfaces:

- [`/review-webgpu-parity`](../../.agent/skills/review-webgpu-parity/SKILL.md) — gate PRs touching WebGPU/WebGL parity (feedback, shaders, renderer adapters).
- [`/review-renderer-fallback`](../../.agent/skills/review-renderer-fallback/SKILL.md) — gate PRs touching renderer capability probing, fallback chains, timeout logic, or audio worklet init.
- [`/review-test-harness`](../../.agent/skills/review-test-harness/SKILL.md) — gate PRs adding or modifying tests, fixtures, or integration harness code.
- [`/review-workspace-ui-state`](../../.agent/skills/review-workspace-ui-state/SKILL.md) — gate PRs touching React workspace UI state, URL routing, toast/panel behavior, or the engine adapter boundary.
- [`/audit-recurring-fixes`](../../.agent/skills/audit-recurring-fixes/SKILL.md) — audit commit history to find recurring fix patterns and update prevention skills.
- [`/iterate-visualizer-ui`](../../.agent/skills/iterate-visualizer-ui/SKILL.md) — iterate on workspace UI, shell chrome, and CSS with fast feedback loops, component isolation, and screenshot diff.
- [`/quick-start`](../../.agent/skills/quick-start/SKILL.md) — fastest safe path into the repo when dropped in cold.
- [`/agent-ergonomics`](../../.agent/skills/agent-ergonomics/SKILL.md) — understanding and improving the agent infrastructure itself.

For the matching repo-local skills plus "when do I use which one?" guidance, see [`custom-capabilities.md`](./custom-capabilities.md).

For task slicing, file ownership boundaries, and subagent return expectations, see [`agent-handoffs.md`](./agent-handoffs.md).

## Common commands

```bash
# Local development server
bun run dev

# Warm long-lived agent session
bun run session:codex -- --profile review

# Scripted visualizer smoke run
bun run play:toy milkdrop

# Targeted and broader test passes
bun run test tests/path/to/spec.test.ts
bun run test:integration
bun run test:compat
bun run test:legacy-frontend

# Type safety and full repo gate
bun run typecheck
bun run check
```

## Manual verification flow

1. Run `bun run dev` or `bun run session:codex -- --profile review`.
2. Open `http://localhost:5173/?agent=true`.
3. Use demo audio if microphone access is unavailable or repeatability matters.
4. Confirm shell load, preset playback, changed controls, and cleanup behavior work as expected.

## Command selection

Use the narrowest test command that matches the layer you changed. The short
matrix in [`../VERIFICATION_MATRIX.md`](../VERIFICATION_MATRIX.md) is the
source of truth for:

- unit and logic specs
- DOM-sim and environment coverage
- browser integration coverage
- compatibility and parity coverage
- manual browser proof
