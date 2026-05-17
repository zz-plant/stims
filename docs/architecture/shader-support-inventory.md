# Shader Support Inventory — MilkDrop Compiler

Analysis date: 2026-05-16. Based on full audit of `assets/js/milkdrop/compiler/**`, `assets/js/milkdrop/shader-ast.ts`, `assets/js/milkdrop/shader-samplers.ts`, and the test suite (`tests/milkdrop-compiler*.test.ts`).

## Scope

This inventory covers every `shader_body`, `ret`, or `warp_shader`/`comp_shader` construct that enters the compiler through `extractShaderControls` (`shader-analysis.ts:1084`). Each line is processed through two paths:

1. **AST path** (`applyShaderAstStatement`, line 68) — Full parsed AST with expression evaluation, sampler info extraction, and control extraction.
2. **Heuristic path** (`applyShaderProgramHeuristicLine`, line 714) — Regex-based fallback for lines that parse as `key=value` but don't produce a valid MilkdropShaderStatement.

The critical routing logic is at `shader-analysis.ts:1128-1207`: AST hit → heuristic fallback → `isUnsupportedParsedShaderStatement` → direct-program context retention.

---

## 1. Supported Patterns

Every construct below compiles AND generates correct GPU output on both WebGL and WebGPU backends (via GLSL emitter `shader-analysis-glsl.ts:23-61` and WGSL generator `wgsl-generator.ts:21-184`).

### Scalar Control Assignments

| Pattern | Support location |
|---|---|
| `dx=`, `dy=`, `rot=`, `zoom=` | `shader-control-application.ts:153-218` |
| `saturation=`, `contrast=` | `shader-control-application.ts:219-249` |
| `r=`, `g=`, `b=`, `red=`, `green=`, `blue=` | `shader-control-application.ts:250-297` |
| `hue=`, `hue_shift=` | `shader-control-application.ts:298-313` |
| `mix=`, `feedback=`, `feedback_alpha=` | `shader-control-application.ts:314-330` |
| `brighten=`, `invert=`, `solarize=` | `shader-control-application.ts:331-375` |
| `warp=`, `warp_scale=` | `shader-control-application.ts:137-152` |
| `texture_amount=`, `texture_mix=` | `shader-control-application.ts:376-390` |
| `texture_scale=`, `texture_scale_x=`, `texture_scale_y=` | `shader-control-application.ts:391-426` |
| `texture_offset_x=`, `texture_offset_y=` | `shader-control-application.ts:427-456` |
| `warp_texture_amount=`, `warp_texture_scale=`, etc. | `shader-control-application.ts:457-537` |

Expressions are evaluated at runtime via `evaluateMilkdropShaderControlExpressions` (`shader-analysis-evaluation.ts:13-113`).

### Vector and Compound Assignments

| Pattern | Support location |
|---|---|
| `uv += vec2(x, y)`, `uv -= vec2(x, y)` | `shader-analysis.ts:177-207` |
| `uv = uv + vec2(x, y)`, `uv = uv - vec2(x, y)` | `shader-analysis.ts:210-253` |
| `uv = (uv-0.5)/scale + 0.5 + vec2(ox, oy)` (affine transform) | `shader-analysis.ts:820-871` (heuristic) |
| `tint = r, g, b` / `tint += r, g, b` | `shader-analysis.ts:256-295` |
| `texture_offset = vec2(x, y)` / `texture_scroll = ...` | `shader-analysis.ts:297-319` and `shader-control-application.ts:685-711` |
| `texture_scale = vec2(x, y)` | `shader-analysis.ts:322-345` and `shader-control-application.ts:713-739` |
| `warp_texture_offset = vec2(...)` / `warp_texture_scale = vec2(...)` | `shader-analysis.ts:347-395` and `shader-control-application.ts:741-795` |

### Sampler Source / Mode Selection

| Pattern | Support location |
|---|---|
| `texture_source = sampler_<name>` | `shader-analysis.ts:138-151` |
| `warp_texture_source = sampler_<name>` | `shader-analysis.ts:165-175` |
| `texture_mode = <mode>` | `shader-analysis.ts:153-163` |

