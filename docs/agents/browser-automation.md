# Browser automation API

How to drive and verify Stims from an agent, e2e test, or MCP session
without DOM scraping. Everything here is installed in **all modes** by
`src/js/frontend/App.tsx` via `src/js/frontend/agent-state.ts`.

## Quick start

```js
// Wait for boot without a timer:
await __stims_agent.waitFor((s) => s.engineState === 'ready');

// Act, then assert — run() resolves after the next state commit:
const result = await __stims_agent.run('audio-demo');   // {ok, settled}
await __stims_agent.waitFor((s) => s.engineState === 'live');

// Verify effects from the log, not from vanished toasts:
__stims_agent.getState().statusLog.at(-1);              // {at, message}
```

## Readiness

- `<body data-engine-state="booting|ready|live">` — selector-waitable;
  use it when you only have CSS-selector waits (Playwright, CDP).
- `__stims_agent.waitFor(predicate, timeoutMs = 5000)` — resolves with the
  matching snapshot; rejects on timeout. Replaces every sleep-and-repoll
  loop. The predicate sees the full snapshot (below). The timeout error
  carries the last state and the predicate's source
  (`waitFor timed out after 300ms. Last state: engineState="ready"
  presetId="…" catalogSize=2679 … renderingSuspended=false lastError=null.
  Predicate: (s) => …`), so you can see why without another `getState()`.

## State

`__stims_agent.getState()` returns one JSON snapshot:

| Field | Meaning |
| --- | --- |
| `engineState` | `'booting' \| 'ready' \| 'live'` (mirrors the body attribute) |
| `engineReady`, `liveMode`, `backend` | engine status; backend is `'webgl' \| 'webgpu'` once mounted |
| `panel` | open side panel (`browse`, `settings`, `editor`, …) or null |
| `presetId`, `presetTitle` | active preset |
| `catalogSize` | presets the shell can pick from; `0` until the deferred catalog load lands, which is later than `ready`, so `next-preset` is a no-op before then — `waitFor((s) => s.catalogSize > 0)` before choosing presets |
| `audioSource`, `audioEnergy` | current source and live RMS energy |
| `playbackPaused` | the stage is holding its frame at the user's request (Space, the dock's pause button, `toggle-playback`); everything stays mounted, unlike `stop-audio`, which unmounts the engine and returns to the start page |
| `autoplay`, `transition` | playback settings (`transition.mode`, `transition.blendDuration`) |
| `shaderExecution` | is the preset rendering as authored on the active backend? `'direct'` yes; `'none'` the preset has no shader text; `'translated'` / `'unsupported'` the backend cannot run the shader text and the renderer is substituting a **uniform-only approximation** — a plausible frame that is not the preset; `null` nothing compiled yet (never read null as "fine") |
| `fps`, `quality` | measured frame rate and adaptive-quality diagnostics (from the agent telemetry feed) |
| `lastError` | most recent window error / unhandled rejection message, or null |
| `statusLog` | last 20 status toasts, `{at, message}` — toasts are transient in the UI but durable here |
| `documentHidden`, `agentMode` | `document.hidden` right now, and whether the page was loaded with `?agent=true` |
| `renderingSuspended` | the frame loop is **skipping frames because this tab is hidden**. A hidden tab without `?agent=true` renders nothing and shows a black canvas with no error, which looks like a shader failure: check this first. Computed by the same rule the frame loop acts on (`src/js/core/hidden-tab-policy.ts`), so the two cannot disagree |

**Staleness caveat:** a `getState()` read in the same tick as an action can
predate the React commit. Use `await run(...)` / `waitFor(...)` instead of
read-immediately-after-write.

## Actions

- `run(actionId, params?)` → `Promise<{ok, settled, events?, error?, suggestions?}>`.
  Executes a command-palette action by stable id, resolving after the next
  state commit (or a 1s settle window — `settled: false` is normal for
  actions with no snapshot effect, e.g. `share-link`). **`ok: false` means
  nothing was done** and `error` says why and what to do:
  - an unknown id lists close matches in `suggestions`
    (`run('nxt-preset')` → `Did you mean "next-preset"?`);
  - `select-preset` fails with the preset id unknown, or while the catalog has
    not loaded (`waitFor((s) => s.catalogSize > 0)` first);
  - `set-field` fails for a non-finite value or before the engine mounts
    (`waitFor((s) => s.engineReady)` first).

  `ok: true` means the action was applied, not that it had the effect you
  hoped for: `settled` only says a state commit followed. So an `ok: true`
  result carries `events`: the typed events recorded while it settled, i.e.
  what the action changed. `run('next-preset')` returns
  `[{type: 'preset', data: {from, to, title}}]` with the new id, with no second
  `getState()` needed. An empty `events` means it changed nothing observable
  (also true of `share-link`); it can occasionally include an unrelated change
  that landed in the same window.
- `listActions()` → `[{id, label, params?}]` — every palette action (panels,
  preset moves, transitions, audio sources, pause/resume, save, share, watch
  party, autoplay, fullscreen, the preset-tuning nudges `nudge-*` /
  `wave-mode-*` / `toggle-transition-mode`) followed by the targeted verbs
  below, which also carry `params` describing what they take. The list is the
  source of truth for what exists; this page does not count it.
