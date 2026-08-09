---
name: review-module-loading
description: "Review changes to app boot, lazy module loading, toy manifest, catalog resolution, or gamepad polling. Use when a PR touches src/js/app.ts, src/js/frontend/load-status.ts, src/js/frontend/use-lazy-factory.ts, src/js/milkdrop/catalog-store*.ts, src/data/toys.json, index.html, or gamepad polling code."
---

# Review App Boot and Module Loading

Use this skill when reviewing or authoring changes to [`src/js/app.ts`](../../../src/js/app.ts), [`src/js/frontend/load-status.ts`](../../../src/js/frontend/load-status.ts), [`src/js/frontend/use-lazy-factory.ts`](../../../src/js/frontend/use-lazy-factory.ts), `src/js/milkdrop/catalog-store*.ts`, [`src/data/toys.json`](../../../src/data/toys.json), [`index.html`](../../../index.html), or [`src/js/utils/browser/gamepad-navigation.ts`](../../../src/js/utils/browser/gamepad-navigation.ts).

## Why this exists

~11% of fix commits (125 sampled) are module-loading regressions: bundle load failures, manifest resolution drift, boot order, and gamepad/input polling lifecycle — the #5 category. This skill prevents those at review time.

## Boot path as it stands today

The pre-React DOM shell (`loader.ts`, `router.ts`, `toy-view.ts`, `library-view*`, `bootstrap/*`) is deleted. The single boot path is:

`index.html` → `src/js/app.ts` (agent API, telemetry, crash reporting, gamepad) → `StimsWorkspaceRouterProvider` → `App.tsx` → lazy panels → engine adapter → MilkDrop runtime.

`milkdrop/index.html` is a redirect alias only; it preserves search and hash and must not gain logic. See [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) for the full map.

## Pre-merge checklist

### 1. All toys load

- [ ] `bun run check:toys` passes — verifies toy manifest, generated artifacts, and entry points
- [ ] If adding or removing a toy entry, regenerate with `bun run generate:toys`

### 2. Boot order is explicit

- [ ] No new implicit ordering dependency inside `app.ts` between telemetry install, agent API install, and React mount
- [ ] Anything installed before `createRoot` must be safe to call with no DOM mounted yet
- [ ] New boot phases report through `reportLoadStatus()` so a stall is visible instead of a blank screen

### 3. Lazy loading handles failure

- [ ] Every `import()` / `use-lazy-factory` call has a rejection path that surfaces to the user, not a silent unresolved promise
- [ ] A failed panel chunk degrades the panel, not the running session
- [ ] Lazy factories are not re-created per render (that re-imports on every commit)

### 4. Gamepad/input lifecycle

- [ ] If touching gamepad or input polling, verify:
  - Polling starts after user interaction (not on page load)
  - Polling stops on unmount/navigation
  - No orphaned requestAnimationFrame loops

### 5. Catalog/manifest consistency

- [ ] If changing `src/data/toys.json`, the in-memory manifest matches the file
- [ ] Bundled preset loading (`catalog-store-bundled-loader.ts`) and persisted state (`catalog-store-persistence.ts`) stay consistent when the catalog shape changes
- [ ] Catalog resolution does not depend on file-system paths that differ between dev and production

### 6. Entry-point HTML

- [ ] `index.html` changes must be verified across all route entry points (`/`, `/?tool=`, `/?preset=`)
- [ ] No untested module preload or script-order changes in the HTML shell
- [ ] `milkdrop/index.html` still redirects with search and hash intact

## What to reject in review

- New `import()` calls in the boot path that don't handle load failure
- Toy manifest changes without regenerating `toys.json`
- Gamepad polling that starts before user gesture
- Implicit ordering assumptions between boot phases
- Any reintroduction of a second shell that boots the engine outside the adapter seam

## Related skills

- [`review-workspace-ui-state`](../review-workspace-ui-state/SKILL.md) — when the change involves the React workspace shell or URL state
- [`review-deploy-tooling`](../review-deploy-tooling/SKILL.md) — when the change involves build config that affects module bundling
