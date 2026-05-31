# MilkDrop coding guide

Lessons from analyzing the top 1% of presets. Not a spec reference — a pattern language.

---

## The pipeline

Every great preset follows the same flow:

```
raw audio → smoothing → accumulation → position/color
```

| Stage | Variable | What it produces |
|---|---|---|
| Raw | `bass_att`, `mid_att`, `treb_att` | Attack-smoothed audio levels |
| Smooth | `*_avg` via RC filter | Butter-smooth tracking |
| Accumulate | `mtime`, `q1` | Continuous animation clock |
| Output | `q8` (volume), `q2` (beat) | Master intensity signals |

---

## Pattern 1: Volume squaring + mtime

```milk
vol = (bass+mid+treb)*0.25;
vol = vol*vol;
mtime = mtime + vol*0.01*(75/fps);
q1 = mtime*0.9;      // master animation clock
q8 = vol;             // master audio intensity
```

Squaring compresses quiet passages and amplifies loud ones. The preset "rests" during silence and "explodes" on beats. Frame rate correction (`75/fps`) normalizes across machines.

---

## Pattern 2: RC audio smoothing

```milk
ra = 1/fps_corr*0.1;
treb_avg = treb_avg*(1-ra) + ra*treb;
mid_avg  = mid_avg *(1-ra) + ra*mid;
bass_avg = bass_avg*(1-ra) + ra*bass;
```

This is a proper low-pass filter. `ra` (0.05–0.15) controls cutoff. Use these smoothed values for everything visual — raw audio creates jitter.

---

## Pattern 3: Per-pixel radial zoom

```milk
per_pixel_1=zoom=(zoom-1)*rad+1;
```

At the center (`rad=0`), `zoom=1` — unchanged. At the edge (`rad=1`), `zoom=zoom` — full effect. This single line creates organic breathing depth.

---

## Pattern 4: Radial pulse with rings

```milk
dr = 0.01 + 0.04*q8*sin(rad*12 + time*0.5);
dx = dx + dr*cos(ang)*0.6;
dy = dy + dr*sin(-ang)*0.6;
```

`rad*12` creates 12 concentric rings. `time*0.5` rotates them. `q8` scales intensity with audio. Result: pulsing concentric circles radiating from center.

---

## Pattern 5: Color cycling with irrational frequencies

```milk
wave_r = wave_r + 0.15*(0.6*sin(0.98 *time) + 0.4*sin(1.047*time));
wave_g = wave_g + 0.35*(0.6*sin(0.835*time) + 0.4*sin(1.081*time));
wave_b = wave_b + 0.15*(0.6*sin(0.814*time) + 0.4*sin(1.011*time));
```

Key details:
- R/G/B phases offset by 2.094 and 4.188 (2π/3) for rainbow sweep
- Irrational frequency ratios (0.98, 0.835, 1.047, 1.081) — colors never repeat
- Sum-of-sines: richer color drift than single sine
- Different amplitudes per channel (0.15, 0.35, 0.15) — bass-leaning warmth

---

## Pattern 6: Beat detection with adaptive threshold

```milk
bass_thresh = above(bass_att,bass_thresh)*2
  + (1-above(bass_att,bass_thresh))*((bass_thresh-1.3)*0.96+1.3);
```

When a beat fires, threshold jumps to 2.0 (prevents rapid re-triggering). When it doesn't, threshold decays toward 1.3 with a 0.96 factor. Self-adapting — works for quiet music and loud music.

---

## Pattern 7: 3D projection pipeline

```milk
// Generate 3D position
xp = sin(n*angle)*radius;
yp = cos(n*angle)*radius;
zp = sin(n*freq+time)*depth;

// Rotate on Y
xp2 = xp*sin(angY) + zp*cos(angY);

// Perspective projection
zp = zp + 2.5;          // focal length
xs = xp/zp;              // divide by z
ys = yp/zp;
x = xs + 0.5;            // center in screen space
y = ys*1.3 + 0.5;        // aspect ratio correction
```

The `zp+2.0` to `zp+2.8` range controls "lens" focal length. `1.3` or `1.333` corrects for non-square pixels.

---

## Pattern 8: Beat-triggered state machine

```milk
beat = above(vol, 1);
bc = max(bc, 0);
bc = if(equal(bc,0), bc+beat, bc-(1/fps)/4);   // cooldown timer
trigger = equal(bc, 1);                          // fires exactly once
size = size + trigger;
size = if(above(size, 10), 4, size);            // cycle wraps
```

The cooldown timer prevents rapid re-triggering from sustained bass. `trigger` fires on exactly one frame. Size cycles from 4 to 10.

---

## Anti-patterns

