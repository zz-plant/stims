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
  loop. The predicate sees the full snapshot (below).

## State

`__stims_agent.getState()` returns one JSON snapshot:

| Field | Meaning |
| --- | --- |
| `engineState` | `'booting' \| 'ready' \| 'live'` (mirrors the body attribute) |
| `engineReady`, `liveMode`, `backend` | engine status; backend is `'webgl' \| 'webgpu'` once mounted |
| `panel` | open side panel (`browse`, `settings`, `editor`, …) or null |
| `presetId`, `presetTitle` | active preset |
| `audioSource`, `audioEnergy` | current source and live RMS energy |
| `autoplay`, `transition` | playback settings (`transition.mode`, `transition.blendDuration`) |
| `shaderExecution` | is the preset rendering as authored on the active backend? `'direct'` yes; `'none'` the preset has no shader text; `'translated'` / `'unsupported'` the backend cannot run the shader text and the renderer is substituting a **uniform-only approximation** — a plausible frame that is not the preset; `null` nothing compiled yet (never read null as "fine") |
| `fps`, `quality` | measured frame rate and adaptive-quality diagnostics (from the agent telemetry feed) |
| `lastError` | most recent window error / unhandled rejection message, or null |
| `statusLog` | last 20 status toasts, `{at, message}` — toasts are transient in the UI but durable here |

**Staleness caveat:** a `getState()` read in the same tick as an action can
predate the React commit. Use `await run(...)` / `waitFor(...)` instead of
read-immediately-after-write.

## Actions

- `run(actionId, params?)` → `Promise<{ok, settled, error?}>`. Executes a
  command-palette action by stable id, resolving after the next state
  commit (or a 1s settle window — `settled: false` is normal for actions
  with no snapshot effect, e.g. `share-link`).
- `listActions()` → `[{id, label}]` — the current palette registry
  (~21 actions: panels, preset moves, transitions, audio sources, save,
  share, watch party, autoplay, fullscreen).
- Targeted verbs beyond the palette:
  - `run('select-preset', { id })` — play a specific catalog preset.
  - `run('set-field', { key, value })` — live-set a preset variable
    (e.g. `{key: 'zoom', value: 1.02}`), same path as MIDI.

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

## DOM vocabulary

Stage dock controls and menu items carry `data-action` attributes matching
palette ids (`data-action="transition-2s"`, `"audio-microphone"`,
`"save-preset"`, …). Prefer them over `aria-label` selectors — labels are
copy and may change; ids must not.

## Determinism and environment

- `?agent=true` — suppresses autoplay, persists state across reloads,
  keeps rendering while `document.hidden` (browser-pane tabs report
  hidden; without this the canvas goes black and reads as a failure).
- `?renderer=webgl` — force the WebGL backend when WebGPU is suspect.
- `?mockAudio=1` (+ `?mockFrequency=`) — synthetic audio input.
- `?lockQualityStep=` — pin adaptive quality for reproducible frames.
- `window.__STIMS_AGENT_RENDER_FRAMES__` (agent mode) — synchronously
  render N frames with synthetic time/audio, for capture harnesses.
- `window.__stims_live` — performance API (ramp, listen, pattern
  playback); see `src/js/frontend/live-performance.ts`.
