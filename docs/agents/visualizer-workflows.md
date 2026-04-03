# Visualizer Workflows and Commands

## Reusable agent workflows

The repository includes markdown workflows under `.agent/workflows/`:

- `/modify-visualizer-runtime` — update shared runtime, loader, renderer, shell, audio, or capability behavior.
- `/modify-preset-workflow` — update bundled presets, catalog/editor flows, import/export, or compatibility behavior.
- `/play-visualizer` — run and manually verify the flagship visualizer.
- `/test-visualizer` — execute visualizer-focused tests.
- `/ship-visualizer-change` — orchestrate implementation, checks, and PR-ready docs alignment.

For the matching repo-local skills plus “when do I use which one?” guidance, see [`custom-capabilities.md`](./custom-capabilities.md).

## Common commands

```bash
# Local development server
bun run dev

# Scripted visualizer smoke run
bun run play:toy milkdrop

# Targeted and broader test passes
bun run test tests/path/to/spec.test.ts
bun run test:integration
bun run test:compat

# Type safety and full repo gate
bun run typecheck
bun run check
```

## Manual verification flow

1. Run `bun run dev`.
2. Open `http://localhost:5173/?agent=true`.
3. Use demo audio if microphone access is unavailable or repeatability matters.
4. Confirm shell load, preset playback, changed controls, and cleanup behavior work as expected.
