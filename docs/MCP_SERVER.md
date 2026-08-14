# MCP Server Guide

The repository includes an MCP stdio server at `scripts/mcp-server.ts` and a Cloudflare Worker transport at `scripts/mcp-worker.ts`. The stdio server (`bun run mcp`) is the primary path — it has access to all tools including headless browser automation.

## Tool Categories

### Documentation & Commands (Worker + Stdio)

| Tool | Input | Output |
|------|-------|--------|
| `list_docs` | none | Quick-start, runtime, and repo layout pointers from README.md |
| `read_doc_section` | `file` (enum), optional `heading` | Markdown file or section content |
| `search_docs` | `query`, optional `file`, optional `limit` | Matching sections with excerpts |
| `dev_commands` | optional `scope` (setup/dev/build/test/lint) | Relevant commands from README.md |
| `describe_loader` | none | How the toy loader resolves entries and errors |
| `list_agent_capabilities` | optional `kind` (skill/workflow) | Available agent workflows and skills |
| `read_agent_capability` | `kind`, `name` | Full skill/workflow instructions |
| `get_toys` | optional `slug`, `requiresWebGPU` | Toy metadata (controls, module, type) |
| `launch_toy` | `slug`, optional `port` | Instructions for launching and observing a toy |
| `get_toy_audio_reactivity_guide` | optional `slug` | How toys respond to audio frequencies |

### Preset Catalog (Worker + Stdio)

All tools fetch the live catalog from `https://toil.fyi/milkdrop-presets/catalog.json` — no local server needed.

| Tool | Input | Output |
|------|-------|--------|
| `list_presets` | optional `filter`, `limit` (1-50) | Preset summaries (id, title, author, tags, fidelity, certification) |
| `search_presets` | `query`, optional `limit` | Matching presets with matched field (title/author/tags) |
| `get_preset_info` | `presetId` | Full preset metadata (file path, tags, certification, supports) |
| `describe_preset` | `presetId` | Human-readable description — style, collections, fidelity, launch URL |
| `open_preset_url` | `presetId`, optional `baseUrl` | URL to load the preset in agent mode |

### Agent Session (Stdio-only, requires Playwright)

These tools manage a persistent headless browser session so you can interact with a running visualizer across multiple calls. **Start here for any visual interaction.**

**Workflow:**
1. `start_agent_session` → get a `sessionId`
2. Use session tools to inspect, capture, tweak, and switch
3. `session_close` when done

| Tool | Input | Output |
|------|-------|--------|
| `start_agent_session` | optional `presetId`, `headless` | Session ID — the visualizer opens in a persistent browser |
| `session_get_state` | `sessionId` | Current state: preset title, author, audio energy (0-1), backend, canvas size |
| `session_capture_frame` | `sessionId`, optional `waitMs` | Path to captured screenshot |
| `session_describe_frame` | `sessionId`, optional `waitMs` | Preset info + screenshot path (no pixel analysis — use a vision model) |
| `session_switch_preset` | `sessionId`, `presetId`, optional `waitMs` | Confirmation when new preset is rendered |
| `session_tweak` | `sessionId`, `tweak` (natural language), optional `amount` | Resolves the tweak against real field values, applies it in one commit, reports `from → to` per field plus diagnostics |
| `session_apply_source` | `sessionId`, `source` (.milk code) | Applies source, **waits for the compile**, returns diagnostics with line numbers and whether the stage fell back |
| `session_editor_state` | `sessionId` | Read-only: preset, error/warning counts, per-line diagnostics, dirty flag, fallback flag |
| `session_set_fields` | `sessionId`, `fields` (name → value) | Sets several fields in ONE compile; returns the same diagnostics as `session_apply_source` |
| `session_get_preset_source` | `presetId` or `sessionId` | Raw .milk source code from disk |
| `session_get_inspector_values` | `sessionId`, optional `filter` | Live numeric field values from the compiled IR (no panel needs to be open) |
| `session_midi_set` | `sessionId`, `target`, `value` | Sets a field (zoom, warp, q1, any preset variable) as the virtual "Claude (MCP)" MIDI device |
| `session_midi_cc` | `sessionId`, `cc` (0-127), `value` (0-127) | Sends a raw CC value, resolved through the Claude device's current mapping |
| `session_midi_bindings` | `sessionId` | CC→target mappings for every known device, keyed by device id |
| `session_midi_devices` | `sessionId` | Known MIDI devices (physical + the virtual Claude channel) with connect state |
| `session_compare` | `sessionId`, optional `settleMs`, `label` | Before/after screenshot pair |
| `session_watch` | `sessionId`, optional `durationMs`, `intervalMs` | Timelapse frames + state snapshots over time |
| `session_vibe` | `vibe` (natural language description), optional `durationMs` | Searches all 43 presets by keyword relevance, returns screenshots of top 3 matches |
| `session_close` | `sessionId` | Releases browser resources |

