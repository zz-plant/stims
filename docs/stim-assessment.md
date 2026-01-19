# Stim assessment and remediation plan

## Findings

- **Multi-Capability Visualizer (`multi`)**
  - The library manifest lists `multi` as a standalone page that requires WebGPU, but the toy metadata leaves `requiresWebGPU` set to `false`, so the loader never shows the capability warning or aborts on unsupported devices.
  - Result: users on browsers without WebGPU attempt to load `multi` with no notice about degraded visuals.

## Fix plan

- **Multi-Capability Visualizer (`multi`)**
  - Align toy metadata with the documented requirement by marking the toy as `requiresWebGPU` so the loader surfaces the WebGPU capability screen instead of failing silently.
  - Expand the standalone page entry (`multi.html`) to present a friendlier WebGPU warning plus a tuned WebGL fallback preset (reduced particles/light bounces) for unsupported browsers.
  - Add a lightweight telemetry hook in the loader to track WebGPU support rates so we can tune defaults before forcing WebGPU-only paths.
