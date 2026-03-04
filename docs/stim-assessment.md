# Stim assessment and remediation plan

## Findings

- **Manifest truth has changed; docs lag remains**
  - `assets/data/toys.json` now marks `multi` and the rest of the catalog with `requiresWebGPU: true`, and the entries include `allowWebGLFallback: true`.
  - Some long-lived docs/copy still use older “WebGPU-only” language that implies hard gating where fallback is available.
  - Result: contributor and user-facing guidance can drift from runtime behavior.

## Fix plan

- **Keep docs aligned with metadata reality**
  - Treat `assets/data/toys.json` as the source of truth for capability claims.
  - Remove or rephrase copy that implies specific toys are WebGPU-only unless `allowWebGLFallback` is explicitly false.
  - Enforce this with automated checks in `bun run check:toys` so stale claims are caught in CI.

- **Follow-up product validation**
  - Add lightweight loader telemetry to track WebGPU support rates and fallback frequency.
  - Use telemetry to decide whether any toys should become truly WebGPU-only in the future.