| Don't | Because | Do instead |
|---|---|---|
| `warp=1.0` + `decay>0.95` | Uncontrolled feedback smudge | `warp=0`, per-pixel dx/dy/rot |
| `dx=0.01` for every pixel | Looks like a screensaver | `dx=dx+newrad*0.003` — varies by position |
| `wave_r=wave_g=wave_b=0.65` | Grey, dead look | Offset phases, irrational frequencies |
| Raw `bass`/`mid`/`treb` | Jittery, amateur feel | Use `bass_att` or RC filter |
| No per_pixel code | No depth or spatial variation | At minimum: `zoom=(zoom-1)*rad+1` |
| No fps correction | Different machines, different results | `(75/fps)` multiplier |

---

## Professional vs amateur checklist

**Professional preset:**
- [ ] Audio drives velocity (mtime), not position directly
- [ ] Every pixel responds independently to audio
- [ ] q1-q4 for animation clocks, q5-q8 for audio intensity
- [ ] Color channels independently modulated with offset phases
- [ ] `warp=0` in per_frame, distortion via per_pixel
- [ ] Frame rate correction present
- [ ] At least 3 meaningful per_pixel lines using rad/ang
- [ ] Color clamped to [0,1]
- [ ] RC smoothing on at least one audio register

**Amateur preset:**
- [ ] One-size-fits-all effects (same dx for every pixel)
- [ ] No audio reactivity in per_pixel
- [ ] Static colors or simple `sin(time)*0.5+0.5`
- [ ] `warp=1.0` + `decay=0.99`
- [ ] Over-reliance on video echo
- [ ] No frame rate normalization
- [ ] Unclamped color overflow → white clipping

---

## The GLSL shader era (2008–present)

64% of the 1,733 butterchurn presets use dual-GLSL pipelines (`[warp_shader]` + `[comp_shader]`). This is the dominant construction method for modern presets — EEL per_frame/per_pixel generates motion and color, GLSL shaders apply per-pixel image processing.

### Dual shader pipeline

```
Texture → [warp_shader] → [comp_shader] → Frame buffer
              ↓                    ↓
         Distorts pixels       Colors / blends pixels
         (dx, dy, zoom)        (tone maps, mixes layers)
```

Key uniforms available in both shaders:

| Uniform | Type | What it is |
|---|---|---|
| `sampler_main` | sampler2D | The frame buffer (video feedback) |
| `sampler_fc_main` | sampler2D | Frame-color: main composited frame |
| `sampler_blur1`–`sampler_blur3` | sampler2D | 3 blur levels (2, 4, 8px) |
| `sampler_noise_lq` | sampler2D | 256×256 low-quality noise |
| `sampler_noisevol_hq` | sampler3D | 128×128×128 high-quality volumetric noise |
| `q1`–`q8` | float | Frame state passed from per_frame |
| `t1`–`t32` | float | Per-slot temp state |
| `time`, `fps`, `frame` | float | Timing |
| `bass`, `mid`, `treb` | float | Raw audio |
| `bass_att`, `mid_att`, `treb_att` | float | Attack-smoothed audio |

### Pattern 9: Reaction-diffusion warp

```glsl
[warp_shader]
// Reads 4 neighbor pixels at 0.3 texel offset
float x = texture2D(sampler_main, uv + vec2( 0.3,  0.0) / texsize).x;
float y = texture2D(sampler_main, uv + vec2(-0.3,  0.0) / texsize).y;
float l = texture2D(sampler_main, uv + vec2( 0.0,  0.3) / texsize).x;
float t = texture2D(sampler_main, uv + vec2( 0.0, -0.3) / texsize).y;

// 2-variable reaction-diffusion update
float x2 = x + (-(y) + (0.035 * (1.0 - x)));
float y2 = y + ( x - (0.095 * y));
// Feeds back as dx, dy displacement
ret = vec2(x2, y2);
```

Encode audio variable thresholds with `if()` conditionals:
```glsl
if (q21 < q26) x2 = -x2;   // flip direction on audio crossing
```

### Pattern 10: Edge-detection compositing

```glsl
[comp_shader]
// Gradient magnitude from 4 neighbors
float dx = texture2D(sampler_main, uv + vec2( 1.0 / texsize.x, 0.0)).x
         - texture2D(sampler_main, uv + vec2(-1.0 / texsize.x, 0.0)).x;
float dy = texture2D(sampler_main, uv + vec2(0.0,  1.0 / texsize.y)).x
         - texture2D(sampler_main, uv + vec2(0.0, -1.0 / texsize.y)).x;
float edge = length(vec2(dx, dy)) * 6.0;

// High-pass: subtract blurred from sharp
vec3 sharp  = texture2D(sampler_main, uv).rgb;
vec3 blurred = texture2D(sampler_blur1, uv).rgb;
ret = abs(sharp - blurred) * edge;
```

### Pattern 11: 3D noise volume sampling

```glsl
[comp_shader]
// Cycle through a volumetric noise texture at different Z-depths
vec3 noise = texture3D(sampler_noisevol_hq,
    vec3(uv.xy, time / 10.0 + q1 * 5.0)).xyz;

// Inject noise at pixel level
ret = noise * 0.5 + 0.5;
```

