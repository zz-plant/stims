---
name: review-workspace-ui-state
description: "Review changes to React workspace UI state, URL routing, toast/panel behavior, or engine adapter interactions. Use when a PR touches src/js/frontend/*, especially App.tsx, workspace hooks, or url-state.ts."
---

# Review Workspace UI State and Engine Adapter Boundary

Use this skill when reviewing or authoring changes to the React workspace shell, URL state, tool toggles, toast notifications, or any code that bridges `src/js/frontend/` and `src/js/milkdrop/`.

## Why this exists

**19% of fix commits — the #3 category** (steady; it ranked #2 when deploy/tooling was lower). Workspace UI races: tool toggles double-firing, toast state leaking, URL param collisions between legacy (`experience`, `panel`) and canonical (`tool`, `collection`) keys. This skill keeps the adapter boundary clean. Measured 2026-08-27 over the last 400 commits (134 fix/revert), one category per commit by dominant file share; re-run it with [`audit-recurring-fixes`](../audit-recurring-fixes/SKILL.md) rather than trusting this number.

## Pre-merge checklist

### 1. All engine interaction goes through the adapter

- [ ] `App.tsx` and workspace hooks do not import deep `src/js/milkdrop/*` internals directly.
- [ ] State exchange uses typed events or the adapter's public API, not imperative runtime calls.

### 2. URL state is canonicalized, not patched

- [ ] Legacy query params are read on boot and rewritten to canonical form, not carried forward as aliases.
- [ ] New params use the canonical namespace (`tool`, `collection`, `preset`, `audio`).
- [ ] URL changes are coalesced (one history update per logical update, not per keystroke). Almost every update should be `replaceState`; the one deliberate exception is `useWorkspaceRouteState` calling `pushState` when a panel transitions from closed to open, so Back/the Android back gesture closes the sheet instead of leaving the site — a new `pushState` call needs the same "closes something the user just opened" justification, not a blanket rejection.

### 3. Toast/panel state is isolated from engine state

- [ ] Toast notifications do not depend on MilkDrop runtime frame callbacks.
- [ ] Panel open/close state is owned by React; engine overlay state is owned by the adapter. No direct reads/writes between the two.

### 4. Async state transitions are guarded

- [ ] Any `useEffect` or event handler that triggers an engine lifecycle change (mount, dispose, preset switch) checks for stale closure or racing unmount.
- [ ] Prefer `AbortController` or explicit cleanup functions over implicit ordering.

### 5. UI-state regression test

- [ ] If adding new toggle/panel/toast behavior, add a test that simulates rapid open/close/overlay/navigation and asserts:
  - no duplicate toasts
  - no stale URL params
  - no engine crashes

  ```bash
  bun run test tests/unit/frontend-url-state.test.ts
  bun run test tests/unit/app-shell.test.ts
  ```

## What to reject in review

- Direct imports from `src/js/milkdrop/runtime.ts` or `src/js/milkdrop/vm.ts` into frontend components
- URL state updates that append rather than replace query params, or that push a new history entry without the "closes something the user just opened" justification `useWorkspaceRouteState`'s panel-open case has
- Toast or panel logic that reads `window.milkdropRuntime` or similar global
- Missing cleanup for `useEffect` subscriptions that touch engine lifecycle

## Related skills

- [`modify-visualizer-runtime`](../../modify-visualizer-runtime/SKILL.md) — when the change is mainly engine-side
- [`ship-visualizer-change`](../../ship-visualizer-change/SKILL.md) — for end-to-end product changes
