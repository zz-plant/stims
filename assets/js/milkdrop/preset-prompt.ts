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
