# Rasterization Fidelity Audit — Wave, Shape, Border Renderers

Analysis date: 2026-05-16. Sprint 5 diagnostic prep. Covers WebGL vs WebGPU output divergence across the core visual elements.

---

## 1. Current Render Pipeline Diagram

The pipeline order is identical for both backends. `ThreeMilkdropAdapter.render()` (`renderer-adapter-core.ts:874–1169`) sequences:

```
[0]  background          → renderOrder 0
[10] mesh                → renderOrder 10
[20] main-wave           → renderOrder 20   (+1 if additive)
[30] custom-wave         → renderOrder 30   (+1 if additive)
[40] trails              → renderOrder 40   (+1 if additive)
[45] particle-field      → renderOrder 45
[50] shapes              → renderOrder 50   (+1 if additive)
[60] borders             → renderOrder 60
[70] motion-vectors      → renderOrder 70   (+1 if additive)
 ── blend pass ──
[80]  blend-main-wave    → renderOrder 80   (+1 if additive)
[90]  blend-custom-wave  → renderOrder 90   (+1 if additive)
[95]  blend-particle     → renderOrder 95
[100] blend-shapes       → renderOrder 100  (+1 if additive)
[110] blend-borders      → renderOrder 110
[120] blend-motion-vecs  → renderOrder 120  (+1 if additive)
 ── post ──
feedback composite (echo/warp/comp shaders)
```

**Key file:line references:**

| Role | Location |
|---|---|
| Layer render order table | `renderer-adapter-shared.ts:491–541` (`getMilkdropLayerRenderOrder`) |
| Additive +1 offset | `renderer-adapter-shared.ts:543–561` (`getMilkdropPassRenderOrder`) |
| Scene group construction | `renderer-adapter-core.ts:183–396` (constructor creates all 15+ groups) |
| Render dispatch (unified) | `renderer-adapter-core.ts:874–1169` (`render()`) |
| Batch target render order | `renderer-adapter-webgpu-batching.ts:442–472` (`getBatchedTargetRenderOrder`) |
| WebGPU batching layer | `renderer-adapter-webgpu-batching.ts:1515–1743` (`WebGPUBatchingLayer`) |
| WebGL adapter entry | `renderer-adapter-webgl.ts:12–25` (uses `MilkdropSegmentBatchingLayer`) |
| WebGPU adapter entry | `renderer-adapter-webgpu.ts` (mirrors webgl, uses `WebGPUBatchingLayer`) |
| Backend capability flags | `backend-behavior.ts:1–57` |

**Architecture note:** Both backends attach to the _same_ `root` group. When the batcher is active (WebGPU always, WebGL via `MilkdropSegmentBatchingLayer`), it creates separate instanced-batch meshes under its own sub-group appended to `root`. The fallback groups (e.g., `this.shapesGroup`) are cleared on each frame when the batcher handles the draw (`renderer-adapter-core.ts:608–610`).

---

## 2. Known Divergence Points

### D1: Line thickness — multi-pass offset vs shader segment quads

| | WebGL (fallback + batched) | WebGPU (batched) |
|---|---|---|
| **Mechanism** | 4 offset passes of `LineBasicMaterial` (linewidth=1) | Instanced segment quad with pixel-width fragment anti-aliasing |
| **File:line** | `wave-renderer.ts:21,27–37,62–105` (`THICK_WAVE_PASS_OFFSET = 1/1024`) | `renderer-adapter-webgpu-batching.ts:252–265` (segment quad geometry), lines 862–897 (segment shader), lines 624–637 (`appendPolyline`) |
| **Width computation** | Fixed to 1px regardless of `wave.thickness` | `0.0025 * thickness * 0.5` per-segment (`halfWidth` in vertex shader) |
| **Edge smoothing** | None — aliased 1px line | `smoothstep(0.88, 1.0, edgeDistance)` in fragment shader (line 922) |
| **Dots** | `PointsMaterial` with `size=pointSize` (4 passes) | Falls back to non-batched path; batcher returns `false` for dots (line 1596–1598) |