- Targeted verbs beyond the palette:
  - `run('select-preset', { id })` — play a specific catalog preset. The id is
    resolved the way the app's own route resolves it (legacy aliases work).
  - `run('set-field', { key, value })` — live-set a preset variable
    (e.g. `{key: 'zoom', value: 1.02}`), same path as MIDI. The key is **not**
    validated: a built-in, `q1`–`q32` or user variable name is written whether
    or not the active preset reads it, so `ok: true` means "written".
  - `run('crossfade', { position })`, `run('pin-parameter', { field })`,
    `run('unpin-parameter', { field })`.

## From the shell: `bun run ctl`

`stims-ctl` opens one headless session, applies its options in order, prints a
JSON summary and exits — no MCP client needed. Besides the preset, backend,
audio, field and shortcut options it drives this same API:

```bash
bun run ctl -- --step-timeout 90000 \
  --run 'select-preset={"id":"martin-skywards"}' \
  --wait-for 's.presetId === "martin-skywards"' \
  --run next-preset
```

- `--run <id>[=<json params>]` runs a palette action or targeted verb, in the
  order given with `--wait-for`. `select-preset` waits for the catalog and
  `set-field` for the engine first, the two preconditions `run()` rejects.
- `--wait-for '<expr>'` waits (push-based, no sleeping) until a JS expression
  over the state `s` is true.
- The summary's `agent` is the full `getState()` snapshot and `steps` has each
  step's result, including `events`. The process **exits non-zero** if any step
  failed, and prints `Step failed: …` to stderr, so a shell script can branch
  on it.

## Events

`getEvents(sinceSeq = 0)` → `[{seq, at, type, data}]`, last 100 retained.
Types: `status`, `error`, `engine-state`, `preset`, `panel`,
`audio-source`, `transition`, `autoplay`, `backend`, `shader-execution`.
Poll with the last
seen `seq` to drain incrementally; use it to assert causality ("my action
produced exactly these events") instead of diffing snapshots by hand.
`error` events capture window errors and unhandled rejections — check them
before diagnosing a black canvas. `shader-execution` events carry
`{from, to, backend, presetId, approximated}` and fire on both axes that can
change the answer — a preset switch *and* a backend fallback with the preset
held still.

**Asserting fidelity.** To require that what is on screen is what the preset
author wrote, rather than an approximation of it:

```js
const s = __stims_agent.getState();
if (s.shaderExecution !== 'direct' && s.shaderExecution !== 'none') {
  throw new Error(`approximated on ${s.backend}: ${s.shaderExecution}`);
}
```

A screenshot cannot tell you this — the approximation renders a plausible
frame, which is exactly why it went unnoticed for months. The same fact
appears in the UI as an "Approximated" marker beside the preset title in the
dock, in the `?debug=hud` overlay's "Shader lowering" section (the "On
&lt;backend&gt;" row), and in production aggregates via
`bun run telemetry:report`.

## Pixels

`captureStats()` → the visual-search `FrameStats` for the live stage
canvas — `{histogram: number[], edgeDensity, motionEstimate}` — or null
before mount. `motionEstimate` compares against the previous capture of
the same canvas. **On demand only** — reading back a WebGPU canvas can
stall the main thread for seconds on mobile; never call it per frame.
Call twice a few hundred ms apart: a nonzero `motionEstimate` and a
non-degenerate histogram assert "the visuals are actually animating".

## Equation variables

`await __stims_agent.getVariables()` → `{q1, q2, …, zoom, rot, …}` as of the
next rendered frame (null on timeout). `await __stims_agent.waitForVariables(
(v) => v.q1 > 0.5)` resolves with the first frame that satisfies the
predicate — use it instead of sleeping and re-reading. It is the same feed the
editor's Inspect tab shows, and it only runs while a call is pending. In a
hidden tab, pass `?agent=true` or no frame will arrive.

## DOM vocabulary

Stage dock controls and menu items carry `data-action` attributes matching
palette ids (`data-action="transition-2.5s"`, `"audio-microphone"`,
`"save-preset"`, …). Prefer them over `aria-label` selectors — labels are
copy and may change; ids must not.

## Determinism and environment

- `?agent=true` — suppresses autoplay, persists state across reloads,
  keeps rendering while `document.hidden` (browser-pane tabs report
  hidden; without this the canvas goes black and reads as a failure —
  `getState().renderingSuspended` tells you when that is what happened).
- `?renderer=webgl` — force the WebGL backend when WebGPU is suspect.
- `?mockAudio=1` (+ `?mockFrequency=`) — synthetic audio input.
- `?lockQualityStep=` — pin adaptive quality for reproducible frames.
- `window.__STIMS_AGENT_RENDER_FRAMES__` (agent mode) — synchronously
  render N frames with synthetic time/audio, for capture harnesses.
- `window.__stims_live` — performance API (ramp, listen, pattern
  playback); see `src/js/frontend/live-performance.ts`.
