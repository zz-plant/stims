# Browser automation API

How to drive and verify Stims from an agent, e2e test, or MCP session
without DOM scraping. Everything here is installed in **all modes** by
`src/js/frontend/App.tsx` via `src/js/frontend/agent-state.ts`.

## Quick start

```js
// Wait for boot without a timer:
await __stims_agent.waitFor((s) => s.engineState === 'ready');

// Act, then assert — run() resolves after the next state commit:
const result = await __stims_agent.run('audio-demo'); // {ok, settled}
await __stims_agent.waitFor((s) => s.engineState === 'live');

// Verify effects from the log, not from vanished toasts:
__stims_agent.getState().statusLog.at(-1); // {at, message, source}
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

| Field                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engineState`                             | `'booting' \| 'ready' \| 'live'` (mirrors the body attribute)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `engineReady`, `liveMode`, `backend`      | engine status; backend is `'webgl' \| 'webgpu'` once mounted                                                                                                                                                                                                                                                                                                                                                                                                         |
| `panel`                                   | open side panel (`browse`, `settings`, `editor`, …) or null                                                                                                                                                                                                                                                                                                                                                                                                          |
| `presetId`, `presetTitle`, `presetAuthor` | active preset; title and author come from the catalog entry for `presetId`, so all three name the same preset                                                                                                                                                                                                                                                                                                                                                        |
| `catalogSize`                             | presets the shell can pick from; `0` until the deferred catalog load lands, which is later than `ready`, so `next-preset` is a no-op before then — `waitFor((s) => s.catalogSize > 0)` before choosing presets                                                                                                                                                                                                                                                       |
| `audioSource`, `audioEnergy`              | current source and live RMS energy                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `playbackPaused`                          | the stage is holding its frame at the user's request (Space, the dock's pause button, `toggle-playback`); everything stays mounted, unlike `stop-audio`, which unmounts the engine and returns to the start page                                                                                                                                                                                                                                                     |
| `autoplay`, `transition`                  | playback settings (`transition.mode`, `transition.blendDuration`)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `shaderExecution`                         | the compiler's verdict: can the active backend run the preset's shader text? `'direct'` yes; `'none'` the preset has no shader text; `'translated'` / `'unsupported'` no, so the renderer substitutes a **uniform-only approximation** — a plausible frame that is not the preset; `null` nothing compiled yet (never read null as "fine"). It does not see routing that overrides it: `?milkdrop-webgpu-feedback=0` and the safe WebGPU path leave it at `'direct'` |
| `appliedShaderExecution`                  | what the renderer ran on the last presented frame: `'direct'` the authored shader text; `'controls'` the uniform-only approximation (for a `'none'` preset, that is the preset as authored); `'off'` no feedback pass at all (the safe WebGPU path); `null` no frame presented since the preset loaded, or its programs are still compiling. Wait for it to be non-null; in a hidden pane, pump frames with `__STIMS_AGENT_RENDER_FRAMES__`                          |
| `fps`, `quality`                          | measured frame rate and adaptive-quality diagnostics (from the agent telemetry feed)                                                                                                                                                                                                                                                                                                                                                                                 |
| `lastError`                               | most recent window error / unhandled rejection message, or null                                                                                                                                                                                                                                                                                                                                                                                                      |
| `statusLog`                               | last 20 status messages, `{at, message, source}`. `source` is `'shell'` for the workspace's status line or `'runtime'` for the engine's (`Loaded …`, blend refusals, `WebGPU rollout flags active: …`). Runtime statuses are logged as they are set, including the ones the toast hides and the ones the next status overwrites in the engine snapshot                                                                                                               |
| `documentHidden`, `agentMode`             | `document.hidden` right now, and whether the page was loaded with `?agent=true`                                                                                                                                                                                                                                                                                                                                                                                      |
| `renderingSuspended`                      | the frame loop is **skipping frames because this tab is hidden**. A hidden tab without `?agent=true` renders nothing: the canvas goes black with no error and looks like a shader failure, so check this first. Computed by the same rule the frame loop acts on (`src/js/core/hidden-tab-policy.ts`), so the two cannot disagree                                                                                                                                    |
| `tempo`                                   | `{bpm, source}`: the tempo auto-advance lands its switches on. `source` is `'audio'` (estimated from onsets; `bpm` stays null until the estimate is confident), `'tap'` (`run('tap-tempo')` on each beat, first tap on the downbeat) or `'midi-clock'` (an external clock is running)                                                                                                                                                                                |

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
  `[{type: 'preset', data: {from, to, title, author}}]` with the new id, with
  no second `getState()` needed. An empty `events` means it changed nothing
  observable (also true of `share-link`); it can occasionally include an
  unrelated change that landed in the same window.
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
- `--post '<json>'` sends one `toil:*` message (the iframe protocol in
  `public/llms-full.txt`) in the same order and records its reply, matched by
  `requestId`. `--set-field key=value` is a `toil:midi_set` post and waits for
  its reply too.