**Natural language tweaks supported by `session_tweak`:**
- Colors: "more blue", "more red", "more green", "warmer", "cooler"
- Brightness: "brighter", "darker"
- Motion: "more warp", "less warp", "more zoom", "faster", "slower"
- Quality: "more saturation", "more contrast", "more decay" (trails)
- Deltas resolve against the preset's compiled values; fields the preset does not define are reported as skipped rather than silently succeeding

#### Reading back what an edit actually did

A failed edit and a successful one look the same on screen. The editor session
deliberately keeps rendering the **last good compile** when new source has
errors, so the visuals keep moving either way — a screenshot cannot tell you
which happened.

Every live-editing tool therefore returns compile state, and flags the case
that matters:

```
Source applied but DID NOT compile.
preset: Cerebral Demons (krash-cerebral-demons)
compile: 1 error(s), 0 warning(s)
buffer: 10729 chars, dirty=true

⚠ NOT RENDERING YOUR SOURCE. The compile failed, so the stage is still
showing the last good compile ("Cerebral Demons"). Fix the errors below
and re-apply.

diagnostics:
  error: line 3 — Unexpected character ";" in expression. (parse_error)
```

Rules of thumb:

- Prefer `session_set_fields` over several `session_midi_set` calls. Separate
  calls can interleave inside one compile window; a grouped call is one commit.
- Call `session_editor_state` after an edit you did not make through these
  tools (a UI interaction, an AI refine) to see where the buffer stands.
- `renderingFallback` is the authoritative "my edit is not on screen" signal.
  Do not infer success from a screenshot that still looks alive.

### Live performance (Stdio-only, requires Playwright)

These turn the session from something you inspect into something you play. The
rest of the session tools make *step* changes; these add the audio half, give
gestures duration, let movement continue on its own, and let you hear the
result before deciding the next move.

| Tool | Input | Output |
|------|-------|--------|
| `session_play_pattern` | `sessionId`, `code` (Strudel), optional `cps` | Plays a live-coded pattern as the session audio and drives the visuals with it. Calling it again replaces the running pattern — that is the live-coding loop |
| `session_hush` | `sessionId` | Stops all patterns (audio only; the visualizer keeps rendering) |
| `session_ramp` | `sessionId`, `targets` (map), `durationMs`, optional `curve`, `from` | Glides targets to new values over time, as one gesture. Returns when the gesture lands, so chained calls sequence a performance |
| `session_bind` | `sessionId`, `target`, `depth`, `kind` (lfo/audio), + shape/rate/band options | Binds a target to continuous modulation — an LFO or the audio itself |
| `session_unbind` | `sessionId`, optional `id`, `target` | Removes modulators and returns the target to its resting value |
| `session_macro` | `sessionId`, `action` (define/run/list/delete), `name`, `steps`, `speed` | A named, saved sequence of the same verbs you perform by hand |
| `session_scene` | `sessionId`, `action` (save/recall/list/delete), `name`, `durationMs`, `curve` | A named snapshot of every position plus active modulators; recall ramps into it |
| `session_listen` | `sessionId`, optional `durationMs`, `intervalMs`, `includeSamples` | Measures the live signal — RMS, bass/mid/treble, coarse tempo, fps/backend |