**Result:** WebGPU lines appear significantly thicker (2–5px at default thickness) with smooth edges. WebGL lines are always 1px, only appearing "thick" through 4-offset-pass layering. On presets with `wave_thick > 1`, the thickness differential is 2–10×.

**Worst-affected presets:** Any with `wave_thick > 1` or `wavecode_*_thick > 1` (e.g., `geiss - cosmic echo 3`, `martin - bathroom window`, `stahlregen - feedback`).

---

### D2: Shape thick outline rendering

| | WebGL (fallback) | WebGPU (batched) |
|---|---|---|
| **Mechanism** | 4 offset `LineBasicMaterial` passes on unit polygon outline | Single instanced ring mesh with non-uniform `outerScale`/`innerScale` |
| **File:line** | `shape-renderer.ts:30,57–68,225–268` (offsets via `THICK_SHAPE_PASS_OFFSET = 1/1024`) | `renderer-adapter-webgpu-batching.ts:68–69,320–331` (`SHAPE_THICK_OUTLINE_OUTER_OFFSET = 0.009`, `SHAPE_OUTLINE_INNER_OFFSET = -0.007`) |
| **Line closure** | `LineLoop` on WebGL (`useLineLoopPrimitives: true`); manually closed `Line` on WebGPU (`backend-behavior.ts:45`) | Ring geometry wraps polygon vertices into unitCorner/innerWeight attributes |
| **Width** | Always 1px (Three.js `gl.lineWidth` limit) | `outerScale = (radius + 0.009) / radius`, `innerScale = (radius - 0.007) / radius` — width varies with radius |
| **Edge smoothing** | None | No edge smoothing (solid color fragment shader, line 1326–1330) |

**Result:** WebGPU outlines are wider and radius-dependent. At small radii (≤0.1), the 0.009 outer offset is proportionally large, making small shapes appear bolder on WebGPU. WebGL small shapes have nearly invisible 1px outlines.

**Worst-affected presets:** `stahlregen - feedback`, any preset with `shapecode_*_thickoutline=1` and small `shapecode_*_rad`.

---

### D3: Line loop vs manually-closed lines

| | WebGL | WebGPU |
|---|---|---|
| **Behavior** | `useLineLoopPrimitives: true` — Three.js `LineLoop` primitive | `useLineLoopPrimitives: false` — `Line` primitive with manually duplicated first vertex |
| **Source** | `backend-behavior.ts:29` | `backend-behavior.ts:44–45` |
| **Closure** | GPU-native line loop (single draw call) | `closeLinePositions()` in `renderer-adapter-shared.ts:331–347` appends first vertex |
| **Effect on waves** | `getWaveLinePositions` returns `closeLinePositions(wave.positions)` when `closeLinesManually` (line 352–356) | Same function — WebGPU requests manual closure, WebGL does not |
| **Effect on shape outlines** | `LineLoop` via `getUnitPolygonOutlineGeometry` | `Line` via `getUnitPolygonClosedLineGeometry` |

**Result:** visual output should be identical (closing a polygon is a mathematical operation), but GPU-native `LineLoop` produces a continuous join at the closure vertex while manual closure creates a separate line segment there. The 1px difference at the closure seam is visible on bright outlines.

---

### D4: Border rendering — indexed band mesh vs corner-ring

| | WebGL (fallback) | WebGPU (batched) |
|---|---|---|
| **Mechanism** | Single `MeshBasicMaterial` on indexed `BufferGeometry` (8 vertices, 24 indices forming a band) | Instanced `InstancedBorderBatch` with corner-ring geometry (unitCorner + innerWeight attributes), fill + outline meshes |
| **File:line** | `border-renderer.ts:17–24,32–84,112–137` | `renderer-adapter-webgpu-batching.ts:268–312,989–1107` |
| **Alpha** | `border.alpha * alphaMultiplier` | Fill: `border.alpha * 0.45 * alphaMultiplier` (line 1048); Outline: `border.alpha * alphaMultiplier` (line 1058) |
| **z-depth** | `0.3` (fill only, no outline) | Fill: `0.285`, Outline: `0.3` |
| **Layers** | Single fill mesh per border group | Two meshes: fill (0.285) + outline accent (0.3) |

