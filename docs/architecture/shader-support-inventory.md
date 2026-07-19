# Shader Support Inventory — MilkDrop Compiler

Analysis date: 2026-07-18. Based on the current audit of `assets/js/milkdrop/compiler/**`, `assets/js/milkdrop/shader-ast.ts`, `assets/js/milkdrop/shader-samplers.ts`, and the test suite (`tests/milkdrop-compiler*.test.ts`).

## Scope

This inventory covers every `shader_body`, `ret`, or `warp_shader`/`comp_shader` construct that enters the compiler through `extractShaderControls` (`shader-analysis.ts:1084`). Each line is processed through two paths:

1. **AST path** (`applyShaderAstStatement`, line 68) — Full parsed AST with expression evaluation, sampler info extraction, and control extraction.
2. **Heuristic path** (`applyShaderProgramHeuristicLine`, line 714) — Regex-based fallback for lines that parse as `key=value` but don't produce a valid MilkdropShaderStatement.

The critical routing logic is at `shader-analysis.ts:1128-1207`: AST hit → heuristic fallback → `isUnsupportedParsedShaderStatement` → direct-program context retention.

Direct shader program execution should be interpreted through `compiler/shader-execution-classification.ts`, not by ad hoc checks of `rawGlsl`, `supportedBackends`, or `requiresControlFallback`. This keeps raw-preserved fallback-required shader text distinct from backend-executable direct shader payloads.

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
| `texture_offset = scalar` / `texture_scroll = scalar` | Scalar is splatted to both axes in the AST and heuristic paths. |
| `texture_scale = vec2(x, y)` / `texture_scale = scalar` | `shader-analysis.ts:322-345` and `shader-control-application.ts:713-739`; scalar is splatted to both axes. |
| `warp_texture_offset = vec2(...)` / `warp_texture_scale = vec2(...)` | `shader-analysis.ts:347-395` and `shader-control-application.ts:741-795` |
| `warp_texture_offset = scalar` / `warp_texture_scale = scalar` | Scalar is splatted to both axes in the AST and heuristic paths. |

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
| `ret = mix(main, main * scalar, amount)` | Lowers to a blended color-scale factor while retaining the direct program for exact execution. |
| `ret = tex2d(sampler_main, uv).rgb * vec3(r,g,b)` (per-channel scale) | `shader-analysis.ts:418-492` |
| `ret = tex2d(sampler_<aux>, uv).rgb` (replace with aux sample) | `shader-analysis.ts:403-416` |
| `ret = tex3d(sampler_<aux>, vec3(uv, z)).xyz` (3D aux sample) | `shader-analysis.ts:403-416` |
| `ret = mix(main, aux, amount)` and swapped argument order | `shader-analysis.ts:495-528`; swapped order is normalized to `1 - amount`. |
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

### 2.1 `^` operator — fixed in GLSL emission

**What it should do**: MilkDrop uses `^` for exponentiation (pow). WGSL generator emits `pow(left, right)` at `wgsl-generator.ts:68` (correct).  
**Current behavior**: The GLSL emitter lowers `^` to `pow(left, right)` and the WGSL generator does the same. Focused emitter tests cover scalar and nested operands.
**Corpus presets affected**: None in certification corpus, but common in user-authored presets that use `^` for power.  
**Status**: Fixed; retain this row as a regression contract.

### 2.2 `|` and `&` operators — fixed float/int lowering

**What it should do**: MilkDrop uses `|` and `&` as float-safe bitwise operations (truncate to int, apply bitwise, cast back). WGSL generator emits `f32(i32(left) | i32(right))` at `wgsl-generator.ts:69-72` (correct).  
**Current behavior**: The GLSL emitter casts both float operands to `int`, applies the bitwise operation, and casts the result back to `float`; WGSL uses the corresponding integer cast path.
**Corpus presets affected**: None known.  
**Status**: Fixed; focused GLSL emitter tests cover both operators.

### 2.3 `ret =` / `shader_body =` with `-` (subtraction) between main and aux samples

**What it should do**: `ret = tex2d(sampler_main, uv).rgb - tex2d(sampler_noise, uv).rgb * amount` — subtract an aux layer from the main sample.  
**Current behavior**: The AST handler extracts `main - aux * amount` into the explicit `subtract` texture-layer mode. The direct program is retained when needed, and the runtime composite path emits subtractive color blending.
**Corpus presets affected**: None in certification corpus. Would affect presets using `main - aux * factor`.  
**Status**: Fixed for the supported main-minus-scaled-aux subset; divide and arbitrary multi-term expressions remain direct-program-only.

### 2.4 `ret = mix(tex2d(sampler_<aux>, uv).rgb, tex2d(sampler_main, uv).rgb, amount)` — aux first, main second

**What it should do**: Mix from an aux sample toward the main sample.  
**Current behavior**: The mix handler recognizes either ordering and normalizes the swapped form to an equivalent `1 - amount` blend toward the main sample.
**Corpus presets affected**: None known.  
**Status**: Fixed; covered by compiler analysis tests.

### 2.5 `texture_source = sampler_main`

