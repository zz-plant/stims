# Reference Docs and Code Hotspots

## Primary docs

- `docs/DEVELOPMENT.md` — scripts and contributor workflow baseline.
- `docs/MILKDROP_PRESET_RUNTIME.md` — preset runtime, editor, compiler, and compatibility behavior.
- `docs/ARCHITECTURE.md` — runtime architecture and flow.
- `docs/MANUAL_SMOKE_BASELINE.md` — milestone sign-off checklist for startup/shell/runtime changes.
- `docs/QA_PLAN.md` — broader QA map and focused regression coverage.
- `docs/PAGE_SPECIFICATIONS.md` — app shell and launch-flow behavior.
- `docs/DEPLOYMENT.md` — shipping and hosting guidance.
- `docs/TOY_SCRIPT_INDEX.md` / `docs/toys.md` — generated manifest reference docs synced from `assets/data/toys.json`.

## High-signal code locations

- `assets/js/frontend/` — route state, workspace UI, and the React app shell.
- `assets/js/frontend/engine/` — strict engine seam between the React shell and MilkDrop runtime.
- `assets/js/core/` — shared renderer, audio, settings, automation, and capability systems.
- `assets/js/milkdrop/` — preset compiler, VM, runtime, editor, overlay, and catalog behavior.
- `assets/js/loader.ts`, `assets/js/router.ts`, `assets/js/toy-view.ts`, `assets/js/library-view.js`, and `assets/js/bootstrap/` — legacy compatibility internals still covered by `bun run test:legacy-frontend`.
- `assets/data/toys.json` — compatibility manifest source for shipped entry metadata.
- `public/milkdrop-presets/` — bundled preset corpus and catalog assets.

## Config and entry points

- `package.json` — scripts, package manager, tool versions.
- `vite.config.js` — bundling and dev-server behavior.
- `index.html` and `milkdrop/index.html` — canonical app shell and redirect alias.

## Fast triage

1. Workspace not loading → inspect `assets/js/app.ts`, `assets/js/frontend/App.tsx`, and `assets/js/frontend/url-state.ts`.
2. No audio response → inspect shared audio startup and shell wiring under `assets/js/core/`.
3. Preset compile or playback issue → inspect `assets/js/milkdrop/` plus related fixtures in `public/milkdrop-presets/` and `tests/fixtures/milkdrop/`.
4. Agent workflow mismatch → update `.agent/*`, `docs/agents/custom-capabilities.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` together.
