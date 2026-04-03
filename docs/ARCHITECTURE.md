# Architecture Overview

This document describes the current shipped frontend architecture for Stims after the React workspace cutover. The root route at `/` is the product surface. `milkdrop/index.html` exists only as a compatibility alias that redirects into `/`.

## Current shape

- `index.html` is the single app shell and bootstraps `assets/js/app.ts`.
- `assets/js/app.ts` mounts the React workspace and global runtime affordances.
- `assets/js/frontend/*` owns route state, workspace UI, and the engine adapter seam.
- `assets/js/milkdrop/*` remains the imperative visualizer engine, overlay, compiler, and catalog runtime.
- `assets/js/core/*` owns shared renderer, audio, quality, persistence, and input systems.
- `assets/js/loader.ts`, `assets/js/toy-view.ts`, `assets/js/library-view.js`, and `assets/js/bootstrap/*` remain as compatibility and test-support internals for older non-root shell flows. They are not the production root app surface anymore.

## Runtime map

```mermaid
flowchart LR
  Entry["index.html<br/>root app shell"]
  Alias["milkdrop/index.html<br/>redirect alias"]
  App["assets/js/app.ts<br/>React boot + globals"]
  Frontend["assets/js/frontend/*<br/>workspace UI + URL state"]
  Adapter["milkdrop-engine-adapter.ts<br/>strict engine seam"]
  Core["assets/js/core/*<br/>renderer + audio + settings"]
  Milkdrop["assets/js/milkdrop/*<br/>runtime + overlay + compiler"]
  Legacy["loader.ts / toy-view.ts / bootstrap/*<br/>compatibility internals"]

  Entry --> App
  Alias --> App
  App --> Frontend
  Frontend --> Adapter
  Frontend --> Core
  Adapter --> Core
  Adapter --> Milkdrop
  Legacy --> Core
  Legacy --> Milkdrop
```

## Route contract

- Canonical route: `/`
- Compatibility alias: `/milkdrop/`
- Legacy query params still read on boot:
  - `experience`
  - `panel`
  - `collection`
  - `preset`
  - `audio`
  - `agent`
- Canonical query params written by the app:
  - `tool`
  - `collection`
  - `preset`
  - `audio`
  - `agent`
- Unknown query params are preserved during canonicalization.
- Unsupported legacy `experience` slugs are surfaced as an invalid-experience state instead of silently booting another shell.

Primary implementation:
- [`assets/js/frontend/url-state.ts`](../assets/js/frontend/url-state.ts)
- [`assets/js/frontend/contracts.ts`](../assets/js/frontend/contracts.ts)

## Frontend ownership

### App bootstrap

- [`assets/js/app.ts`](../assets/js/app.ts) installs telemetry persistence, the agent API, and gamepad navigation.
- It renders [`assets/js/frontend/App.tsx`](../assets/js/frontend/App.tsx) into `#app`.
- It no longer delegates root ownership to the old DOM loader stack.

### Workspace UI

- [`assets/js/frontend/App.tsx`](../assets/js/frontend/App.tsx) owns:
  - top navigation
  - launch controls
  - preset browsing and search
  - session stage container
  - settings surface
  - canonical URL synchronization
  - focused-session state
- [`assets/css/app-shell.css`](../assets/css/app-shell.css) owns the new workspace presentation layer.

### Engine seam

- [`assets/js/frontend/engine/milkdrop-engine-adapter.ts`](../assets/js/frontend/engine/milkdrop-engine-adapter.ts) is the only frontend-facing engine boundary.
- New UI code should not import deep `assets/js/milkdrop/*` runtime internals directly.
- The adapter owns:
  - mount and dispose
  - preset loading
  - audio source changes
  - panel/tool opening
  - collection changes
  - import/export
  - diagnostics and snapshot subscription

## MilkDrop engine ownership

- [`assets/js/milkdrop/runtime.ts`](../assets/js/milkdrop/runtime.ts) remains the long-lived imperative session runtime.
- [`assets/js/milkdrop/overlay.ts`](../assets/js/milkdrop/overlay.ts) and `overlay/*` still provide the editor, inspector, browse, and shortcut HUD surfaces.
- [`assets/js/milkdrop/compiler.ts`](../assets/js/milkdrop/compiler.ts), `compiler/*`, and [`assets/js/milkdrop/vm.ts`](../assets/js/milkdrop/vm.ts) remain the preset compilation and execution path.

Important boundary rule:
- The React shell may drive engine capabilities through the adapter.
- The engine still owns actual visualization rendering and its internal overlay/editor composition for v1.

## Shared systems

- [`assets/js/core/renderer-capabilities.ts`](../assets/js/core/renderer-capabilities.ts) probes WebGPU/WebGL support.
- [`assets/js/core/settings-panel.ts`](../assets/js/core/settings-panel.ts) owns shared quality preset state.
- [`assets/js/core/state/render-preference-store.ts`](../assets/js/core/state/render-preference-store.ts) owns renderer preferences.
- [`assets/js/core/motion-preferences.ts`](../assets/js/core/motion-preferences.ts) owns motion-state persistence.
- [`assets/js/core/agent-api.ts`](../assets/js/core/agent-api.ts) exposes automation-friendly session state and control hooks.

## Legacy compatibility modules

These modules still exist and are tested, but they are not the production root app surface:

- [`assets/js/loader.ts`](../assets/js/loader.ts)
- [`assets/js/toy-view.ts`](../assets/js/toy-view.ts)
- [`assets/js/library-view.js`](../assets/js/library-view.js)
- [`assets/js/bootstrap/*`](../assets/js/bootstrap)

Treat them as compatibility-support code for:
- older route assumptions
- non-root loader flows
- lower-level lifecycle tests
- historical/manual workflows that have not been fully retired

Do not route new product work through them when the feature belongs to the root workspace.

## Verification anchors

Use these checks when changing architecture-sensitive areas:

```bash
bun run check
bun run test tests/frontend-url-state.test.ts tests/app-shell.test.js tests/agent-integration.test.ts
```

The architecture boundary gate remains:

```bash
bun run check:architecture
```
