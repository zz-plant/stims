---
name: stims-embed
description: Embed the Stims MilkDrop visualizer in another page and drive it over postMessage. Use when a page needs to play a specific preset, restyle what is playing, set demo or microphone audio, or receive playback telemetry from an embedded toil.fyi iframe.
---

# stims-embed

Embed the visualizer in an iframe and control it from the parent page.

## Embed

Load `https://toil.fyi/?embed=true` in an iframe; add `&preset=<id>` to choose
the first preset (for example `?embed=true&preset=shifter-snakeskin`). Other
toil.fyi URLs send `X-Frame-Options: SAMEORIGIN` and will not load in a frame.

## Commands

Post JSON messages to the iframe's `contentWindow`. Add `requestId` (string or
number) to any command and its reply echoes it; replies go to the window that
sent the command.

- `{ "type": "toil:load_preset", "presetId": "shifter-snakeskin" }` — or
  `milkSource: "<.milk code>"` in place of `presetId`. An unknown id is
  refused with close matches in `suggestions`.
- `{ "type": "toil:apply_tweak", "tweak": "faster motion" }` — refines the
  playing preset through the refine API; when AI is unavailable, a tweak
  naming a color or motion word applies the matching one-click restyle.
- `{ "type": "toil:set_audio", "source": "demo" }` — `"demo"` or
  `"microphone"` (which needs `allow="microphone"` on the iframe). File
  playback and tab capture need a click inside the page and are refused.
- `{ "type": "toil:run", "id": "next-preset" }` — reviewed visual actions and
  agent verbs (`select-preset`, `set-field`, `crossfade`, …), with optional
  `params`.
- `{ "type": "toil:apply_source", "source": "<.milk code>" }` and
  `{ "type": "toil:set_fields", "fields": { "zoom": 1.1 } }` — edit the
  playing preset; the reply carries the compile `state`.

## Replies

- `toil:status` answers each command once the change has landed; a
  `success: false` reply always carries a `reason`.
- `toil:telemetry` reports `fps`, `backend`, `audioEnergy`, and
  `currentPresetId`.

Only the direct parent of an explicit embed may send commands; device,
clipboard, and sharing actions are refused. Full message contracts:
https://toil.fyi/llms-full.txt
