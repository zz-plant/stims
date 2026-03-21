# MilkDrop Preset Runtime

This document covers the shared runtime used by the shipped MilkDrop visualizer.

## What this runtime owns

- Preset loading, compilation, and live field patching.
- Shared audio-driven signals.
- Shared input and gesture normalization.
- Shared device-motion signals when the active preset uses them.

Use this runtime when changing the shipped MilkDrop experience instead of re-introducing a separate visualizer stack.

## Signal contract for preset authors

Preset equations can read the existing audio/time globals plus these shared interaction signals:

- `inputX` / `input_x`, `inputY` / `input_y`
  - Normalized centroid from `-1..1`.
- `inputDx` / `input_dx`, `inputDy` / `input_dy`
  - Per-frame drag delta in normalized coordinates.
- `inputSpeed` / `input_speed`
  - Magnitude of the current drag delta.
- `inputPressed` / `input_pressed`
  - `1` while the primary interaction is pressed.
- `inputJustPressed` / `input_just_pressed`
  - `1` on the frame a press begins.
- `inputJustReleased` / `input_just_released`
  - `1` on the frame a press ends.
- `inputCount` / `input_count`
  - Active pointer count.
- `gestureScale` / `gesture_scale`
  - Pinch scale relative to the gesture anchor.
- `gestureRotation` / `gesture_rotation`
  - Rotation delta in radians relative to the gesture anchor.
- `gestureTranslateX` / `gesture_translate_x`, `gestureTranslateY` / `gesture_translate_y`
  - Gesture centroid translation relative to the anchor.
- `motionX` / `motion_x`, `motionY` / `motion_y`, `motionZ` / `motion_z`
  - Device-orientation-derived gravity vector for motion-led presets.
- `motionEnabled` / `motion_enabled`
  - `1` when motion permission is active and the toy is currently using tilt input.
- `motionStrength` / `motion_strength`
  - Magnitude of the horizontal motion vector used by the preset.

Both camelCase and snake_case aliases are exposed so preset equations can stay readable without forcing one naming style.

## Metadata sync workflow

`assets/data/toys.json` remains the checked-in manifest source for the shipped experience. `bun run generate:toys` rewrites:

- `assets/data/toys.json`
- `assets/js/data/toy-manifest.ts`
- `public/toys.json`

`bun run check:toys` fails if the checked-in JSON or generated artifacts drift.

## WebGPU descriptor rollout flags

The MilkDrop runtime can now gate each WebGPU descriptor optimization independently. All flags default to enabled, but you can disable any step with either a query param or a `localStorage` override using the same value conventions as other repo experiments (`1`/`enabled` to enable, `0`/`disabled` to disable).

| Flag | Query param | `localStorage` key | Purpose |
| --- | --- | --- | --- |
| Main wave | `milkdrop-webgpu-main-wave` | `stims:experiments:milkdrop-webgpu-main-wave` | Gates descriptor-backed main-wave rendering. |
| Trail waves | `milkdrop-webgpu-trail-waves` | `stims:experiments:milkdrop-webgpu-trail-waves` | Gates descriptor-backed trail rendering. |
| Custom waves | `milkdrop-webgpu-custom-waves` | `stims:experiments:milkdrop-webgpu-custom-waves` | Gates authored custom-wave descriptor uploads. |
| Mesh field | `milkdrop-webgpu-mesh` | `stims:experiments:milkdrop-webgpu-mesh` | Gates procedural mesh descriptors and field programs. |
| Motion vectors | `milkdrop-webgpu-motion-vectors` | `stims:experiments:milkdrop-webgpu-motion-vectors` | Gates procedural motion-vector descriptors. |
| Feedback shaders | `milkdrop-webgpu-feedback` | `stims:experiments:milkdrop-webgpu-feedback` | Gates direct WebGPU feedback shader execution. |
| WebGL fallback guard | `milkdrop-webgpu-fallback` | `stims:experiments:milkdrop-webgpu-fallback` | Controls whether unsupported descriptor cases auto-switch to WebGL. |

When any flag is disabled and the runtime still starts on WebGPU, the overlay status includes a short `WebGPU rollout flags active: ...` message so test runs and manual QA can confirm which descriptor paths remain guarded.

## Testing expectations

Use both layers:

- Fast logic coverage in unit tests for compiler/runtime helpers, rollout-flag gating, and representative descriptor fixtures.
- Browser-backed interaction coverage in `tests/agent-integration.test.ts` for the shipped visualizer flow.
- For compatibility-specific sweeps, run `bun run test -- --profile compat` so the descriptor rollout fixtures and guard tests execute with the broader corpus checks.