**Modulation composes with gestures rather than fighting them.** A modulator is
an *offset*, not an override — each frame the target is set to

```
centre + Σ(depth × shaped source)
```

where `centre` is the position `session_ramp` and `session_midi_set` move. So a
ramp can raise a parameter's resting value while an LFO keeps wobbling around
it. Modulators never write back into the centre, which is what stops the
resting value drifting on its own. Several may share a target; they sum, and
`min`/`max` clamp the result.

Modulation is deliberately frame-locked: when the page is not rendering there
is nothing to modulate. A hidden or backgrounded tab suspends
`requestAnimationFrame`, so `session_bind` reports a **stalled** warning rather
than letting you believe three active modulators are doing something.

**Macros and scenes are the performer's vocabulary**, persisted to
localStorage so they outlive a reload. Macro steps are the same verbs as the
live API (`ramp`, `set`, `waitMs`, `pattern`, `hush`, `bind`, `unbind`), so
anything performed by hand can be recorded without translation. Scenes capture
every target the runtime has driven plus the modulators running at the time,
and restore the modulators *before* the ramp so the movement is already going
as the parameters arrive.

**Why these exist:**

- **Audio was unreachable.** Strudel lived only in `StrudelLabPanel` behind
  `?strudel=1`, so an agent could drive the visuals but could not play a note.
- **`session_midi_set` is a jump cut.** It posts one value and returns.
  `session_ramp` moves several targets together over bars, which is what a
  build or a drop actually is. `curve: 'sine'` (the default) eases in and out
  like a hand on a fader.
- **`audioEnergy` telemetry is a frozen snapshot.** It only updates between
  engine emissions, so polling it cannot tell silence from a stalled reading.
  `session_listen` taps an AnalyserNode on the real audio graph, and labels its
  `source` as `stream` or `telemetry` so a fallback reading is never mistaken
  for a measurement.

Both halves run through `window.__stims_live`
(`src/js/frontend/live-performance.ts`), so a human at the devtools console
drives the same runtime.

### Performing a piece:

```
start_agent_session(headless=false)
→ session_play_pattern(code='stack(s("bd*4"), s("hh*8").gain(.4))', cps=0.5)
→ session_listen                       # confirm it is audible, check the tempo
→ session_bind(target="zoom", depth=0.04, kind="audio", band="bass", attack=8)
                                       # kick punches zoom, continuously
→ session_bind(target="warp", depth=0.8, kind="lfo", cycles=0.25)
                                       # slow breath, locked to the pattern
→ session_ramp(targets={"warp": 2.4, "decay": 0.98}, durationMs=6000)   # build
→ session_scene(action="save", name="peak")
→ session_ramp(targets={"warp": 0.6}, durationMs=1200, curve="exp")     # drop
→ session_scene(action="recall", name="peak", durationMs=4000)          # back up
→ session_hush
```

`session_listen` after `session_play_pattern` is the loop that matters: it is
the only way to know the pattern is actually reaching the analyser, and its
tempo estimate independently confirms the `cps` you asked for.

### Building a vocabulary:

```
session_macro(action="define", name="drop", steps=[
  {"unbind": {"target": "warp"}},
  {"ramp": {"targets": {"warp": 0.4, "decay": 0.9}, "durationMs": 900, "curve": "exp"}},
  {"waitMs": 400},
  {"bind": {"target": "warp", "depth": 0.6, "source": {"kind": "lfo", "cycles": 1}}},
  {"ramp": {"targets": {"warp": 2.0}, "durationMs": 3000}}
])
→ session_macro(action="run", name="drop")
→ session_macro(action="run", name="drop", speed=2)   # same shape, twice as fast
```

