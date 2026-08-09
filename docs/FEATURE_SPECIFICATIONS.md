# Feature Specifications (Current Build)

This document describes the shipped React workspace frontend and the preserved MilkDrop engine beneath it.

## Audit snapshot

| Area | Current state | Primary sources |
| --- | --- | --- |
| Root app route | `/` is the canonical workspace route and owns launch, browse, session, and settings surfaces. | `index.html`, `src/js/app.ts`, `src/js/frontend/App.tsx` |
| Legacy alias | `/milkdrop/` preserves older links by redirecting into `/` with query state intact. | `milkdrop/index.html`, `docs/PAGE_SPECIFICATIONS.md` |
| URL normalization | Legacy `experience`, `panel`, `collection`, `preset`, `audio`, and `agent` params are read; canonical URLs are written back from typed route state. | `src/js/frontend/url-state.ts` |
| Engine seam | The React shell talks to the MilkDrop engine only through the adapter contract. | `src/js/frontend/engine/milkdrop-engine-adapter.ts` |
| Preset runtime | MilkDrop compiler, runtime, and editor remain live behind the adapter. | `src/js/milkdrop/runtime.ts`, `src/js/milkdrop/overlay/` |
| Audio inputs | Demo, microphone, tab capture, and YouTube-backed capture are available from the workspace launch surface. | `src/js/frontend/App.tsx`, `src/js/ui/audio-advanced-sources.ts`, `src/js/ui/youtube-controller.ts` |
| Quality + fallback | WebGPU is preferred, WebGL fallback is supported, and users can tune quality, render scale, pixel ratio, and compatibility mode. | `src/js/core/renderer-capabilities.ts`, `src/js/core/settings-panel.ts`, `src/js/core/state/render-preference-store.ts` |
| Automation + QA | Agent mode, canonical route testing, and browser-backed smoke coverage are live on the root route. | `src/js/core/agent-api.ts`, `tests/e2e/agent-integration.test.ts` |

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

- The workspace exposes browse, editor, and settings entry points.
- Editor capability is still fulfilled by the MilkDrop overlay/runtime internals behind the adapter seam.
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

## Frontend surface

The pre-React DOM shell (`loader.ts`, `router.ts`, `toy-view.ts`, `library-view*`, `bootstrap/*`) has been deleted; `milkdrop/index.html` is the only remaining compatibility surface and it redirects to `/`.

Product-facing frontend work belongs in:

- `src/js/app.ts`
- `src/js/frontend/*`
- `src/js/frontend/engine/milkdrop-engine-adapter.ts`