- `--embed` loads the app at `?embed=true` inside an iframe on a parent page
  (`scripts/embed-harness.ts`) and posts from the parent, so messages cross a
  real frame boundary the way they do for an embedding site. Nothing mounts
  there until a command asks for a preset or audio, so lead with one:

  ```bash
  bun run ctl -- --embed \
    --post '{"type":"toil:load_preset","presetId":"geiss-casino"}' \
    --post '{"type":"toil:set_audio","source":"demo"}' \
    --post '{"type":"toil:run","id":"next-preset"}'
  ```

- The summary's `agent` is the full `getState()` snapshot and `steps` has each
  step's result, including `events` (and a posted message's `reply`). The
  process **exits non-zero** if any step failed, and prints `Step failed: …`
  to stderr, so a shell script can branch on it.

## On the tab you are watching: the live channel

`bun run ctl` and the MCP sessions launch a browser of their own. The live
channel drives the tab already open on `bun run dev` instead: a vite plugin
(`scripts/vite-live-channel.ts`) relays commands over the WebSocket vite holds
open for hot reload, and the page half (`src/js/frontend/live-channel.ts`)
answers them. Neither exists in a build.

**Which tab.** Every tab on the dev server reports to it, and one of them is
the stage: a visible, focused tab first, then a visible one. Ties go to the tab
brought forward last, so clicking into a terminal leaves the stage where it
is. An automated tab (`navigator.webdriver`: Playwright, the MCP sessions,
`ctl`) becomes the stage only with `?liveChannel=1` in its URL. The Browser
pane reports itself hidden, so it is the stage only when no visible tab is
connected.

**Out, in `scratch/live/`:**

- `events.jsonl`: one JSON object per line. The stage's `getEvents()` entries
  carry `from: "page"`, stage changes `from: "channel"`, and every command,
  with its result and duration, `from: "agent"`. Rotated to `events.1.jsonl`
  at 5 MB. Follow it with `tail -f`, or wake on a line such as `"type":"error"`.
- `state.json`: the stage's latest `getState()` without `statusLog`, plus
  `performanceRevision` and the `__stims_live` fader positions, rewritten about
  once a second.
- `frame.jpg`: the last capture. `server.json`: the port this dev server took.

**In, as commands:**

```bash
bun run live -- status
bun run live -- run select-preset '{"id":"geiss-casino"}'
bun run live -- call ramp '{"targets":{"warp":2.4},"durationMs":6000}'
bun run live -- capture     # → scratch/live/frame.jpg
bun run live -- send '{"type":"toil:set_audio","source":"demo"}'
```

`send` takes any `toil:*` message (the protocol `--post` uses above),
`{"type":"live","method":…,"args":[…]}` for a `window.__stims_live` method, or
`{"type":"capture"}`. The CLI posts to `POST /__stims-live/command` and reads
`GET /__stims-live/state`; curl works too, with
`Content-Type: application/json`. Both routes answer this machine only. A
command the stage never answers fails after 45 s; pass `--timeout` for a
longer ramp.

**In, as files.** Saving `scratch/live/preset.milk` applies it as preset
source (`toil:apply_source`), and the compile result, diagnostics and line
numbers included, lands in `events.jsonl` under `via: "file:preset.milk"`.
Saving `scratch/live/pattern.js` plays it as a Strudel pattern; saving it
empty hushes. A save applies when its content changed or the stage did.
Strudel needs an audio context the page has already unlocked with a click.