Define once, call by name for the rest of the set. `speed` scales every
duration in the macro, so one definition covers the half-time version.

### Automation (Stdio-only)

| Tool | Input | Output |
|------|-------|--------|
| `run_quality_gate` | optional `scope`, `timeoutMs` | Structured pass/fail output |
| `capture_toy_screenshot` | `slug`, optional `duration` | Screenshot path + audio/error summary |
| `capture_preset` | `presetId`, optional `duration` | Opens visualizer with preset, returns screenshot |
| `preview_gallery` | optional `query`, `count` (1-6), `duration` | Screenshots of multiple presets in sequence |
| `test_toy_interactivity` | `slug` | Pass/fail with audio and error details |
| `get_toy_health` | `slug` | HEALTHY/UNHEALTHY status |

### Compiler inspection (Stdio-only)

A preset that renders wrongly looks the same whether the parser misread an
expression, the shader failed to lower, or the per-pixel block fell off the GPU
path. These read the intermediate stages directly, so the cause is a lookup
rather than a guess. Neither needs a browser.

| Tool | Input | Output |
|------|-------|--------|
| `inspect_eel_ast` | `source` (EEL), optional `startLine` | Parsed AST per statement, plus parser diagnostics |
| `inspect_preset_lowerer` | `presetId` or `filePath`, optional `stage` | `summary` (default): shader lowering, GPU field lowering, diagnostics. `glsl` / `wgsl`: generated shader source. `uniforms`: shader controls and custom samplers |

Note that `inspect_preset_lowerer`'s `lowered to GPU field: no` is common and is
usually the answer to "why does this preset cost more per frame than it should"
— the WebGPU field path silently falls back to the CPU transform when the
per-pixel block cannot be lowered.

## Agent Workflow Examples

### Browse and learn about presets:
```
list_presets → search_presets("ambient") → describe_preset("best-match") → open_preset_url
```

### See what a preset looks like:
```
start_agent_session(presetId="shifter-snakeskin") → session_capture_frame → session_close
```

### Vibe coding loop (describe → see → tweak → compare):
```
start_agent_session → session_vibe("dark purple storm")
→ session_get_preset_source("best-match")
→ session_tweak("more blue and increase warp")
→ session_compare
→ session_tweak("brighter")
→ session_compare
→ session_close
```

### Inspect and modify a running visualizer:
```
start_agent_session → session_get_state
→ session_get_inspector_values(filter="wave")
→ session_set_fields({ "wave_r": 0.9, "wave_g": 0.2, "wave_b": 0.6 })
→ session_describe_frame
→ session_compare
→ session_close
```

### Edit preset code and confirm it compiled:
```
start_agent_session → session_get_preset_source
→ session_apply_source(<edited .milk>)      # returns diagnostics, not a guess
→ (if errors) fix the reported lines → session_apply_source again
→ session_editor_state                      # confirm errorCount 0, no fallback
→ session_capture_frame → session_close
```
Do not move on from `session_apply_source` without reading its output. When it
reports `NOT RENDERING YOUR SOURCE`, the picture on screen is the *previous*
preset and a screenshot will look perfectly healthy.

### Perform live as a virtual MIDI device:
```
start_agent_session(headless=false) → session_midi_bindings (see what's mapped)
→ session_midi_set("warp", 1.4) → session_midi_set("zoom", 1.05)
→ session_midi_cc(1, 90) → session_capture_frame → session_close
```
`headless=false` opens a real, visible browser window — plug a physical
controller into that same window's tab to co-perform alongside Claude, since
both drive the engine through the same live-binding pipeline.

## Starting the Server

```bash
bun run mcp
```

The server connects over stdio. MCP clients should launch this command from the repo root.

## Worker Deployment (Alternative Transport)

The Cloudflare Worker at `scripts/mcp-worker.ts` serves the Worker-compatible tools (documentation + preset catalog) over HTTP/SSE and WebSocket. It does not support session tools or automation.

See `wrangler.mcp.jsonc` for configuration.
