# Visualizer Workflows and Commands

## Reusable agent workflows

The repository includes markdown workflows under `.agent/workflows/`:

- [`/modify-visualizer-runtime`](../../.agent/workflows/modify-visualizer-runtime.md) — update shared runtime, loader, renderer, shell, audio, or capability behavior.
- [`/modify-preset-workflow`](../../.agent/workflows/modify-preset-workflow.md) — update bundled presets, catalog/editor flows, import/export, or compatibility behavior.
- [`/play-visualizer`](../../.agent/workflows/play-visualizer.md) — run and manually verify the flagship visualizer.
- [`/test-visualizer`](../../.agent/workflows/test-visualizer.md) — execute visualizer-focused tests.
- [`/ship-visualizer-change`](../../.agent/workflows/ship-visualizer-change.md) — orchestrate implementation, checks, and PR-ready docs alignment.

For the matching repo-local skills plus “when do I use which one?” guidance, see [`custom-capabilities.md`](./custom-capabilities.md).

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