The lab and e2e servers that `scripts/dev-server.ts` spawns set
`STIMS_LIVE_CHANNEL=0`, so automated runs never write these files. Set it
yourself to turn the channel off.

## Events

`getEvents(sinceSeq = 0)` → `[{seq, at, type, data}]`, last 100 retained.
Types: `status`, `error`, `engine-state`, `preset`, `panel`,
`audio-source`, `transition`, `autoplay`, `backend`, `shader-execution`.
`status` events carry `{message, source}`, the same pair `statusLog` keeps.
Poll with the last
seen `seq` to drain incrementally; use it to assert causality ("my action
produced exactly these events") instead of diffing snapshots by hand.
`error` events capture window errors and unhandled rejections — check them
before diagnosing a black canvas. `shader-execution` events carry
`{from, to, backend, presetId, approximated}` and fire on both axes that can
change the answer — a preset switch _and_ a backend fallback with the preset
held still. They follow `shaderExecution` only: `appliedShaderExecution` drops
to null on every load and settles a frame later, so it has no event; read it
with `waitFor`.

**Asserting fidelity.** To require that the preset's shader text is what is on
screen, rather than an approximation of it or nothing at all, check what the
renderer applied, not the compiler's verdict:

```js
const s = await __stims_agent.waitFor(
  (s) => s.presetId === id && s.appliedShaderExecution !== null,
);
if (s.shaderExecution !== 'none' && s.appliedShaderExecution !== 'direct') {
  throw new Error(
    `shader text not running on ${s.backend}: ` +
      `verdict ${s.shaderExecution}, applied ${s.appliedShaderExecution}`,
  );
}
```

`shaderExecution === 'direct'` alone is not enough: with
`?milkdrop-webgpu-feedback=0` it stays `'direct'` while the composite runs the
controls approximation, and on the safe WebGPU path no feedback pass runs.

A screenshot cannot tell you this — the approximation renders a plausible
frame, so it went unnoticed for months. The compiler's verdict also appears in
the UI as an "Approximated" marker beside the preset title in the dock, in the
`?debug=hud` overlay's "Shader lowering" section (the "On &lt;backend&gt;"
row), and in production aggregates via `bun run telemetry:report`. None of
those reflect `appliedShaderExecution`.

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

- `?agent=true` — keeps rendering while `document.hidden` (Browser-pane tabs
  always report hidden; without this the canvas goes black and reads as a
  shader failure — `getState().renderingSuspended` tells you when that is what
  happened, by the rule in `src/js/core/hidden-tab-policy.ts`). It also lifts
  the power-saving frame cap, preserves the drawing buffer so canvas readbacks
  see the frame, installs `window.__milkdropRuntimeDebug` (trace capture,
  debug snapshots), and stays in the URL across in-app navigation.
- `?renderer=webgl` — force the WebGL backend when WebGPU is suspect.
- `?mockAudio=demo` — replace microphone capture with the procedural demo
  track (arpeggio, kick, sub drone), so presets react without a microphone.
  Any other value is a single oscillator: `sine`, `square`, `sawtooth` or
  `triangle` at `?mockFrequency=` Hz (default 220), and an unrecognised value
  such as `1` falls back to a 220 Hz sawtooth. A constant tone has a frozen
  spectrum, so band levels and beat detection flatline and presets stop
  reacting; use an oscillator only when you want that steady input
  (`src/js/core/audio-handler.ts`).
- `?lockQualityStep=` — pin adaptive quality for reproducible frames.
- `window.__STIMS_AGENT_RENDER_FRAMES__` (agent mode) — synchronously
  render N frames with synthetic time/audio, for capture harnesses.
- `window.__stims_live` — performance API (ramp, listen, pattern
  playback); see `src/js/frontend/live-performance.ts`.

## Explicit decision capture

`await __stims_agent.captureImage()` returns one JPEG of the live stage, at most 640 pixels on its longest side, or `null` without a canvas. It reads inside a frame callback with a three-second deadline and uploads nothing. `__stims_agent.getPerformanceRevision()` is a monotonic local mutation token for preset/source/control changes; audio samples and rendered frames do not advance it. Decision consumers compare it again immediately before applying a suggestion. See [Decision models](../DECISION_MODELS.md).
