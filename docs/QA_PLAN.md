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

## How to run the QA automation

Use Bun to match the repository tooling:

- Run the happy-dom suites for the app shell, settings panel, and microphone flows:
  ```bash
  bun run test tests/app-shell.test.js tests/settings-panel.test.ts tests/microphone-flow.test.ts
  ```

- For a quick server wiring check before pushing UI changes:

  ```bash
  bun run dev:check
  ```

- Full project sweep (lint, types, build, tests) as enforced in CI:

  ```bash
  bun run check
  ```
