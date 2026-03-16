# MilkDrop Preset Runtime

This document covers the shared runtime used by MilkDrop itself and by preset-backed toy aliases such as `aurora-painter`, `pocket-pulse`, and `tactile-sand-table`.

## What this runtime owns

- Preset loading, compilation, and live field patching.
- Shared audio-driven signals.
- Shared input and gesture normalization.
- Shared device-motion signals for motion-led preset aliases.
- Shared behavior modules in `assets/js/toys/milkdrop-behaviors/`.

Use this runtime when a toy should stay inside the MilkDrop rendering/model layer instead of re-introducing a bespoke Three.js scene.

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

## Behavior modules

- Shared behavior interface: `assets/js/toys/milkdrop-preset-behavior.ts`
- Preset-toy starter: `assets/js/toys/milkdrop-preset-toy.ts`
- Gesture behavior helpers: `assets/js/toys/milkdrop-behaviors/gestural/shared.ts`
- Gesture behavior implementations: `assets/js/toys/milkdrop-behaviors/gestural/`
- Motion behavior implementation: `assets/js/toys/milkdrop-behaviors/tactile-sand-table.ts`
- Interaction metadata registry: `assets/js/toys/milkdrop-behaviors/metadata.ts`

Behavior modules are responsible for:

- Optional control-panel sections.
- Toy-specific preset field mutations.
- Any toy-specific signal overrides layered on top of the shared runtime signals.
- Metadata for controls/tags/hints when the interaction model is behavior-driven.

## Metadata sync workflow

`assets/data/toys.json` remains the checked-in manifest source, but MilkDrop preset aliases no longer hand-author their interaction metadata in that file.

For migrated preset aliases, the interaction-facing fields are derived from `assets/js/toys/milkdrop-behaviors/metadata.ts`:

- `tags`
- `controls`
- `firstRunHint`
- `wowControl`
- `recommendedCapability`
- behavior-driven `capabilities.motion`

`bun run generate:toys` now applies those overrides and rewrites:

- `assets/data/toys.json`
- `assets/js/data/toy-manifest.ts`
- `public/toys.json`

`bun run check:toys` fails if the checked-in JSON drifts from the behavior registry.

## Testing expectations

Use both layers:

- Fast logic coverage in unit tests for compiler/runtime helpers and metadata scripts.
- Browser-backed interaction coverage in `tests/agent-integration.test.ts` for drag, pinch/rotate, and device-motion parity.

When a new preset alias depends on a behavior module, add at least one integration assertion that proves:

- the relevant shared signals change,
- the preset actually reacts to those signals,
- any discrete control-cycle behavior still works.
