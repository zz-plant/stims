# QA plan and automation map

This guide captures the highest-impact flows to validate and how we keep them covered with automation. Run the linked tests when touching the associated areas so regressions surface quickly.

## High-value flows

- **Library discovery and launch**
  - What to verify: the landing page renders toy cards, search filters the list, and launching a toy routes module-based entries without breaking external HTML links.
  - Automation: `tests/app-shell.test.js` exercises card rendering, search filtering, and routing logic under happy-dom.
  - Supporting checks: `bun run dev:check` confirms the Vite dev server wiring without opening a browser.
- **Shared quality preset persistence**
  - What to verify: the reusable settings panel remembers the user-selected quality preset across toy switches and notifies subscribers exactly when the user changes presets.
  - Automation: `tests/settings-panel.test.ts` covers subscription notifications plus the cross-toy persistence flow (selecting **Hi-fi visuals** in one toy, then reusing the panel in another without losing the choice).
- **Microphone readiness and fallbacks**
  - What to verify: microphone setup resolves permissions, falls back to demo audio when blocked, and emits state changes that toys can react to.
  - Automation: `tests/microphone-flow.test.ts` validates the state machine around permission requests, error handling, and fallback triggers.

## Quick manual checklist (UI smoke pass)

When you touch the landing page or toy shell UI, run this short manual pass:

1. **Landing page**: Starter packs render, and their links open the expected toys.
2. **Library search**: Search input filters cards and clearing filters restores all results.
3. **Toy launch**: Open a toy from the library, start demo audio, and confirm visuals respond.
4. **Performance panel**: Open system check, toggle a quality preset, and verify the selection persists when switching toys.

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

- For a quick server wiring check before pushing UI changes:
  ```bash
  bun run dev:check
  ```

## Agent-friendly QA shortcut

When you want a fast, reproducible QA pass without browsing the docs, run the full
quality gate and then the focused QA suite:

```bash
bun run check
bun run test tests/app-shell.test.js tests/settings-panel.test.ts tests/microphone-flow.test.ts
```