**What it should do**: Reset the overlay source to main (disable overlay).  
**Current behavior**: The AST and heuristic control paths treat `sampler_main` as an explicit reset to `textureLayer.source = 'none'` and `mode = 'none'`.
**Status**: Fixed; covered by control-application tests.

### 2.6 `ret = mix(main, tex2d(sampler_main, uv).rgb * 2.0, 0.5)` — non-trivial second argument

**What it should do**: Mix main sample with a scaled version of itself.  
**Current behavior**: A scaled main sample is lowered to `1 + (scalar - 1) * amount` per color channel. The raw direct program remains available because the control lowering is an approximation for fallback execution.
**Corpus presets affected**: None.  
**Status**: Fixed for scalar-scaled main samples; arbitrary vector/function expressions remain direct-program-only.

### 2.7 Volume texture classification and browser approximation

Bundled aux samplers are recognized as volume sources and routed to native WebGPU 3D textures or the WebGL atlas fallback. The atlas preserves bounded sampling semantics but is not a native projectM volume texture. The certification and catalog layers therefore keep this path measurable but do not promote it to exact without visual evidence.
**Status**: Semantic support is fixed; pixel equivalence remains an evidence gap by design.

### 2.8 `uv = uv * vec2(sx, sy)` — non-uniform scale not extracted as control

**What it should do**: Apply a per-axis scale to the UV coordinate (separate from uniform zoom).  
**What actually happens**: The `uv` handlers at `shader-analysis.ts:177-253` only handle offset (`+=`, `-=`, `uv + vec2(dx, dy)`). The `analyzeShaderUvTransform` at `shader-analysis-helpers.ts:949-1113` handles `uv * scalar` (uniform scale → zoom) but does NOT propagate per-axis scales to shader controls because `MilkdropShaderControls` has a single `zoom` field, not separate `scaleX`/`scaleY`. The expression ends up as a direct-program emission.  
**Corpus presets affected**: Any preset using non-uniform UV scale in direct shader programs.  
**Estimated fix effort**: Medium — requires adding `scaleX`/`scaleY` to `MilkdropShaderControls` or accepting that these are direct-program-only.

### 2.9 `texture_offset = scalar` (non-vec2) — fixed scalar splat

**What it should do**: Allow a single scalar offset applied uniformly to both axes.  
**Current behavior**: Scalar offsets and scales are applied uniformly to X and Y in both AST and heuristic control paths. Focused tests cover the scalar vector transform contract.
**Status**: Fixed.

### 2.10 `bassAtt` / `midAtt` / `trebleAtt` in GLSL emitter — fixed aliases

**What it should do**: These camelCase aliases (from MilkDrop2) should map to the same signal uniforms as `bass_att`, `mid_att`, `treb_att`.  
**Current behavior**: The normalized GLSL identifier map routes `bassAtt`, `midAtt`, and `trebleAtt` to the corresponding signal uniforms. Focused shader-emitter tests cover these aliases with exponent and bitwise expressions.
**Status**: Fixed.

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

### 3.4 Direct programs remain backend-gated

**What happens**: Direct shader programs are only passed to a backend when their execution classification says that backend can run them. Unsupported or unmeasured patterns retain the raw source and an explicit controls-fallback requirement instead of being silently advertised as exact. Native WebGPU feedback remains disabled until composite parity is measured.

### 3.5 Poly-filled `||` and `&&` produce different precision than MilkDrop VM

**File**: `shader-analysis-glsl.ts:138-142` (GLSL), `wgsl-generator.ts:86-88` (WGSL)  
**What happens**: MilkDrop's VM uses `*` for AND and `+` for OR with no clipping, but the runtime clamps values at 0 and 1. The GLSL emitter uses `a + b - a * b` for saturating OR and `*` for AND. The WGSL generator uses `select(0.0f, 1.0f, a > eps && b > eps)`. These produce results that differ at the margin (e.g., `0.7 || 0.7` → MilkDrop: `0.7 + 0.7 = 1.4` clamped, GLSL: `0.7 + 0.7 - 0.49 = 0.91`).  
**Impact**: Minor visual difference in presets using heavy boolean logic.

### 3.6 GLSL emitter regression contract

**File**: `shader-analysis-glsl.ts:136-155`
**What happens**: `^`, `|`, and `&` have explicit GLSL lowering and focused tests. Keep this section as a regression contract because these operators are common sources of backend divergence when new expression forms are added.

---

## 4. Priority Order

Ranked by impact: how many certification-corpus and real-world presets would move from "semantic-only supported" or "controls-fallback" to "fully measured exact".

### Current priority order

1. Native WebGPU capture availability and direct feedback certification.
2. Feedback/video-echo pass ordering and rasterization drift against checked-in projectM references.
3. Volume-texture visual measurement, with the WebGL atlas path explicitly treated as approximate.
4. Broader shader-heavy and shape-heavy corpus coverage.

---

## 5. Summary Counts

| Category | Count |
|---|---|
| Fully supported patterns | ~50 (covering all control keys, all math functions, all sampler call variants, AST and heuristic paths) |
| Unsupported/partial patterns | 3 |
| Silent fallback locations | 5 |

**Top 3 by impact**:
1. Native WebGPU feedback and capture certification
2. Feedback/rasterization visual drift
3. Volume-texture equivalence and measured sampler coverage