Recognized texture sources: `noise`, `perlin`, `simplex`, `voronoi`, `aura`, `caustics`, `pattern`, `fractal`, `video` (`shader-samplers.ts:3-17`). All FW aliases (`fw_noise_lq` → `noise`, `fw_noisevol_lq` → `simplex`, etc.) normalise correctly (`shader-samplers.ts:32-46`).

### ret / shader_body Patterns (AST Path)

| Pattern | Support location |
|---|---|
| `ret = tex2d(sampler_main, uv).rgb` (identity) | `shader-analysis.ts:398-401` |
| `ret = tex2d(sampler_main, uv).rgb * scalar` (uniform color scale) | `shader-analysis.ts:418-492` |
| `ret = tex2d(sampler_main, uv).rgb * vec3(r,g,b)` (per-channel scale) | `shader-analysis.ts:418-492` |
| `ret = tex2d(sampler_<aux>, uv).rgb` (replace with aux sample) | `shader-analysis.ts:403-416` |
| `ret = tex3d(sampler_<aux>, vec3(uv, z)).xyz` (3D aux sample) | `shader-analysis.ts:403-416` |
| `ret = mix(tex2d(sampler_main, uv).rgb, tex2d(sampler_<aux>, uv).rgb, amount)` | `shader-analysis.ts:495-528` |
| `ret = mix(main, 1.0 - tex2d(sampler_<aux>, uv).rgb, amount)` (inverted aux) | `shader-analysis.ts:530-556` |
| `ret = mix(main, abs(tex2d(sampler_main, uv).rgb - 0.5) * 1.5, amount)` (solarize) | `shader-analysis.ts:557-569` |
| `ret = mix(main, vec3(r,g,b), amount)` (tint blend) | `shader-analysis.ts:570-622` |
| `ret = tex2d(sampler_main, uv).rgb + tex2d(sampler_<aux>, uv).rgb * amount` (add mode) | `shader-analysis.ts:626-646` |
| `ret = tex2d(sampler_main, uv).rgb * (tex2d(sampler_<aux>, uv).rgb * amount)` (multiply mode) | `shader-analysis.ts:648-668` |
| `shader_body = tex2d(sampler_main, uv).rgb` (identity passthrough) | `shader-analysis.ts:748-750` (heuristic) + line 397-401 (AST via `shader_body` → `ret` equivalence) |

### Heuristic ret / shader_body Patterns (regex fallback)

| Pattern | Support location |
|---|---|
| `ret = tex2d(sampler_main, uv).rgb * scalar` | `shader-analysis.ts:881-903` |
| `ret = tex2d(sampler_main, uv).rgb * vec3(r,g,b)` | `shader-analysis.ts:918-964` |
| `ret = pow(tex2d(sampler_main, uv).rgb, vec3(gamma))` | `shader-analysis.ts:905-916` |
| `ret = mix(tex2d(sampler_main, uv).rgb, 1.0 - tex2d(...), amount)` | `shader-analysis.ts:966-987` |
| `ret = mix(tex2d(sampler_main, uv).rgb, abs(tex2d(...)-0.5)*1.5, amount)` | `shader-analysis.ts:989-1005` |
| `ret = mix(tex2d(sampler_main, uv).rgb, vec3(r,g,b), amount)` | `shader-analysis.ts:1007-1044` |
| `ret = 1.0 - tex2d(sampler_main, uv).rgb` (full invert) | `shader-analysis.ts:1047-1062` |
| `ret = abs(tex2d(sampler_main, uv).rgb - 0.5) * 1.5` (full solarize) | `shader-analysis.ts:1063-1079` |

### Temp Variables and Declarations

| Pattern | Support location |
|---|---|
| `float x = <expression>` / `const x = <expression>` | `shader-analysis.ts:118-136` (declaration), `shader-ast.ts:434-462` (parse) |
| `vec2 v = vec2(x, y)` / `vec3 v = vec3(x, y, z)` | `shader-analysis.ts:118-136` (non-reserved targets stored in shaderValueEnv) |
| `float2` / `float3` aliases | Normalized to `vec2`/`vec3` in `shader-expression-shared.ts:37-38` |
| `x = <expr>` (bare assignment to unknown identifier — runtime temp) | `shader-analysis.ts:1207-1265` (fallback parser path) |
| `return <expr>` (comp shader return) | `shader-ast.ts:414-432` (parsed as `target: 'return'`) |

### Math Functions

