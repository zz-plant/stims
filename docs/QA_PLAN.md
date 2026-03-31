# QA plan and automation map

This guide captures the highest-impact flows to validate and how we keep them covered with automation. Stims is positioned as an independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop, so QA should protect the flagship `milkdrop` flow, the launch shell, and the shared runtime contracts that support it. Run the linked tests when touching the associated areas so regressions surface quickly.

For Milestone A refactor sign-off, use [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md) as the authoritative manual baseline and artifact-capture checklist.

## High-value flows

- **Flagship launch and discovery**
  - What to verify: the landing page keeps one clear primary launch CTA, the toy preflight shows one primary action for the happy path, the launchpad shell renders, search filters the list, and launching the visualizer keeps the canonical `/milkdrop/` route stable.
  - Automation: `tests/app-shell.test.js` plus `tests/capability-preflight.test.ts` exercise card rendering, discovery state, routing logic, and the linear preflight CTA under happy-dom.
  - Supporting checks: `bun run dev:check` confirms the Vite dev server wiring without opening a browser.
- **Shared quality preset persistence**
  - What to verify: the reusable settings panel remembers the user-selected quality preset across launch-shell and live-session reuse and notifies subscribers exactly when the user changes presets.
  - Automation: `tests/settings-panel.test.ts` covers subscription notifications plus panel reuse without losing the selected preset.
- **Microphone readiness and fallbacks**
  - What to verify: microphone setup resolves permissions, falls back to demo audio when blocked, and emits state changes that toys can react to.
  - Automation: `tests/microphone-flow.test.ts` validates the state machine around permission requests, error handling, and fallback triggers.

## Quick manual checklist (UI smoke pass)

When you touch the landing page or toy shell UI, run this short manual pass:

1. **Landing page**: The hero shows one primary launch CTA, and the secondary browse action stays visible without competing labels.
2. **Library discovery**: Search + filters add chips to the sticky applied-view rail, and `Reset view` clears the state in one tap.
3. **Toy launch**: Open a toy from the library, confirm preflight shows one primary CTA, start demo audio, and verify visuals respond.
4. **Touch affordances**: On a narrow/touch viewport, confirm the top-row back action is visible before launch and gesture hints appear after audio starts.
5. **Performance panel**: Open quick check, toggle a quality preset, and verify the selection persists after entering and leaving the live session.

If the change is part of architecture or runtime refactor work, also run the artifact-capture and sign-off flow in [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md).

## How to run the QA automation

Use Bun to match the repository tooling:

- For a single command that mirrors CI (lint + typecheck + tests):
  ```bash
  bun run check
  ```

- Run the happy-dom suites for the app shell, settings panel, and microphone flows:
  ```bash
  bun run test tests/app-shell.test.js tests/settings-panel.test.ts tests/microphone-flow.test.ts
  ```

- Run the focused launch/discovery/touch regression suites:
  ```bash
  bun run test tests/audio-controls.test.ts tests/library-filter-state.test.ts tests/capability-preflight.test.ts
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
bun run test tests/audio-controls.test.ts tests/library-filter-state.test.ts tests/capability-preflight.test.ts
```
