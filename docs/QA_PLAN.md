# QA plan and automation map

This guide captures the highest-impact flows to validate and how we keep them covered with automation. Stims is positioned as an independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop, with a broader toy lab, so QA should protect both the flagship `milkdrop` flow and cross-toy reliability. Run the linked tests when touching the associated areas so regressions surface quickly.

## High-value flows

- **Flagship launch and broader discovery**
  - What to verify: the landing page keeps one clear primary launch CTA, the toy preflight shows one primary action for the happy path, toy cards still render, search filters the list, and launching a toy routes module-based entries without breaking external HTML links.
  - Automation: `tests/app-shell.test.js` plus `tests/capability-preflight.test.ts` exercise card rendering, discovery state, routing logic, and the linear preflight CTA under happy-dom.
  - Supporting checks: `bun run dev:check` confirms the Vite dev server wiring without opening a browser.
- **Shared quality preset persistence**
  - What to verify: the reusable settings panel remembers the user-selected quality preset across toy switches and notifies subscribers exactly when the user changes presets.
  - Automation: `tests/settings-panel.test.ts` covers subscription notifications plus the cross-toy persistence flow (selecting **Hi-fi visuals** in one toy, then reusing the panel in another without losing the choice).
- **Microphone readiness and fallbacks**
  - What to verify: microphone setup resolves permissions, falls back to demo audio when blocked, and emits state changes that toys can react to.
  - Automation: `tests/microphone-flow.test.ts` validates the state machine around permission requests, error handling, and fallback triggers.

## Quick manual checklist (UI smoke pass)

When you touch the landing page or toy shell UI, run this short manual pass:

1. **Landing page**: The hero shows one primary launch CTA, and the secondary browse action stays visible without competing labels.
2. **Library discovery**: Search + filters add chips to the sticky applied-view rail, and `Reset view` clears the state in one tap.
3. **Toy launch**: Open a toy from the library, confirm preflight shows one primary CTA, start demo audio, and verify visuals respond.
4. **Touch affordances**: On a narrow/touch viewport, confirm the top-row back action is visible before launch and gesture hints appear after audio starts.
5. **Performance panel**: Open quick check, toggle a quality preset, and verify the selection persists when switching toys.

## How to run the QA automation

Use Bun to match the repository tooling:

- For a single command that mirrors CI (lint + typecheck + tests):
  ```bash
  bun run check
  ```

- Run the happy-dom suites for the app shell, settings panel, and microphone flows:
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

## Visual snapshot storage guidance

- Playwright run artifacts belong in `output/playwright/` and are intentionally transient.
- Only canonical baselines should be committed, under `tests/fixtures/playwright-baselines/`.
- Keep one authoritative baseline image per scenario to avoid drift and duplicate snapshots.
