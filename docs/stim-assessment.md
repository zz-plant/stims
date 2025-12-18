# Stim assessment and remediation plan

## Findings

- **Multi-Capability Visualizer (`multi`)**
  - The library manifest lists `multi` as an iframe that requires WebGPU, but the toy metadata leaves `requiresWebGPU` set to `false`, so the loader never shows the capability warning or aborts on unsupported devices.
  - Result: users on browsers without WebGPU attempt to load `multi` with no notice about degraded visuals.
- **Interactive Word Cloud (`words`)**
  - Speech input depends on `SpeechRecognition`/`webkitSpeechRecognition`; when unsupported, the UI simply disables the toggle and posts an error message while keeping the experience locked to the seed words.
  - Result: on Safari/Firefox (no speech API) the stim effectively loses its main interaction and exposes a prominent error banner instead of offering a fallback way to add words.

## Fix plan

- **Multi-Capability Visualizer (`multi`)**
  - Align toy metadata with the documented requirement by marking the toy as `requiresWebGPU` so the loader surfaces the WebGPU capability screen instead of failing silently.
  - Expand the iframe entry (`multi.html`) to present a friendlier WebGPU warning plus a tuned WebGL fallback preset (reduced particles/light bounces) for unsupported browsers.
  - Add a lightweight telemetry hook in the loader to track WebGPU support rates so we can tune defaults before forcing WebGPU-only paths.

- **Interactive Word Cloud (`words`)**
  - Replace the hard failure path for missing `SpeechRecognition` with a fallback text input drawer that lets users seed new words manually and replay previous captures.
  - Defer showing the speech toggle entirely when the API is unavailable; instead, promote the manual entry flow and ensure the audio visualizer still starts without blocking on speech features.
  - Add a recorded-audio sample or keyboard shortcut to verify the word cloud rendering loop even when microphones or speech APIs are blocked (useful for CI/browser-testing too).
