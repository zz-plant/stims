---
name: review-module-loading
description: "Review changes to module loading, bootstrap, toy manifest, library resolution, or gamepad polling. Use when a PR touches assets/js/bootstrap/, assets/js/loader.ts, assets/js/router.ts, assets/js/toy-view.ts, assets/data/toys.json, or gamepad polling code."
---

# Review Module Loading and Bootstrap

Use this skill when reviewing or authoring changes to `assets/js/bootstrap/*`, `assets/js/loader.ts`, `assets/js/library-view.js`, `assets/js/toy-view.ts`, `assets/js/milkdrop/catalog-store*.ts`, `assets/data/toys.json`, `index.html`, or gamepad polling code.

## Why this exists

~11% of fix commits (125 sampled) are module-loading regressions: toy bundle loading failures, manifest resolution drift, library boot order, and gamepad/input polling lifecycle — the #5 category. This skill prevents those at review time.

## Pre-merge checklist

### 1. All toys load

- [ ] `bun run check:toys` passes — verifies toy manifest, generated artifacts, and entry points
- [ ] If adding or removing a toy entry, the manifest is regenerated

### 2. Bootstrap order is explicit

- [ ] No new implicit ordering dependency between loader, router, and toy-view
- [ ] If adding a new bootstrap step, document its position in the sequence

### 3. Gamepad/input lifecycle

- [ ] If touching gamepad or input polling, verify:
  - Polling starts after user interaction (not on page load)
  - Polling stops on unmount/navigation
  - No orphaned requestAnimationFrame loops

### 4. Library/manifest consistency

- [ ] If changing `assets/data/toys.json`, the in-memory manifest matches the file
- [ ] Library resolution does not depend on file-system paths that differ between dev and production

### 5. Index.html entry points

- [ ] `index.html` changes must be verified across all route entry points (`/`, `/?tool=`, `/?preset=`)
- [ ] No untested module preload or script-order changes in the HTML shell

## What to reject in review

- New `import()` calls in bootstrap that don't handle load failure
- Toy manifest changes without regenerating `toys.json`
- Gamepad polling that starts before user gesture
- Implicit ordering assumptions between bootstrap phases

## Related skills

- [`review-workspace-ui-state`](../review-workspace-ui-state/SKILL.md) — when the change involves the UI shell that wraps loaded toys
- [`review-deploy-tooling`](../review-deploy-tooling/SKILL.md) — when the change involves build config that affects module bundling
