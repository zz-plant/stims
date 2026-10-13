# MilkDrop Preset Runtime

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

`bun run check:readme-claims` keeps the README's visible preset count aligned with `public/milkdrop-presets/catalog.json` and blocks selected shipped-feature wording that exceeds current implementation evidence.

## Catalog id contract

Every entry in `public/milkdrop-presets/catalog.json` must have a unique `id`. Ids are the key for React lists, `Object.fromEntries` lookups, the SEO route map in `scripts/generate-seo.ts`, the search index, and the `.milk` filename on disk — a repeat silently drops one of the pair instead of failing, so `bun run check:catalog-integrity` rejects duplicates outright.

`scripts/import-butterchurn-presets.ts` derives Butterchurn ids from `slugify(<source filename>)`, which collapses every non-alphanumeric run to `-`. The upstream corpus ships filenames that differ only in those characters (`_Geiss - Desert Rose 2` vs `Geiss - Desert Rose 2`, `Rovastar & Unchained - …` vs `Rovastar + Unchained - …`), so slugs collide. `assignPresetIds()` resolves this deterministically across the whole sorted file list, independent of what the catalog already contains:

- the first filename (ASCII sort) for a slug keeps the bare slug;
- a later filename whose bytes are identical is a true duplicate of the upstream corpus and is not imported at all;
- a later filename whose bytes differ is a genuinely distinct preset and gets `-alt`, then `-alt-2`, and so on.

The `-alt` suffix is therefore load-bearing, not cosmetic: `geiss-desert-rose-2` and `geiss-desert-rose-2-alt` are different presets with different warp shaders and base values. Assigning ids over the full file list — rather than only over newly seen files — is what keeps a re-import from renaming already-published ids.

## WebGPU descriptor rollout flags

Each WebGPU descriptor optimization can be switched per session with a query param or a `localStorage` key. Query params take `1`/`0` (also `true`/`false`, `on`/`off`); storage keys also take `enabled`/`disabled`. Defaults come from `DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS` in `src/js/milkdrop/webgpu-optimization-flags.ts`, and `resolveMilkdropWebGpuFeatureRouting` in `src/js/milkdrop/webgpu-query-override.ts` then turns features off for the safe WebGPU path (low-power phones) and the compatibility adapter.

| Flag | Query param (`localStorage`: `stims:experiments:` + same name) | Default | Purpose |
| --- | --- | --- | --- |
| Main wave | `milkdrop-webgpu-main-wave` | On (full path) | Descriptor-backed main-wave rendering. |
| Custom waves | `milkdrop-webgpu-custom-waves` | On (full path) | Authored custom-wave descriptor uploads. |
| Mesh field | `milkdrop-webgpu-mesh` | On (full path) | Procedural mesh descriptors and per-pixel field programs. |
| Motion vectors | `milkdrop-webgpu-motion-vectors` | On (full path) | Procedural motion-vector descriptors. |
| Feedback shaders | `milkdrop-webgpu-feedback` | On (full path) | Native TSL feedback: warp and comp shaders run directly. On the native WebGPU renderer the adapter sets this from the path decision (`shouldEnableNativeMilkdropWebGpuFeedback`), so the safe path and `?renderer=webgl` turn it off and the param alone does not. |
| WebGL fallback | `milkdrop-webgpu-fallback` | Off | When on, any preset whose plan routes to WebGL is reloaded there. When off, only presets with genuinely unsupported features fall back; feedback-compatibility presets run natively. Certification sessions (`?renderer=webgpu&corpus=certification`) force it off unless set explicitly. |
| Compute VM | `milkdrop-webgpu-compute-vm` | Off | Runs per-frame equations as WebGPU compute. Upload, dispatch and readback cost 0.9–8 ms a frame against 0.05–0.75 µs for the CPU JIT (`bun run lab:vm-tier-bench`, 2026-08-22). Never on the compatibility adapter. |
| Render bundles | `milkdrop-webgpu-render-bundles` | Off | Records static draws as WebGPU render bundles. An A/B on hardware on 2026-10-11 found no cadence effect ([Runtime performance](./RUNTIME_PERFORMANCE.md)). |
| Branch desugar | `milkdrop-webgpu-branch-desugar` | Off | Flattens `if`/`else` and bounded loops in shader bodies so 154 more bodies execute directly. Six presets still render white or black under it; they are named in `packages/milkdrop-toolchain/src/compiler/shader-branch-desugar.ts`. |

Whenever a resolved flag is off on WebGPU — which includes the four off by default — the runtime sets the engine snapshot's `status` to `WebGPU rollout flags active: ...`, listing them. The workspace toast suppresses that message, so it never shows on stage.

`src/js/milkdrop/renderer-execution-plan.ts` is the runtime decision point for applying these flags to a compiled descriptor plan. The same plan result drives backend fallback checks, the effective descriptor plan stored by the renderer core, and the WebGPU adapter feedback-manager mode. The plan also exposes `disabledFeatures`, `statusLabels`, and structured fallback reasons such as `descriptor-feedback` so overlays, tests, and telemetry can report the same decision.

The feedback mode is `webgpu-native` on the full WebGPU path, `none` on the safe path, and `webgl-shared` on WebGL. Native feedback has been on by default since 2026-08-06 (`789c1e9a`).

## JIT performance contract

`packages/milkdrop-toolchain/src/expression-jit.ts` compiles EEL2 blocks as whole JavaScript
functions. Per-point and per-pixel callers may deliberately use the same object
for the engine environment and local scope. In that aliased case, an ordinary
local assignment must write the property once; mirroring it through both
references repeats the same hot-loop work. `q` registers and `megabuf` /
`gmegabuf` targets retain their explicit environment/store behavior.

The runtime performance harness compares changes at a fixed adaptive-quality
step. The configured benchmark lock and the live-performance hold are separate:
releasing a temporary live hold must not resume adaptation when
`?lockQualityStep=` is present. See
[`RUNTIME_PERFORMANCE.md`](./RUNTIME_PERFORMANCE.md) for the measured result,
comparison contract, and reproduction command.

## Shader execution classification

Direct shader payloads keep a separate execution classification in `packages/milkdrop-toolchain/src/compiler/shader-execution-classification.ts`. Runtime consumers should use this helper instead of checking `supportedBackends`, `rawGlsl`, and `requiresControlFallback` directly. The current categories are:

- `backend-executable`
- `backend-executable-with-control-fallback`
- `control-fallback-required`

## Testing expectations

Use both layers:

- Fast logic coverage in unit tests for compiler/runtime helpers, rollout-flag gating, and representative descriptor fixtures.
- Browser-backed interaction coverage in `tests/e2e/agent-integration.test.ts` for the shipped visualizer flow.
- JIT/interpreter differential coverage plus the aliased-scope write-count
  regression in `tests/unit/milkdrop-program-jit.test.ts`.
- For compatibility-specific sweeps, run `bun run test -- --profile compat` so the descriptor rollout fixtures and guard tests execute with the broader corpus checks.
