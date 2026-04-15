# QA plan and automation map

This guide captures the highest-impact flows to validate and how we keep them covered with automation. QA should protect the canonical root workspace on `/`, the `/milkdrop/` compatibility alias, the engine adapter seam, and the MilkDrop runtime contracts that sit beneath the React shell.

For Milestone A refactor sign-off, use [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md) as the authoritative manual baseline and artifact-capture checklist.

## High-value flows

- **Flagship launch and discovery**
  - What to verify: `/` renders the workspace shell, launch controls remain stable, preset browsing works, and canonical route state stays on `/` after boot.
  - Automation: `tests/app-shell.test.js`, `tests/frontend-url-state.test.ts`, and `tests/agent-integration.test.ts`.
  - Supporting checks: `bun run dev:check` confirms the Vite dev server wiring without opening a browser.
- **Shared quality preset persistence**
  - What to verify: the reusable settings state remembers the user-selected quality preset across workspace reloads and live-session reuse and notifies subscribers exactly when the user changes presets.
  - Automation: `tests/settings-panel.test.ts` covers subscription notifications plus panel reuse without losing the selected preset.
- **Microphone readiness and fallbacks**
  - What to verify: microphone setup resolves permissions, falls back to demo audio when blocked, and emits state changes that toys can react to.
  - Automation: `tests/microphone-flow.test.ts` validates the state machine around permission requests, error handling, and fallback triggers.

## Quick manual checklist (UI smoke pass)

When you touch the root workspace or session UI, run this short manual pass:

1. **Root boot**: Open `/` and confirm the workspace shell, launch controls, and preset browser render cleanly.
2. **Canonical state**: Start demo audio from `/` and confirm the route stays on `/`, not `/milkdrop/`.
3. **Preset deep link**: Open `/?preset=rovastar-parallel-universe&audio=demo` and confirm the requested preset becomes the live session.
4. **Alias compatibility**: Open `/milkdrop/?preset=eos-glowsticks-v2-03-music&audio=demo` and confirm it lands in the same root workspace state.
5. **Settings persistence**: Change a quality preset or compatibility toggle and verify it persists after reload.

If the change is part of architecture or runtime refactor work, also run the artifact-capture and sign-off flow in [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md).

## How to run the QA automation

Use Bun to match the repository tooling:

- For a single command that mirrors CI (lint + typecheck + tests):
  ```bash
  bun run check
  ```

- Run the happy-dom suites for the app shell, route contract, settings panel, and microphone flows:
  ```bash
  bun run test tests/app-shell.test.js tests/frontend-url-state.test.ts tests/settings-panel.test.ts tests/microphone-flow.test.ts
  ```

- Run the focused workspace/session regression suites:
  ```bash
  bun run test tests/frontend-url-state.test.ts tests/agent-integration.test.ts tests/audio-controls.test.ts
  ```

- Run the legacy compatibility shell suites only when you touch the old loader/bootstrap/view stack:
  ```bash
  bun run test:legacy-frontend
  ```

- For a quick server wiring check before pushing UI changes:
  ```bash
  bun run dev:check
  ```

## Agent-friendly QA shortcut

When you want a fast, reproducible QA pass without browsing the docs, run the full
quality gate and then the focused QA suite:

```bash
bun run check
bun run test tests/frontend-url-state.test.ts tests/agent-integration.test.ts
```