All listed in `shader-analysis-glsl.ts:149-315` and `wgsl-generator.ts:97-181`.

Supported: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `abs`, `sqrt`, `pow`, `mod`, `fmod`, `min`, `max`, `mix`, `lerp`, `floor`, `ceil`, `fract`/`frac`, `clamp`, `step`, `smoothstep`, `length`, `dot`, `cross`, `normalize`, `sign`, `log`, `exp`, `sigmoid`, `if`, `above`, `below`, `equal`, `rand`, `sqr`, `int`.

### Audio Signal Identifiers

Mapped by `shader-analysis-glsl.ts:70-125` (GLSL) and `wgsl-generator.ts:186-213` (WGSL signal struct).

Signals: `time`, `bass`, `mid`, `mids`, `treb`, `treble`, `bass_att`, `mid_att`, `mids_att`, `treb_att`, `beat`, `beat_pulse`, `rms`, `vol`, `music`, `weighted_energy`, `progress`, `frame`, `fps`.

### Vector Constructors

`vec2(a,b)`, `vec3(a,b,c)`, `vec4(a,b,c,d)`, `vec3(vec2(xy), z)`, `vec3(z, vec2(xy))` — all supported in both GLSL emitter and WGSL generator. Also: `float(x)` constructor.

### Logical Operators

`&&` (AND) → GLSL: `*`, WGSL: `select(..., ... && ...)`.  
`||` (OR) → GLSL: `a+b-ab` (saturating), WGSL: `select(..., ... || ...)`.  
`!` (NOT) → GLSL: `1.0 - value`, WGSL: `select(1.0f, 0.0f, abs(v) > epsilon)`.

### Swizzles / Member Access

`.x`, `.y`, `.z`, `.r`, `.g`, `.b`, `.rgb`, `.rg`, `.xy`, `.xyz` and all valid GLSL swizzle combinations — correctly passed through in both emitters.

### Sampler Aliases

All sample calls normalized:
- `tex2D` / `texture` / `texture2D` → `tex2d` (`shader-expression-shared.ts:41-45`)
- `tex3D` / `texture3D` / `texture3d` → `tex3d` (`shader-expression-shared.ts:46-50`)
- `sampler_fw_noise_lq` → `noise`, `sampler_fw_noisevol_lq` → `simplex` (`shader-samplers.ts:32-46`)
- `videotex2d(x, y)` → aux video sample (`shader-analysis-glsl.ts:159-165`)

### Feed-Forward Noise (GLSL specific)

`tex2d(sampler_fw_noise_lq, uv)` and `tex2d(sampler_fw_noise_hq, uv)` generate procedural GLSL noise instead of reading a static texture (`shader-analysis-glsl.ts:371-379`). This is a deliberate divergence that produces animated noise in GLSL.

---

## 2. Unsupported / Partial Patterns

Below are constructs that parse successfully (produce a `MilkdropShaderStatement`) but do NOT generate correct GPU output, cause incorrect control extraction, or are silently downgraded.

### 2.1 `^` operator — XOR in GLSL, pow in WGSL

**What it should do**: MilkDrop uses `^` for exponentiation (pow). WGSL generator emits `pow(left, right)` at `wgsl-generator.ts:68` (correct).  
**What actually happens**: The GLSL emitter only handles `&&` and `||` specially; `^` passes through as bitwise XOR (`shader-analysis-glsl.ts:137`). In GLSL, bitwise XOR on floats produces a compile error or undefined behavior.  
**Corpus presets affected**: None in certification corpus, but common in user-authored presets that use `^` for power.  
**Estimated fix effort**: Low — add `^` → `pow()` mapping in the GLSL `emitBinary` and `emitCall` dispatches.

### 2.2 `|` and `&` operators — bitwise OR/AND in GLSL

**What it should do**: MilkDrop uses `|` and `&` as float-safe bitwise operations (truncate to int, apply bitwise, cast back). WGSL generator emits `f32(i32(left) | i32(right))` at `wgsl-generator.ts:69-72` (correct).  
**What actually happens**: The GLSL emitter passes `|` and `&` through directly (`shader-analysis-glsl.ts:137`). GLSL does not allow bitwise operations on floats — this produces a compile error in the composite shader.  
**Corpus presets affected**: None known.  
**Estimated fix effort**: Medium — requires GLSL workaround (conversion to int via `int()`, bitwise op, conversion back).

