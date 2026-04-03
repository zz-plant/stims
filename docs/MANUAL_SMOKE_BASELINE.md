# Manual Smoke Baseline

This document is the Milestone A sign-off baseline for startup, shell, loader, audio, and preset-playback changes. Use it to pair the existing automated regression suite with a small manual pass and reproducible capture artifacts before deeper architectural refactors.

## What counts as the baseline

Milestone A baseline evidence is the combination of:

- The repo quality gates:

  ```bash
  bun run check
  bun run check:toys
  ```

- The focused startup and shell regression suite:

  ```bash
  bun run test \
    tests/app-shell.test.js \
    tests/toy-page-bootstrap.test.ts \
    tests/capability-preflight.test.ts \
    tests/loader.test.js \
    tests/microphone-flow.test.ts \
    tests/settings-panel.test.ts \
    tests/toy-module-smoke.test.ts \
    tests/check-toys.test.ts
  ```

- The checked-in behavior snapshot sources:
  - `assets/data/milkdrop-parity/visual-baselines.json` for deterministic VM/frame-shape expectations.
  - `assets/data/milkdrop-parity/certification-corpus.json` for the representative preset set used during parity-oriented validation.
  - `assets/data/milkdrop-parity/visual-reference-manifest.json` plus `tests/fixtures/milkdrop/projectm-reference/` for image-level comparison fixtures.

## When to run this baseline

Run the full baseline when a change touches any of these areas:

- `index.html` or `milkdrop/index.html`
- `assets/js/app.ts`, `assets/js/loader.ts`, or `assets/js/router.ts`
- `assets/js/toy-view.ts` or launch/preflight UI
- `assets/js/core/*` startup, renderer, or audio wiring
- `assets/js/toys/milkdrop-toy.ts`
- preset boot, overlay, or renderer-fallback behavior

For narrowly scoped docs-only changes, this baseline is not required.

## Reproducible artifact capture

Use the headless launcher to save a screenshot plus runtime debug snapshot for a representative preset. Start the dev server first:

```bash
bun run dev
```

Then, in another shell, capture one shipped preset and one parity-sensitive preset:

```bash
bun run play:toy milkdrop \
  --preset rovastar-parallel-universe \
  --duration 1500 \
  --debug-snapshot \
  --output ./screenshots/milestone-a

bun run play:toy milkdrop \
  --preset eos-glowsticks-v2-03-music \
  --duration 1500 \
  --debug-snapshot \
  --output ./screenshots/milestone-a
```

Expected outputs:

- one PNG per capture,
- one `.debug.json` snapshot per capture,
- `parity-artifacts.manifest.json` entries in `./screenshots/milestone-a`.

Notes from headless runs:

- Playwright/SwiftShader captures may emit a `"Not supported"` console message while still completing the fallback path successfully.
- Treat the capture as passing when the session loads, `audioActive` is true, and both artifact files are written.

These captures are not repo-tracked artifacts. They are sign-off evidence for the active branch and should be compared against prior runs when startup, renderer, or preset behavior changes.

## Manual smoke checklist

Use demo audio unless the change specifically targets microphone behavior.

1. **Homepage to launch route**
   - Open `/`.
   - Confirm the homepage keeps one dominant launch path into `/milkdrop/`.
   - Confirm no dead-end CTA or broken route transition appears.
2. **Direct visualizer boot**
   - Open `/milkdrop/?agent=true&audio=demo`.
   - Confirm the shell loads, the session becomes interactive, and a visible canvas or live-session UI appears.
3. **Preflight and demo-audio success path**
   - If preflight appears, confirm there is one clear primary happy-path CTA.
   - Start demo audio and confirm visuals respond without requiring a reload.
4. **Preset deep link**
   - Open `/milkdrop/?agent=true&audio=demo&preset=rovastar-parallel-universe`.
   - Confirm the requested preset loads into the live session rather than falling back to a blank or default state.
5. **Overlay and settings persistence**
   - Open the overlay/settings UI.
   - Change a quality preset and confirm the session stays alive.
   - Reload or switch away and back if the change touched persistence, then confirm the selected preset persists as expected.
6. **Cleanup and navigation**
   - Use the back action or Escape-to-library behavior.
   - Confirm the active session disposes cleanly and the UI returns to a stable non-playing state.
7. **Conditional fallback check**
   - If the change touched renderer detection or failover, validate the WebGL fallback/compatibility path on an unsupported or forced-fallback run before sign-off.

## Sign-off record template

Record the latest run in the PR description or branch notes:

```md
Milestone A baseline
- Date: YYYY-MM-DD
- Branch/commit: <branch or sha>
- Commands:
  - bun run check
  - bun run check:toys
  - bun run test ...
  - bun run play:toy milkdrop --preset ...
- Artifact dir: ./screenshots/milestone-a
- Manual checklist: pass/fail with notes
- Regressions or follow-ups: none / <details>
```

## Related docs

- [`QA_PLAN.md`](./QA_PLAN.md) for the broader QA map.
- [`DEVELOPMENT.md`](./DEVELOPMENT.md) for parity-capture and day-to-day commands.
- [`FULL_REFACTOR_PLAN.md`](./FULL_REFACTOR_PLAN.md) for milestone intent and acceptance criteria.
