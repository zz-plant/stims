# Development Guide

This is the day-to-day implementation guide for Stims.

Stims is now a single browser-native MilkDrop-inspired visualizer. Prefer changes that strengthen the shared runtime, preset workflows, and app shell over adding parallel product surfaces.

For a concise parallel execution map across parity, runtime performance, browser-native product work, and proof/release work, see [`MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./MILKDROP_SUCCESSOR_WORKSTREAMS.md).

## Core workflow

1. Install dependencies with `bun install`.
2. Start local development with `bun run dev`.
3. Open `http://localhost:5173/`.
4. Run `bun run check:quick` while iterating.
5. Run `bun run check` before finalizing changes.

`bun run check` includes the toy/docs drift guard, SEO surface validation, and the architecture boundary guard, so it now verifies the documented `app` / `frontend` / `core` / `ui` / `utils` / `milkdrop` dependency directions while treating the old `loader` / `bootstrap` / `toy-view` / `library-view` stack as explicit legacy compatibility code.

## Main scripts

| Task | Command |
| --- | --- |
| Start dev server | `bun run dev` |
| Start dev server on all interfaces | `bun run dev:host` |
| WebGPU-focused local session | `bun run dev:webgpu` |
| Full quality gate | `bun run check` |
| Faster local quality gate | `bun run check:quick` |
| Toy manifest + generated doc drift check | `bun run check:toys` |
| SEO surface check | `bun run check:seo` |
| Architecture boundary check | `bun run check:architecture` |
| Run tests | `bun run test` |
| Run legacy shell compatibility tests | `bun run test:legacy-frontend` |
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
The checked-in certification target set itself lives in `assets/data/milkdrop-parity/certification-corpus.json`; visual references and measured results should only be added for presets in that bounded corpus.

To run the certified parity suite against the checked-in visual reference manifest:

```bash
bun run parity:suite -- --output ./screenshots/parity --write-diff-images
```

This reads `assets/data/milkdrop-parity/visual-reference-manifest.json`, resolves the latest Stims captures for each certified preset, writes per-preset reports under `./screenshots/parity/suite/`, and emits a ranked `summary.json` with worst mismatches first.

To promote a suite report into the checked-in measured-results manifest:

```bash
bun run parity:promote-result -- \
  --output ./screenshots/parity \
  --preset eos-glowsticks-v2-03-music
```

This upserts the preset into `assets/data/milkdrop-parity/measured-results.json`, which is the first repo-tracked source used to override inferred fidelity with measured visual evidence.

To sync the shipped bundled catalog metadata with that measured-results manifest:

```bash
bun run parity:sync-catalog
```

This rewrites `public/milkdrop-presets/catalog.json` so presets with measured visual results keep their certified fidelity labels, while unmeasured bundled presets are published as `partial` with `runtime` evidence instead of optimistic `exact`/`visual` metadata.

`bun run check:quick` and `bun run check` now verify that `public/milkdrop-presets/catalog.json` is still synced with `assets/data/milkdrop-parity/measured-results.json`. If that check fails, rerun `bun run parity:sync-catalog`.

## Product assumptions

- The primary app entrypoint is `index.html` (`/`).
- `milkdrop/index.html` (`/milkdrop/`) is a compatibility alias that redirects into the root app route.
- Presets are part of one visualizer product, not separate first-class toys.

## Frontend boundaries

- `assets/js/app.ts` and `assets/js/frontend/*` are the active product frontend.
- `assets/js/milkdrop/*` remains the visual engine behind the adapter seam.
- `assets/js/loader.ts`, `assets/js/router.ts`, `assets/js/toy-view.ts`, `assets/js/library-view.js`, `assets/js/library-view/*`, and `assets/js/bootstrap/*` are legacy compatibility modules.
- New product work should not add fresh route ownership or UI flows to those legacy modules.

## Docs to keep aligned

- [`README.md`](../README.md)
- [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md)
- [`MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)
- [`DEPLOYMENT.md`](./DEPLOYMENT.md)

Older toy-catalog docs may still exist for historical context, but they are no longer the main operating model.