Z-coordinate driven by audio-clock (`q1*5`) for reactive noise fields. The 3D texture is 128³ — cycling through Z creates organic 3D patterns without per-frame storage.

### Pattern 12: Shape state machine (Evet)

```milk
// Cycle through 6 visual states every 2 frames
shape_3_per_frame1=s = frame % 6 + 4;
shape_3_per_frame2=sides = s;
shape_3_per_frame3=rad = s * 0.02;
shape_3_per_frame4=ang = s * 0.3;
shape_3_per_frame5=r = sin(s * 1.1) * 0.5 + 0.5;
shape_3_per_frame6=g = sin(s * 2.2) * 0.5 + 0.5;
shape_3_per_frame7=b = sin(s * 3.3) * 0.5 + 0.5;
shape_3_per_frame8=a = 0.6;
```

This creates shape-instance cycling — the shape "morphs" between 6 visual identities, each with different geometry and color, driven by frame count.

### Pattern 13: Iterated fractal warp

```glsl
[warp_shader]
vec2 z = uv * 2.0 - 1.0;     // center at origin
// 6 iterations of Julia squaring
for (int i = 0; i < 6; i++) {
    float x2 = z.x * z.x - z.y * z.y;
    z.y = 2.0 * z.x * z.y + fract(q1 * 0.1);
    z.x = x2 + fract(q2 * 0.1);
}
ret = z * 0.5 + 0.5;          // remap to [0,1]
```

Audio drives the Julia constant (`fract(q1*0.1)`), creating reactive fractal distortion without heavy computation — the iteration count is fixed at 6.

---

## EEL-era vs GLSL-era comparison

| | Classic (2001–2007) | Modern (2008–present) |
|---|---|---|
| **Primary code** | `per_frame` + `per_pixel` in EEL | `[warp_shader]` + `[comp_shader]` in GLSL |
| **Motion** | `dx`, `dy`, `zoom`, `rot` per pixel | Texture coordinate displacement in warp shader |
| **Color** | `wave_r/g/b` cycling | Full RGB compositing with tone mapping |
| **Effects** | Video echo (`fVideoEchoZoom`) | Edge detection, blur subtraction, noise injection |
| **Math** | Sin/cos/pow with audio variables | Iterated fractals, reaction-diffusion PDEs |
| **Texture** | Implicit frame buffer only | Noise textures, blur passes, 3D volumes |
| **Complexity** | 20–60 lines per preset | 50–200 lines per preset |
| **Audio** | Volume + time accumulation | Conditional branching (`if(q21 < q26)`) in shaders |

### Key insight for AI generation

For simple requests ("blue spiral"), per_frame + per_pixel EEL code is sufficient. For complex requests ("reaction-diffusion with edge detection"), the AI must generate GLSL shader blocks alongside EEL code. The `[warp_shader]` and `[comp_shader]` sections use GLSL not EEL — they must be valid GLSL 1.20 (no matrix types, no `texture()` with LOD, sampler names as uniform identifiers).

---

## Engine limitations

### Custom texture samplers

**Stims supports 14 texture samplers.** The original MilkDrop/Winamp plugin allowed loading arbitrary custom textures via `textures.ini`. Stims uses pre-authored PNG files for the standard set. 188 presets (~10%) reference 27 non-standard sampler names that do not exist in the engine.

| Standard (supported) | Aliased (mapped to standard) | Multi-pass (unsupported) |
|---|---|---|
| `main`, `none` | `noise_mq`, `rand00`, `cells` | `pw_main`, `pc_main` |
| `noise`, `perlin` | `seaweed`, `lichen`, `moss1` | `pw_noise_lq` |
| `simplex`, `voronoi` | `prayerwheel`, `clouds` | |
| `aura`, `caustics` | `smalltiled_*`, `paper` | |
| `pattern`, `fractal` | `sunrise` → pattern | |
| `video` | `fw_noise_lq` → noise | |

Non-standard samplers are aliased to the closest standard texture where possible (`cells` → voronoi, `rand00` → noise, `sunrise` → pattern). However, `pw_main` and `pc_main` (48 presets each) reference intermediate render pass textures from the original multi-stage pipeline — these presets cannot be accurately reproduced without architectural changes to the engine.

### Warp shader texture coordinates

Stims's WebGL-to-WebGPU translation rewrites texture coordinates in warp shaders. The translation layer does not support `texture2D()` with explicit LOD or matrix type uniforms (GLSL 1.20+ features). Warp shaders must use:
```glsl
ret = texture2D(sampler_main, uv).xy * vec2(1.0, -1.0);
```

### No external texture loading

Presets cannot load textures from URLs, files, or data URIs. All textures must be pre-authored PNG files in `/public/textures/` and registered in `shader-samplers.ts`.
