# QA plan and automation map

QA should protect the canonical root workspace on `/`, the `/milkdrop/` compatibility alias, the engine adapter seam, and the MilkDrop runtime contracts that sit beneath the React shell.

For the full testing reference — speed tiers, quality gate commands, per-change checklists, and CI behavior — see [`TESTING.md`](./TESTING.md).

For artifact capture and lifecycle sign-off, use [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md) as the manual baseline and artifact-capture checklist.

## High-value flows

- **Flagship launch and discovery**
  - What to verify: `/` renders the workspace shell, launch controls remain stable, preset browsing works, and canonical route state stays on `/` after boot.
  - Automation: `tests/unit/app-shell.test.ts`, `tests/unit/frontend-url-state.test.ts`, and `tests/e2e/agent-integration.test.ts`.
  - Supporting checks: `bun run dev:check` confirms the Vite dev server wiring without opening a browser.
- **Shared quality preset persistence**
  - What to verify: the reusable settings state remembers the user-selected quality preset across workspace reloads and live-session reuse and notifies subscribers exactly when the user changes presets.
  - Automation: `tests/unit/settings-panel.test.ts` covers subscription notifications plus panel reuse without losing the selected preset.
- **Microphone readiness and fallbacks**
  - What to verify: microphone setup reports permission outcomes, offers a demo fallback when blocked, and communicates the actual playing source. Exercise granted, denied, and unavailable cases.

## Quick manual checklist (UI smoke pass)

When you touch the root workspace or session UI, run this short manual pass:

1. **Root boot**: Open `/` and confirm the workspace shell, launch controls, and preset browser render cleanly.
2. **Canonical state**: Start demo audio from `/` and confirm the route stays on `/`, not `/milkdrop/`.
3. **Preset deep link**: Open `/?preset=rovastar-parallel-universe&audio=demo` and confirm the requested preset becomes the live session.
4. **Alias compatibility**: Open `/milkdrop/?preset=eos-glowsticks-v2-03-music&audio=demo` and confirm it lands in the same root workspace state.
5. **Play → Edit → Share**: Open Edit this visual, apply a visible source change, share it, and reload the resulting link in a fresh tab. Confirm source and visible effect, then check undo or version restoration.
6. **Keyboard and mobile**: Exercise focus, panel dismissal, and the same flow at a narrow viewport; check stage and controls for overflow.
7. **Settings persistence**: Change a quality preset or compatibility toggle and verify it persists after reload.

If the change is part of architecture or runtime refactor work, also run the artifact-capture and sign-off flow in [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md).

## How to run the QA automation

Use Bun to match the repository tooling:

- For the standard pre-commit check (guards + typecheck + package checks + unit/compat/corpus tests):
  ```bash
  bun run check
  ```

- For lint, types, and guards without tests:
  ```bash
  bun run check:quick
  ```

- Run the happy-dom suites for the app shell, route contract, settings panel, and microphone flows:
  ```bash
  bun run test tests/unit/app-shell.test.ts tests/unit/frontend-url-state.test.ts tests/unit/settings-panel.test.ts
  ```

- Run the focused workspace/session regression suites:
  ```bash
  bun run test tests/unit/frontend-url-state.test.ts tests/e2e/agent-integration.test.ts tests/unit/app-shell-route-sync.test.ts
  ```

- Run the integration harness (real Chromium — runs in CI for code changes):
  ```bash
  bun run test:integration
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
bun run test tests/unit/frontend-url-state.test.ts tests/e2e/agent-integration.test.ts
```
