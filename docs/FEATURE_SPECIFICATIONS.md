# Feature Specifications (Current Build)

This document describes the shipped React workspace frontend and the preserved MilkDrop engine beneath it.

## Audit snapshot

| Area | Current state | Primary sources |
| --- | --- | --- |
| Root app route | `/` is the canonical workspace route and owns launch, browse, session, and settings surfaces. | `index.html`, `assets/js/app.ts`, `assets/js/frontend/App.tsx` |
| Legacy alias | `/milkdrop/` preserves older links by redirecting into `/` with query state intact. | `milkdrop/index.html`, `docs/PAGE_SPECIFICATIONS.md` |
| URL normalization | Legacy `experience`, `panel`, `collection`, `preset`, `audio`, and `agent` params are read; canonical URLs are written back from typed route state. | `assets/js/frontend/url-state.ts` |
| Engine seam | The React shell talks to the MilkDrop engine only through the adapter contract. | `assets/js/frontend/engine/milkdrop-engine-adapter.ts` |
| Preset runtime | MilkDrop compiler, runtime, overlay, editor, and inspector remain live behind the adapter. | `assets/js/milkdrop/runtime.ts`, `assets/js/milkdrop/overlay.ts` |
| Audio inputs | Demo, microphone, tab capture, and YouTube-backed capture are available from the workspace launch surface. | `assets/js/frontend/App.tsx`, `assets/js/ui/audio-advanced-sources.ts`, `assets/js/ui/youtube-controller.ts` |
| Quality + fallback | WebGPU is preferred, WebGL fallback is supported, and users can tune quality, render scale, pixel ratio, and compatibility mode. | `assets/js/core/renderer-capabilities.ts`, `assets/js/core/settings-panel.ts`, `assets/js/core/state/render-preference-store.ts` |
| Automation + QA | Agent mode, canonical route testing, and browser-backed smoke coverage are live on the root route. | `assets/js/core/agent-api.ts`, `tests/agent-integration.test.ts` |

## Root workspace (`/`)

### Launch surface

- One route owns both entry and live session behavior.
- Launch controls expose:
  - demo audio
  - microphone
  - tab capture
  - YouTube capture
- The shell waits until the engine is mount-ready before enabling interactive launch controls.

### Preset browsing

- Presets load from `public/milkdrop-presets/catalog.json`.
- Search matches title, author, id, and tags.
- Collection pills normalize onto `collection:*` route state.
- Preset selection updates canonical route state and the live engine session.

### Session workspace

- The stage mounts the live MilkDrop runtime into the React shell.
- The shell shows:
  - current preset
  - renderer backend
  - audio source
  - runtime status/fallback copy
- Live status messaging reuses a single visible status surface instead of spreading error copy across multiple shells.

### Tools and settings

- The workspace exposes browse, editor, inspector, and settings entry points.
- In v1, editor and inspector capabilities are still fulfilled by the MilkDrop overlay/runtime internals behind the adapter seam.
- Session settings include:
  - quality preset
  - compatibility mode
  - motion toggle
  - render scale
  - pixel ratio cap

## Compatibility behavior

### Alias route

- `/milkdrop/` redirects to `/`.
- Query params survive the redirect.
- The alias is compatibility-only and not a separate product surface.

### Legacy query support

- The app still accepts older launch shapes like:
  - `?experience=milkdrop`
  - `?panel=looks`
  - `?audio=sample`
- Canonicalized URLs switch to:
  - `?tool=browse`
  - `?audio=demo`

### Invalid experience handling

- Unsupported legacy `experience` slugs render an explicit “Unknown experience” state.
- The app does not silently fall back to another shell or legacy page.

## Persistence

| Purpose | Storage |
| --- | --- |
| Quality preset | `localStorage` |
| Compatibility mode | `localStorage` |
| Render scale | `localStorage` |
| Max pixel ratio | `localStorage` |
| Motion enabled | `localStorage` |
| Recent YouTube list | `localStorage` |

## Residual legacy modules

The following modules still exist for compatibility coverage and lower-level tests, but they are not the root frontend architecture anymore:

- `assets/js/loader.ts`
- `assets/js/router.ts`
- `assets/js/toy-view.ts`
- `assets/js/library-view.js`
- `assets/js/library-view/*`
- `assets/js/bootstrap/*`

Current product-facing frontend work should prefer:

- `assets/js/app.ts`
- `assets/js/frontend/*`
- `assets/js/frontend/engine/milkdrop-engine-adapter.ts`
