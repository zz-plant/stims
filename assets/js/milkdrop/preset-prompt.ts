export interface GeneratePresetRequest {
  description: string;
  mood?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
}

export interface GeneratedPresetResult {
  milkSource: string;
  title: string;
  diagnostics: Array<{ message: string }>;
}

const MILKDROP_DSL_SPEC = `
## MilkDrop Expression Language

Available functions: sin, cos, tan, asin, acos, atan, atan2, abs, sqrt, pow, mod, fmod, min, max, mix, lerp, floor, int, ceil, sqr, clamp, step, smoothstep, log, exp, sigmoid, sign, frac, rand, if, above, below, equal, bor, band, bnot.

Operators: + - * / % ^ < <= > >= == != && || ! 

### Expression Blocks (inside [preset00])
- per_frame_N: Runs every frame. Set q1-q8, t1-t32, decay, zoom, rot, cx, cy, sx, sy, dx, dy, warp
- per_pixel_N: Per-fragment. Set dx, dy, zoom, rot, sx, sy, cx, cy, warp, zm, zo, rad, ang
- wave_N_per_point_N: Per sample point. Has sample, value, x, y, xp, yp, zp, r, g, b, a, rad, ang
- shape_N_init_N: Per shape init
- shape_N_per_frame_N: Per shape frame. Set x, y, rad, ang, sides, r, g, b, a

### Audio Registers (read-only)
bass, mid, treb, bass_att, mid_att, treb_att, beat, rms, vol, time, frame, fps

### State Registers (read/write)
q1-q8: Persistent global state (set in per_frame, read anywhere)
t1-t32: Temporary per-slot state
`;

export function buildGeneratePrompt(
  description: string,
  complexity = 'moderate',
): string {
  return `
System: You are a MilkDrop preset equation generator. ${MILKDROP_DSL_SPEC}

Example 1: Bright pulse with zoom
[preset00]
fRating=4.0
fDecay=0.96
nWaveMode=2
fWaveScale=1.2
fWaveAlpha=0.85
fZoom=1.01
per_frame_1=zoom=1.01 + bass*0.035
per_frame_2=rot=time*0.02

Example 2: Dark geometric pattern
[preset00]
fRating=3.5
fDecay=0.98
nWaveMode=5
fWaveScale=0.8
fWaveAlpha=0.6
fZoom=0.9
fWarp=1.2
per_frame_1=decay=0.98
per_frame_2=warp=1.0 + mid_att*0.04
per_frame_3=wave_a=0.6 + treb_att*0.3

Example 3: Colorful psychedelic with shapes
[preset00]
fRating=5.0
fDecay=0.94
nWaveMode=1
fWaveScale=1.5
fWaveAlpha=0.9
fZoom=1.05
fRot=0.01
per_frame_1=zoom=1.05 + bass*0.05
per_frame_2=rot=time*0.012
per_frame_3=wave_r=0.5 + sin(time*0.3)*0.4
per_frame_4=wave_g=0.5 + sin(time*0.5)*0.4
per_frame_5=wave_b=0.5 + sin(time*0.7)*0.4
shapecode_0_enabled=1
shapecode_0_sides=8
shapecode_0_rad=0.15
shape_0_per_frame1=rad=0.08 + bass*0.02
shape_0_per_frame2=r=0.2 + sin(time*0.4)*0.3
shape_0_per_frame3=g=0.5 + sin(time*0.6)*0.3
shape_0_per_frame4=b=1

Rules:
1. Output only valid .milk format in [preset00] section
2. Always set wave_mode (1-7) for a visible preset
3. Use bass, mid, treb for audio reactivity
4. Use q1-q8 for persistent state
5. Keep expressions simple for ${complexity} complexity
6. Set decay (0.95-0.99) for motion trails
7. Set zoom, warp, rot for camera movement
8. Title in format: "AI: {Short Description}"

User description: "${description}"

Respond with ONLY the [preset00] section:
`;
}
