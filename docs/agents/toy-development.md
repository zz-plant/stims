# Visualizer Entry Maintenance (Agent Quick Reference)

## Core locations

- Shipped entry module: `assets/js/toys/milkdrop-toy.ts`.
- Toy registry metadata source: `assets/data/toys.json`.
- Generated manifest artifacts: `assets/js/data/toy-manifest.ts`, `public/toys.json`, `docs/TOY_SCRIPT_INDEX.md`, `docs/toys.md`.
- Canonical app shell: `index.html` + `assets/js/app.ts`.
- React workspace and engine seam: `assets/js/frontend/*`.
- Compatibility alias: `milkdrop/index.html`.
- Runtime/audio helpers: `assets/js/core/toy-runtime.ts`, `assets/js/core/toy-audio.ts`.

## Expected patterns

- Visualizer modules export `start(...)` and return a disposable cleanup handle.
- Canvas-heavy work should prefer shared runtime scaffolding (`createToyRuntime(...)`) over bespoke setup.
- MilkDrop-facing changes should stay inside the shared runtime and adapter seam instead of introducing parallel toy-specific boot paths.
- Metadata changes should start in `assets/data/toys.json`, then flow through `bun run generate:toys`.
- Audio-reactive flows should integrate with shared audio helpers and support demo-audio fallback when applicable.

## Change checklist for shipped-entry edits

1. Update the runtime/module code under `assets/js/toys/`, `assets/js/core/`, or `assets/js/milkdrop/`.
2. Update `assets/data/toys.json` when manifest metadata changes.
3. Run `bun run generate:toys` to refresh generated manifest and doc artifacts.
4. Update tests for the behavior or metadata change.
5. Run `bun run check:toys` and `bun run check`.
