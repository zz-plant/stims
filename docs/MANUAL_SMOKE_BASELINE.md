# Manual Smoke Baseline

This document is the current sign-off baseline for root-route startup, workspace shell behavior, compatibility redirects, audio startup, and preset playback.

## What counts as the baseline

Milestone A baseline evidence is the combination of:

- The repo quality gates:

  ```bash
  bun run check
  bun run check:toys
  ```

- The focused startup and route-contract regression suite:
  - primary root-workspace coverage:

  ```bash
  bun run test \
    tests/app-shell.test.js \
    tests/frontend-url-state.test.ts \
    tests/agent-integration.test.ts \
    tests/microphone-flow.test.ts \
    tests/settings-panel.test.ts
  ```

  - compatibility-only shell coverage when legacy modules change:

  ```bash
  bun run test:legacy-frontend
  ```

- The checked-in behavior snapshot sources:
  - `assets/data/milkdrop-parity/visual-baselines.json` for deterministic VM/frame-shape expectations.
  - `assets/data/milkdrop-parity/certification-corpus.json` for the representative preset set used during parity-oriented validation.
  - `assets/data/milkdrop-parity/visual-reference-manifest.json` plus `tests/fixtures/milkdrop/projectm-reference/` for image-level comparison fixtures.

## When to run this baseline

Run the full baseline when a change touches any of these areas:

- `index.html` or `milkdrop/index.html`
- `assets/js/app.ts` or `assets/js/frontend/*`
- `assets/js/frontend/engine/*` or launch/session UI
- `assets/js/core/*` startup, renderer, or audio wiring
- `assets/js/milkdrop/runtime.ts`
- preset boot, overlay, or renderer-fallback behavior

Run the compatibility-only legacy suite instead when a change is limited to:

- `assets/js/loader.ts`, `assets/js/router.ts`, or `assets/js/loader/*`
- `assets/js/toy-view.ts`
- `assets/js/library-view.js` or `assets/js/library-view/*`
- `assets/js/bootstrap/*`

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

1. **Canonical root route**
   - Open `/`.
   - Confirm the workspace shell renders directly on the root route.
   - Confirm no transition to a separate old shell appears.
2. **Compatibility alias**
   - Open `/milkdrop/?agent=true&audio=demo`.
   - Confirm it resolves into the same root workspace state without losing query intent.
3. **Demo-audio success path**
   - Start demo audio from `/`.
   - Confirm visuals respond without requiring a reload and the route remains `/`.
4. **Preset deep link**
   - Open `/?agent=true&audio=demo&preset=rovastar-parallel-universe`.
   - Confirm the requested preset loads into the live session rather than falling back to a blank or default state.
5. **Settings persistence**
   - Open the workspace settings UI.
   - Change a quality preset and confirm the session stays alive.
   - Reload and confirm the selected preset persists as expected.
6. **Cleanup and navigation**
   - Stop interacting, reload, or clear active audio state.
   - Confirm the workspace returns to a stable non-playing launch state.
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