**Result:** WebGPU borders always have a fill + outline pair, with the outline at the outer edge (`outerInset = inset - 0.0035`, `innerInset = inset + 0.0035`). WebGL borders are a single flat-colored band. The multi-layer approach makes WebGPU borders appear crisper with an edge accent, while WebGL borders look flatter.

**Worst-affected presets:** Any with `ob_border=1` (styled border), `ob_size > 0`, `ib_size > 0`.

---

### D5: Shape textured fallback on WebGPU

| Condition | WebGL | WebGPU (batched) |
|---|---|---|
| `shape.textured = true`, no shape texture available | Falls through to batch; fills use `ShaderMaterial` with `shapeTexture` = null (renders gradient/tinted fill) | Batcher declines: returns `false` from `renderShapeGroup` (line 1666–1669); falls back to non-batched `MeshBasicMaterial` |
| `shape.textured = true`, texture available | `ShaderMaterial` with `shapeTexture` bound | Batcher uses `InstancedShapeFillBatch` with `shapeTexture` uniform |

**File:line:** `renderer-adapter-webgpu-batching.ts:1660–1671` (shape-group decision)

**Result:** When no feedback texture exists (first render, or `fShader=0`), WebGPU textured shapes render as flat `MeshBasicMaterial` (the `getShapeFillFallbackColor` average), losing gradient fill. WebGL preserves the `ShaderMaterial` path.

---

### D6: z-depth values differ between backends