### 2.3 `ret =` / `shader_body =` with `-` (subtraction) between main and aux samples

**What it should do**: `ret = tex2d(sampler_main, uv).rgb - tex2d(sampler_noise, uv).rgb * amount` — subtract an aux layer from the main sample.  
**What actually happens**: The AST handler at `shader-analysis.ts:626-646` only handles `+` (add mode). There is no handler for `-` (subtract mode), `-` with scaled aux sample, or `/` (divide mode). The line falls through to scalar/vector evaluation, may extract partial or no controls, and ends up in the `directProgram` path without translated controls.  
**Corpus presets affected**: None in certification corpus. Would affect presets using `main - aux * factor`.  
**Estimated fix effort**: Low — add a `case '-'` handler mirroring the `+` handler at line 626.

### 2.4 `ret = mix(tex2d(sampler_<aux>, uv).rgb, tex2d(sampler_main, uv).rgb, amount)` — aux first, main second

**What it should do**: Mix from an aux sample toward the main sample.  
**What actually happens**: The mix handler at `shader-analysis.ts:495-528` requires the FIRST argument to be `isShaderSampleRgbExpression` with `baseSample.source === 'main'`. If an aux sample comes first, the function returns false and no texture layer control is extracted.  
**Corpus presets affected**: None known.  
**Estimated fix effort**: Low — extend the handler to detect either ordering.

### 2.5 `texture_source = sampler_main`

**What it should do**: Reset the overlay source to main (disable overlay).  
**What actually happens**: `applyTextureSourceAssignment` at `shader-control-application.ts:96-98` requires `isAuxShaderSamplerName(source)`, which rejects `main`. Returns false, causing the line to either go unsupported or get caught as an unknown key.  
**Estimated fix effort**: Low — special-case `main` to reset `textureLayer.source` to `'none'`.

### 2.6 `ret = mix(main, tex2d(sampler_main, uv).rgb * 2.0, 0.5)` — non-trivial second argument

**What it should do**: Mix main sample with a scaled version of itself.  
**What actually happens**: The mix handler at `shader-analysis.ts:513-529` dispatches through `getShaderSampleInfo(targetNode)` then `extractShaderInvertedSampleExpression`. Since the target is not an aux sample, not an inverted sample, not a solarize pattern, and not a vec3 tint, all branches return false. No controls extracted. Falls to direct-program execution without translated control fallback.  
**Corpus presets affected**: None.  
**Estimated fix effort**: Medium — would require expanding the AST analysis to recognize `main * scalar` as a brightness adjustment in mix context.

### 2.7 No warning for tex3D on non-volume sampler in GLSL path

**What it should do**: Warn when `tex3D(sampler_noise, ...)` is used but the GLSL backend lacks a volume atlas for `noise`.  
**What actually happens**: `buildUnsupportedVolumeSamplerWarnings` at `shader-analysis-helpers.ts:641-671` only warns when a sampler is NOT in `MILKDROP_VOLUME_SHADER_TEXTURE_SAMPLERS`. Currently ALL aux samplers are in the volume set (`shader-samplers.ts:19-30`), so no warning fires. But the GLSL `emitTextureSample` at `shader-analysis-glsl.ts:393-399` treats `sampleDim` as `'1.0'` for 3D samples, regardless of sampler type, which sends all 3D aux samples through the same `sampleAuxTexture` path. If the runtime only provides a 2D texture for `noise`, the 3D lookup may read garbage.  
**Estimated fix effort**: Low — add a comment noting the assumption, or expand the warning system when backends cannot honor the dimension.

### 2.8 `uv = uv * vec2(sx, sy)` — non-uniform scale not extracted as control

**What it should do**: Apply a per-axis scale to the UV coordinate (separate from uniform zoom).  
**What actually happens**: The `uv` handlers at `shader-analysis.ts:177-253` only handle offset (`+=`, `-=`, `uv + vec2(dx, dy)`). The `analyzeShaderUvTransform` at `shader-analysis-helpers.ts:949-1113` handles `uv * scalar` (uniform scale → zoom) but does NOT propagate per-axis scales to shader controls because `MilkdropShaderControls` has a single `zoom` field, not separate `scaleX`/`scaleY`. The expression ends up as a direct-program emission.  
**Corpus presets affected**: Any preset using non-uniform UV scale in direct shader programs.  
**Estimated fix effort**: Medium — requires adding `scaleX`/`scaleY` to `MilkdropShaderControls` or accepting that these are direct-program-only.

