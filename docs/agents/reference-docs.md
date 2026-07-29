# Reference Docs and Code Hotspots

## Primary docs

- `docs/DEVELOPMENT.md` — scripts and contributor workflow baseline.
- `docs/MILKDROP_PRESET_RUNTIME.md` — preset runtime, editor, compiler, and compatibility behavior.
- `docs/ARCHITECTURE.md` — runtime architecture and flow.
- `docs/STATUS_2026-05.md` — current project state: what changed, certified corpus, known gaps, next targets.
- `docs/evidence/RELEASE_EVIDENCE_LEDGER_2026-05.md` — single source of truth: certified/baseline-measured/semantic/unmeasured presets, fidelity gaps by subsystem.
- `docs/evidence/public-claim-audit.md` — overclaim findings and recommended fixes for public-facing naming and evidence claims.
- `docs/MANUAL_SMOKE_BASELINE.md` — milestone sign-off checklist for startup/shell/runtime changes.
- `docs/QA_PLAN.md` — broader QA map and focused regression coverage.
- `docs/PAGE_SPECIFICATIONS.md` — app shell and launch-flow behavior.
- `docs/DEPLOYMENT.md` — shipping and hosting guidance.
- `docs/TOY_SCRIPT_INDEX.md` / `docs/toys.md` — generated manifest reference docs synced from `src/data/toys.json`.

## Architecture and fidelity docs

- `docs/architecture/shader-support-inventory.md` — full compiler support audit: ~50 supported patterns, 10 unsupported/partial, 6 silent fallback locations, priority-ranked fixes.
- `docs/architecture/fallback-state-machine.md` — renderer setup FSM design: 28 transitions across 12 states, 6 implicit ordering risks, implementation plan.
- `docs/architecture/rasterization-fidelity-audit.md` — WebGL vs WebGPU divergence: 7 known divergence points, blend order audit, 10 object-count-only tests identified.

## High-signal code locations

- `src/js/frontend/` — route state, workspace UI, and the React app shell.
- `src/js/frontend/engine/` — strict engine seam between the React shell and MilkDrop runtime.
- `src/js/core/` — shared renderer, audio, settings, automation, and capability systems.
- `src/js/milkdrop/` — preset compiler, VM, runtime, editor, overlay, and catalog behavior.
- `src/css/` — `tokens.css` (design tokens), `chrome.css` (panel/dock control system), `app-shell.css` (workspace shell, wrapped in `@scope (.stims-shell)`), `index.css` and `base.css` (older page-level styles), plus `*.module.css` for component-scoped styles.
- `src/data/toys.json` — compatibility manifest source for shipped entry metadata.
- `public/milkdrop-presets/` — bundled preset corpus and catalog assets.

## Config and entry points

- `package.json` — scripts, package manager, tool versions.
- `vite.config.js` — bundling and dev-server behavior.
- `index.html` and `milkdrop/index.html` — canonical app shell and redirect alias.

## Fast triage

1. Workspace not loading → inspect `src/js/app.ts`, `src/js/frontend/App.tsx`, and `src/js/frontend/url-state.ts`.
2. No audio response → inspect shared audio startup and shell wiring under `src/js/core/`.
3. Preset compile or playback issue → inspect `src/js/milkdrop/` plus related fixtures in `public/milkdrop-presets/` and `tests/fixtures/milkdrop/`.
4. Agent workflow mismatch → update `.agent/*`, `docs/agents/custom-capabilities.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` together.
