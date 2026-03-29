# Development Guide

This is the day-to-day implementation guide for Stims.

Stims is now a single browser-native MilkDrop-inspired visualizer. Prefer changes that strengthen the shared runtime, preset workflows, and app shell over adding parallel product surfaces.

## Core workflow

1. Install dependencies with `bun install`.
2. Start local development with `bun run dev`.
3. Open `http://localhost:5173/milkdrop/`.
4. Run `bun run check:quick` while iterating.
5. Run `bun run check` before finalizing changes.

## Main scripts

| Task | Command |
| --- | --- |
| Start dev server | `bun run dev` |
| Start dev server on all interfaces | `bun run dev:host` |
| WebGPU-focused local session | `bun run dev:webgpu` |
| Full quality gate | `bun run check` |
| Faster local quality gate | `bun run check:quick` |
| Run tests | `bun run test` |
| Build production assets | `bun run build` |
| Preview production build | `bun run preview` |

## Compatibility capture workflow

Use the headless launcher when you need a repeatable preset capture for parity work:

```bash
bun scripts/play-toy.ts milkdrop \
  --preset eos-glowsticks-v2-03-music \
  --duration 1500 \
  --debug-snapshot \
  --no-vibe-mode \
  --output ./screenshots/parity
```

This keeps the capture focused on one preset and saves both the screenshot and the runtime debug snapshot for later comparison.

You can import an external `projectM` reference render into the same artifact directory:

```bash
bun scripts/import-projectm-reference.ts \
  --preset eos-glowsticks-v2-03-music \
  --image /absolute/path/to/projectm-frame.png \
  --meta /absolute/path/to/projectm-frame.json \
  --output ./screenshots/parity
```

Both workflows append entries to `parity-artifacts.manifest.json` inside the output directory so later diff tooling can resolve matching Stims and projectM artifacts by preset id.

To diff the latest pair for a preset:

```bash
bun run parity:diff -- --output ./screenshots/parity --preset eos-glowsticks-v2-03-music
```

The diff command writes:

- a JSON report with mismatch metrics,
- an optional diff PNG,
- a `parity-diff` manifest entry tied back to the source artifact ids.

To promote an imported `projectM` reference into the checked-in fixture corpus:

```bash
bun run parity:promote-reference -- \
  --output ./screenshots/parity \
  --preset eos-glowsticks-v2-03-music \
  --strata feedback,shader-supported
```

This copies the chosen reference artifact into `tests/fixtures/milkdrop/projectm-reference/` and upserts its entry in `assets/data/milkdrop-parity/visual-reference-manifest.json`.

## Product assumptions

- The primary app entrypoint is `milkdrop/index.html` (`/milkdrop/`).
- `index.html` boots the MilkDrop visualizer in place on load, using the same shared loader/runtime as the dedicated launch route.
- Presets are part of one visualizer product, not separate first-class toys.

## Docs to keep aligned

- [`README.md`](../README.md)
- [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md)
- [`MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)
- [`DEPLOYMENT.md`](./DEPLOYMENT.md)

Older toy-catalog docs may still exist for historical context, but they are no longer the main operating model.
