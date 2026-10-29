---
name: stims-agent-api
description: Drive or verify the Stims visualizer running in a browser tab — load presets, read engine state, run command-palette actions by stable id, and wait for conditions, using the URL flags and the window.__stims_agent in-page API. Use for browser automation, QA, or inspecting a playing preset's equation variables.
---

# stims-agent-api

Automate the visualizer as it runs.

## Load the app for automation

Open `https://toil.fyi/?agent=true`; the flag keeps rendering while the tab
reports itself hidden, as headless and embedded browsers often do. Other
flags: `?preset=<id>` loads a preset, `?renderer=webgpu` or
`?renderer=webgl` forces a backend.

## In-page API (`window.__stims_agent`)

- `getState()` — one JSON snapshot of engine, preset, audio, and fps state.
- `waitFor(predicate)` — resolves when the predicate passes, e.g.
  `(s) => s.engineState === 'live'`.
- `run(id, params?)` — runs a command-palette action by stable id;
  `listActions()` lists every action and the targeted verbs with their
  params.
- `getVariables()` / `waitForVariables(predicate)` — read a preset's equation
  variables (q1…, zoom…).
- `captureStats()` called twice — compare `motionEstimate` to assert the
  canvas is actually animating.
- `getState().statusLog` / `getEvents(sinceSeq)` — verify an effect after a
  transient toast has vanished.

## HTTP API

- `POST /api/validate-preset` — validate `.milk` code, diagnostic JSON.
- `POST /api/blend-presets`, `/api/refine-preset`, `/api/generate-preset`,
  `/api/visual-search` — model-backed and optional on a deployment; playback
  and editing never need them.

Contracts: https://toil.fyi/openapi.json. Headless drivers from a shell or
MCP client: https://github.com/zz-plant/stims/blob/main/docs/agents/browser-automation.md