### 2.9 `texture_offset = scalar` (non-vec2) silently fails

**What it should do**: Allow a single scalar offset applied uniformly to both axes.  
**What actually happens**: The handler at `shader-analysis.ts:297-319` only accepts `vec2Result`. A scalar expression yields `null` from `evaluateShaderVectorResult`, causing the handler to return false and the line to go unsupported.  
**Estimated fix effort**: Low — add scalar splat fallback.

### 2.10 `bassAtt` / `midAtt` / `trebleAtt` in GLSL emitter — missing signal mappings

**What it should do**: These camelCase aliases (from MilkDrop2) should map to the same signal uniforms as `bass_att`, `mid_att`, `treb_att`.  
**What actually happens**: In the GLSL emitter at `shader-analysis-glsl.ts:70-125`, `bassAtt`, `midAtt`, `trebleAtt` are NOT in the `uniformMap`. They would pass through as bare identifiers, which would fail to compile in the composite shader. The WGSL generator includes them in `VmSignals` at `wgsl-generator.ts:201-204` (correct).  
**Estimated fix effort**: Low — add the three mappings to `uniformMap`.

---

## 3. Silent Fallbacks

Every location where semantic analysis reports `supported: true` or `shaderTextExecution: 'direct'` but the visual output may differ from MilkDrop reference.

### 3.1 Identity sample passthrough hides UV transforms

