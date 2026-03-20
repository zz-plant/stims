# Reference Docs and Code Hotspots

## Primary docs

- `docs/DEVELOPMENT.md` — scripts and contributor workflow baseline.
- `docs/MILKDROP_PRESET_RUNTIME.md` — preset runtime, editor, compiler, and compatibility behavior.
- `docs/ARCHITECTURE.md` — runtime architecture and flow.
- `docs/PAGE_SPECIFICATIONS.md` — app shell and launch-flow behavior.
- `docs/DEPLOYMENT.md` — shipping and hosting guidance.

## High-signal code locations

- `assets/js/core/` — shared runtime, renderer, shell, audio, and capability systems.
- `assets/js/milkdrop/` — preset compiler, VM, runtime, editor, overlay, and catalog behavior.
- `assets/js/loader.ts` — loader/query param routing into `toy.html`.
- `assets/data/toys.json` (or `assets/data/toys.yaml` / `assets/data/toys.yml`) — loader manifest source still used for routing and compatibility.
- `public/milkdrop-presets/` — bundled preset corpus and catalog assets.

## Config and entry points

- `package.json` — scripts, package manager, tool versions.
- `vite.config.js` — bundling and dev-server behavior.
- `index.html` and `toy.html` — launch page and primary visualizer entry points.

## Fast triage

1. Visualizer not loading → inspect loader and app entry behavior in `assets/js/loader.ts`, `assets/js/toy-view.ts`, and `toy.html`.
2. No audio response → inspect shared audio startup and shell wiring under `assets/js/core/`.
3. Preset compile or playback issue → inspect `assets/js/milkdrop/` plus related fixtures in `public/milkdrop-presets/` and `tests/fixtures/milkdrop/`.
4. Agent workflow mismatch → update `.agent/*`, `docs/agents/custom-capabilities.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` together.