| Element | WebGL (non-batched) | WebGPU (batched) |
|---|---|---|
| Wave z | `0.24` (fixed per-object, all layers) | Per-segment from positions array (`positions[2]`, `positions[5]`) — line 595–597 |
| Shape fill z | `0.14` | `0.14` (hardcoded in vertex shader, line 762) |
| Shape outline z | `0.16` | `0.16` (`layerZ` uniform, line 751) |
| Border z | `0.3` (fill only) | Fill `0.285`, outline `0.3` |
| Procedural wave z | N/A (WebGL doesn't use proc waves) | `0.24` (`appendProceduralWave`, line 650) |
| Procedural custom wave z | N/A | `0.28` (`appendProceduralCustomWave`, line 671) |

**Key divergence:** WebGPU waves have per-vertex z from the wave position array (set by VM, typically 0.24–0.28 for custom waves), allowing per-point depth variation. WebGL uses fixed `0.24` for all wave vertices. This means depth-ordered wave segments can emerge differently across backends when z varies per sample point.

---

### D7: Feedback target precision

| | WebGL | WebGPU |
|---|---|---|
| **Float type** | Full float (default render target) | `HalfFloatType` (`useHalfFloatFeedback: true`, `backend-behavior.ts:43`) |
| **File:line** | `backend-behavior.ts:27` | `backend-behavior.ts:43` |
| **Effect** | Higher precision blending but more GPU memory | Half precision; slight banding potential in dark presets with long feedback trails |

This is not a divergence bug but a deliberate tradeoff. Both backends use `sceneResolutionScale: 1`, `feedbackResolutionScale: 1`, `samples: 0`.

---

## 3. Blend Order Audit

### Draw-call blend modes

All primitives use one of two Three.js blend modes:

| Blend mode | Three.js constant | Used by |
|---|---|---|
| Alpha (normal) | `NormalBlending` | All non-additive waves, shapes, borders, lines |
| Additive | `AdditiveBlending` | `wave.additive=true`, `shape.additive=true` |

**Mapping to projectM baseline:**

projectM supports combining shape draw calls with additive blending when `shapecode_N_additive=1` or `wave_N_additive=1`. Our rendering matches: `getMilkdropPassRenderOrder` gives additive items +1 renderOrder so they draw _after_ normal-blended items within the same layer group.

**Missing blend modes:**

- **Subtractive blending** (`blendMode=2` in projectM): Not implemented. No equivalent in the renderer helpers or batcher.
- **Multiplicative blending**: Not implemented as a draw-call blend mode, though it exists as a _texture_ blend mode in the feedback composite (`getShaderTextureBlendModeId` returns `4` for `'multiply'` — `renderer-adapter-shared.ts:158–159`).
- **`Replace` blend mode**: Not a GPU blend mode in the scene; handled as texture blend mode in feedback composite (id `1`).

**Blend ordering within layer groups:**

```
Normal (renderOrder N) → Additive (renderOrder N+1)
```

This matches projectM's behavior where additive shapes/waves composite on top of normal ones.

**Verdict:** Draw-call blend modes are in parity and match projectM for Normal and Additive. Multiplicative and subtractive are missing and would cause fidelity gaps for presets that use them. However, these are rare/zero in the certification corpus based on the search — no `shapecode_*_blendmode=2` or similar were found.

### Texture/feedback blend modes

Handled in `getShaderTextureBlendModeId` (`renderer-adapter-shared.ts:150–163`):

| projectM mode | ID | Used in |
|---|---|---|
| `replace` | 1 | Texture layer default |
| `mix` | 2 | `tex_blend_mode=1` in shader controls |
| `add` | 3 | `tex_blend_mode=2` |
| `multiply` | 4 | `tex_blend_mode=3` |

These are applied in the _feedback composite_ passthrough, not in rasterization. They're in parity across backends.

---

## 4. Object-Count-Only Acceptance

Tests that verify correctness solely via object/existence counts without visual comparison:

### High-severity: rendering correctness tested only by instance count

| Test (file:line) | What it asserts | Missing |
|---|---|---|
| `milkdrop-renderer-adapter.test.ts:296–305` ("uses WebGPU-safe shape fills") | `batchedShapes.length=2`, `instanceCount > 0`, attribute values match | No check that shapes _look_ correct (gradient direction, radius, alignment) |
| `milkdrop-renderer-adapter.test.ts:644–645` ("reuses cached polygon geometries") | `populatedFillMeshes.length > 0`, `populatedOutlineMeshes.length > 0` | No check that both shapes render at correct positions/sizes |
| `milkdrop-renderer-adapter.test.ts:2120–2123` ("renders waveform-driven main wave") | `populatedSegmentMeshes.length > 0`, `instanceCount > 0` | No verification of wave shape or waveform data fidelity |
| `milkdrop-renderer-adapter.test.ts:2114–2123` ("closes manually closed batched main waves") | `segmentCounts.contains(expectedSegmentCount)` | Only checks segment count matches position count; doesn't verify closure visually correct |
| `milkdrop-renderer-adapter.test.ts:2432` ("renders custom waves directly") | `renderedWaveChildren.length > 0` | No check that GPGPU-computed positions match expected waveform |
| `milkdrop-renderer-adapter.test.ts:358` ("uses non-shader render materials") | `basicShapeFills.length > 0` | No check that fallback colors are remotely correct |

### Medium-severity: visual property assumed from metadata

| Test (file:line) | What it asserts | Missing |
|---|---|---|
| `milkdrop-renderer-adapter.test.ts:277–304` ("shape fidelity") | Attribute array values (`instancePrimaryColorAlpha`, `instanceSecondaryColorAlpha`) | No check of rendered color output (e.g., gradient ramp shape), only that attribute buffers contain expected numbers |
| `milkdrop-wave-renderer.test.ts:78–84` ("renders thick line waves") | `group != null`, `children.length=4`, `depthWrite=false` | No check that 4-pass offset actually creates correct visual thickness |
| `milkdrop-wave-renderer.test.ts:128–133` ("keeps existing thick wave groups stable") | `synced === existing`, opacity matches | No check that thickness change (2→4) affected visual output |
| `milkdrop-border-renderer.test.ts:79–81` ("builds a single indexed band mesh") | Index array matches expected indices | No check that inner/outer radius visually produces the expected border |

### Mitigation

All of the above tests would benefit from pixel-level comparison or at minimum a golden-image snapshot stored in the visual reference manifest. Until visual comparison exists, these tests can pass while producing visually wrong output. The certification corpus (`tests/certification-corpus.test.ts`) has tolerance profiles but the individual renderer tests do not hook into them.

---

## 5. Priority Ranking

### Fix 1: Line thickness parity (highest visual impact)

**Problem:** WebGL renders all lines at 1px regardless of `wave.thickness`. WebGPU uses shader-based segment quads with `0.0025 * thickness * 0.5` pixel width. On presets with `wave_thick=5`, WebGL shows hairline waves while WebGPU shows thick ribbons.

**Files:** `wave-renderer.ts:21,37,89,165`, `renderer-adapter-webgpu-batching.ts:520–637,718–742`

**Proposed approach:** For the WebGL fallback path, extend the `LineBasicMaterial` approach to use the instanced segment-quad mechanism (same as WebGPU batching layer but adapted for `WebGLRenderer`). The `MilkdropSegmentBatchingLayer` already does this for WebGL fallback — verify its thickness multiplier matches WebGPU's `0.0025`.

**Corpus presets worst-affected:**
- `martin - bathroom window` (wave_thick=8)
- `geiss - cosmic echo 3` (wave_thick=5)
- `stahlregen - feedback` (wave_thick=4)
- Any preset with `wave_mode > 0` and non-default thickness

---

### Fix 2: Shape thick-outline parity (second highest)

**Problem:** WebGPU outlines use ring geometry with scale-dependent outer/inner offsets; WebGL uses 4× 1px `LineLoop`/`Line` passes. At small radii (≤0.1), the ratio difference makes WebGPU outlines proportionally 3–5× wider.

**Files:** `shape-renderer.ts:30,57–68,225–268`, `renderer-adapter-webgpu-batching.ts:68–69,320–331,1280–1385`

**Proposed approach:** For the WebGL non-batched path, add a ring-geometry mesh analogous to `InstancedShapeRingBatch` but built in the shape-renderer fallback path. Alternatively, scale the multi-pass offset to match the batch layer's outer/inner scale computation.

**Corpus presets worst-affected:**
- `stahlregen - feedback` (`shapecode_0_thickoutline=1`, small radius)
- Any preset with `shapecode_*_thickoutline=1` combined with `shapecode_*_rad < 0.15`

---

### Fix 3: Textured shape fallback fill on WebGPU (third)

**Problem:** When no shape texture is available (first render, no feedback), WebGPU textured shapes fall back to `MeshBasicMaterial` with the average of primary+secondary color — losing the gradient fill that appears on WebGL with `ShaderMaterial`.

**Files:** `renderer-adapter-webgpu-batching.ts:1660–1671`, `shape-renderer.ts:204–223`

**Proposed approach:** In the batcher's `renderShapeGroup`, when `shapeTexture === null` but shapes have `textured = true`, use the `ShaderMaterial` path without the texture uniform rather than falling back to `MeshBasicMaterial`. The shader already handles `textured < 0.5` correctly (renders gradient fill only).

**Corpus presets worst-affected:**
- `geiss - cosmic echo 1` (textured shapes in first few frames)
- Any preset with `shapecode_*_textured=1` during startup fade-in

---

## Summary Counts

| Metric | Count |
|---|---|
| **Divergence points found** | 7 |
| **Object-count-only tests** | 10 |
| **Missing blend modes** | 2 (subtractive, multiplicative as draw-call modes) |
| **Top 3 fixes by visual impact** | Line thickness, shape thick-outline, textured fallback |
| **Worst-affected corpus presets** | `martin - bathroom window`, `stahlregen - feedback`, `geiss - cosmic echo 3`, `geiss - cosmic echo 1` |