**File**: `shader-analysis.ts:398-401`  
**What happens**: When `ret = tex2d(sampler_main, uv * 2.0 + vec2(0.1, 0.0)).rgb` is parsed, `getShaderSampleInfo` extracts `source: 'main'` and `uv: uv * 2.0 + vec2(...)` (as an AST node). The handler returns `true` at line 400, marking the line as supported. But the UV transform is NOT extracted into offset/zoom controls — it goes entirely through the direct-program emission path. If direct program execution subsequently fails (e.g., backend doesn't support the composite shader variant), the controls-only fallback would show the identity sample WITHOUT the UV transform. No warning is emitted that the controls translation lost the UV expression.  
**Impact**: Visual difference between direct-program execution and controls-only fallback for any preset with non-trivial UV expressions.

### 3.2 `ret =` with scalar-only ident recognized as "supported" but no controls extracted

**File**: `shader-analysis.ts:397-401`  
**What happens**: `ret = tex2d(sampler_main, uv).rgb` → `getShaderSampleInfo` returns `{ source: 'main' }`. Returns `true`. But no control values are changed (colorScale, tint, etc. all stay at defaults). The direct program emits the full expression, but if the controls-only fallback is used, nothing happens visually. The line is semantically marked "supported" despite being a no-op in controls mode.  
**Mitigation**: The direct program is always emitted for identity samples, so this is fine in practice. But the control translation path silently produces no visual effect.

### 3.3 Heuristic path silently ignores `return` statements

**File**: `shader-analysis.ts:714-1082`  
**What happens**: `applyShaderProgramHeuristicLine` is only called when `parseMilkdropShaderStatement` fails (line 1209 fallback). But `return <value>` IS parsed by `parseMilkdropShaderStatement` (`shader-ast.ts:414-432`). If `return <value>` enters the AST path at `applyShaderAstStatement` and the target is `return`, the `shouldEmitDirectProgramStatement('return')` returns `true` at `shader-analysis-direct-program.ts:230`. The direct program is emitted. But if the return value is a complex expression that can't be extracted, no controls are captured. The fallback controls-mode execution shows identity.

### 3.4 `^` operator silently wrong in GLSL

**File**: `shader-analysis-glsl.ts:136-143`  
**What happens**: As described in §2.1. The direct program GLSL will contain `(a ^ b)`, which in GLSL is bitwise XOR on integers, not power. If `a` and `b` are floats, this is undefined behavior. The shader may fail to compile (producing a black screen) or produce wrong colors. No warning is emitted.  
**Backend divergence**: WebGPU correct (pow), WebGL wrong (XOR).

### 3.5 Poly-filled `||` and `&&` produce different precision than MilkDrop VM

**File**: `shader-analysis-glsl.ts:138-142` (GLSL), `wgsl-generator.ts:86-88` (WGSL)  
**What happens**: MilkDrop's VM uses `*` for AND and `+` for OR with no clipping, but the runtime clamps values at 0 and 1. The GLSL emitter uses `a + b - a * b` for saturating OR and `*` for AND. The WGSL generator uses `select(0.0f, 1.0f, a > eps && b > eps)`. These produce results that differ at the margin (e.g., `0.7 || 0.7` → MilkDrop: `0.7 + 0.7 = 1.4` clamped, GLSL: `0.7 + 0.7 - 0.49 = 0.91`).  
**Impact**: Minor visual difference in presets using heavy boolean logic.

### 3.6 GLSL emitter drops `^`, `|`, `&` with no warning

**File**: `shader-analysis-glsl.ts:137`  
**What happens**: These operators pass through the `emitBinary` fallback `(${left} ${glslOp} ${right})` unchanged. If the composite shader has these in a direct-program block, the GPU shader compiler may reject them or produce wrong results. No compile-time warning is emitted by the Stims compiler.

---

## 4. Priority Order

Ranked by impact: how many certification-corpus and real-world presets would move from "semantic-only supported" or "controls-fallback" to "fully measured exact".

### Priority 1: `^` operator GLSL → pow mapping
- **Impact**: Fixes every preset using `a ^ b` for exponentiation in direct shader programs. This is the most common MilkDrop operator divergence.
- **Estimated effort**: Low
- **Files touched**: `shader-analysis-glsl.ts:136-143` (add `'^': 'pow'` handling in `emitBinary`)
- **Corpus preset that would benefit**: None currently in certification corpus, but observed in real-world user presets. Any preset using `^` in `ret=` or `shader_body=` expressions.

### Priority 2: UV transform extraction into controls
- **Impact**: Many presets use `uv * vec2(sx, sy)` or `uv * factor` in warp shaders. Without extracting these to zoom/scale controls, the controls-fallback path loses the transform. Fixing this makes more presets truly "controls-portable" rather than "direct-program-only".
- **Estimated effort**: Medium
- **Files touched**: `shader-control-application.ts` (add per-axis scale fields), `shader-analysis-helpers.ts:949-1113` (extend `analyzeShaderUvTransform`)
- **Corpus presets that would benefit**: Any warp shader with `uv *= scale` or `uv = uv * vec2(sx, sy)`. Especially real-world presets with non-uniform zoom.

### Priority 3: `bassAtt` / `midAtt` / `trebleAtt` GLSL signal mappings
- **Impact**: Prevents GLSL compile failure for presets using MilkDrop2 camelCase signal aliases. These presets currently break silently on WebGL while working on WebGPU.
- **Estimated effort**: Low
- **Files touched**: `shader-analysis-glsl.ts:70-125` (add three entries to `uniformMap`)
- **Corpus preset that would benefit**: Any preset ported from MilkDrop2 that uses these aliases. No current corpus preset uses them, but they're in the WGSL signal struct so they ARE parsed and reachable.

### Remaining items, in order

4. **`ret = main - aux * amount` operator** — Low effort, extends subtract mode.
5. **`texture_source = sampler_main`** — Low effort, resets overlay.
6. **`|` and `&` operator GLSL compatibility** — Medium effort, lower priority (rarely used).
7. **`texture_offset = scalar`** — Low effort, adds splat.
8. **Non-main-first mix detection** — Low effort, ordering flexibility.
9. **GLSL precision divergence for `||`** — Low effort (document), the saturating formula works well enough.
10. **Add `scaleX`/`scaleY` to controls** — Medium effort, enables UV scale extraction.

---

## 5. Summary Counts

| Category | Count |
|---|---|
| Fully supported patterns | ~50 (covering all control keys, all math functions, all sampler call variants, AST and heuristic paths) |
| Unsupported/partial patterns | 10 |
| Silent fallback locations | 6 |

**Top 3 by impact**:
1. `^` operator GLSL divergence — fixes exponentiation
2. UV transform extraction — fixes controls-fallback fidelity
3. `bassAtt`/`midAtt`/`trebleAtt` GLSL mappings — prevents silent GLSL compile failure
