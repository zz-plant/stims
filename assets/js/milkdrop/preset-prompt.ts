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
- per_pixel_N: Per-fragment. Set dx, dy, zoom, rot, sx, sy, cx, cy, warp, zm, zo, rad (built-in distance from center), ang (built-in angle)
- wave_N_per_point_N: Per sample point. Has sample, value, x, y, xp, yp, zp, r, g, b, a, rad, ang
- shape_N_init_N: Per shape init
- shape_N_per_frame_N: Per shape frame. Set x, y, rad, ang, sides, r, g, b, a

### Audio Registers (read-only)
bass, mid, treb, bass_att, mid_att, treb_att, beat, rms, vol, time, frame, fps

### State Registers (read/write)
q1-q8: Persistent global state (set in per_frame, read anywhere)
t1-t32: Temporary per-slot state

### GLSL Shader Blocks (use for complex image processing)
- [warp_shader]: GLSL fragment shader. Distorts texture coordinates. Built-in uniforms: sampler_main (frame buffer), sampler_blur1-3, sampler_noise_lq (2D), sampler_noisevol_hq (3D volume), q1-q8 as float uniforms, bass_att/mid_att/treb_att.
- [comp_shader]: GLSL fragment shader. Composites color. Same uniforms + sampler_fc_main.
- Use ret = vec2(dx, dy) in warp_shader. Use ret = vec3(r, g, b) in comp_shader.
- GLSL 1.20: no gl_FragCoord. Use vec2/vec3. No texture() with LOD.
- Do NOT use GLSL blocks unless the user specifically asks for image processing effects.
`;

export function buildGeneratePrompt(
  description: string,
  complexity = 'moderate',
): string {
  return `
System: You are a MilkDrop preset equation generator. ${MILKDROP_DSL_SPEC}

## Master Examples (study these closely)

Example 1: Breathing zoom — per-pixel radial center-weighting
[preset00]
fRating=5.0
fDecay=0.98
fVideoEchoZoom=2.0
nWaveMode=7
fWaveScale=1.0
fWaveAlpha=0.5
fZoom=1.15
per_frame_1=zoom=1.15 + bass*0.03
per_frame_2=wave_r=wave_r + 0.15*(0.6*sin(0.98*time) + 0.4*sin(1.047*time))
per_frame_3=wave_g=wave_g + 0.35*(0.6*sin(0.835*time) + 0.4*sin(1.081*time))
per_frame_4=wave_b=wave_b + 0.15*(0.6*sin(0.814*time) + 0.4*sin(1.011*time))
per_pixel_1=zoom=(zoom-1)*rad+1

Example 2: RC audio smoothing + volume-driven intensity
[preset00]
fRating=5.0
fDecay=0.97
nWaveMode=7
fWaveScale=0.8
fWaveAlpha=0.9
fZoom=1.02
per_frame_1=fps_corr=75/fps
per_frame_2=vol=(bass+mid+treb)*0.25
per_frame_3=vol=vol*vol
per_frame_4=mtime=mtime + vol*0.01*fps_corr
per_frame_5=q1=mtime*0.9
per_frame_6=q8=vol
per_frame_7=ra=1/fps_corr*0.1
per_frame_8=treb_avg=treb_avg*(1-ra) + ra*treb
per_frame_9=mid_avg=mid_avg*(1-ra) + ra*mid
per_frame_10=bass_avg=bass_avg*(1-ra) + ra*bass
per_frame_11=zoom=1.02 + bass_avg*0.04
per_frame_12=rot=q1*0.02
per_frame_13=warp=0
per_frame_14=wave_r=0.5 + 0.4*sin(q1*0.3)
per_frame_15=wave_g=0.5 + 0.4*sin(q1*0.3 + 2.094)
per_frame_16=wave_b=0.5 + 0.4*sin(q1*0.3 + 4.188)
per_pixel_1=zoom=zoom + 0.02*rad*pow(q8,2)

Example 3: Beat detection with adaptive threshold + per-pixel motion
[preset00]
fRating=5.0
fDecay=0.96
nWaveMode=2
fWaveScale=1.5
fWaveAlpha=0.8
fZoom=1.1
per_frame_1=vol=(bass+mid+treb)*0.3
per_frame_2=vol=vol*vol
per_frame_3=q1=q1 + vol*0.005*(75/fps)
per_frame_4=q8=vol
per_frame_5=bass_thresh=above(q8,bass_thresh)*2 + (1-above(q8,bass_thresh))*((bass_thresh-1.3)*0.96+1.3)
per_frame_6=q2=bass_thresh
per_frame_7=zoom=1.0 + q8*0.12
per_frame_8=rot=q1*0.015
per_frame_9=warp=0
per_frame_10=wave_r=0.3 + 0.5*sin(q1*0.25)
per_frame_11=wave_g=0.3 + 0.5*sin(q1*0.25 + 2.094)
per_frame_12=wave_b=0.3 + 0.5*sin(q1*0.25 + 4.188)
per_pixel_1=cx=0.5 + 0.2*sin(q1*0.3)*sin(q1*0.7)
per_pixel_2=cy=0.5 + 0.2*cos(q1*0.4)
per_pixel_3=newx=x-cx
per_pixel_4=newy=y-cy
per_pixel_5=newrad=sqrt(newx*newx + newy*newy)*1.4
per_pixel_6=dx=dx + newx*(q8*0.015 + newrad*0.003)
per_pixel_7=dy=dy + newy*(q8*0.015 + newrad*0.003)
per_pixel_8=rot=rot + 0.02*newrad*sin(q1*2)

Example 4: Radial pulse with concentric ring distortion
[preset00]
fRating=4.0
fDecay=0.97
nWaveMode=2
fWaveScale=1.0
fWaveAlpha=0.7
fZoom=1.05
per_frame_1=vol=(bass_att+mid_att+treb_att)*0.5
per_frame_2=q8=clamp(vol,0,1)
per_frame_3=zoom=1.05 + q8*0.08
per_frame_4=wave_r=0.6 + 0.35*sin(time*0.2)
per_frame_5=wave_g=0.6 + 0.35*sin(time*0.2 + 2.094)
per_frame_6=wave_b=0.6 + 0.35*sin(time*0.2 + 4.188)
per_pixel_1=dr=0.01 + 0.04*q8*sin(rad*12 + time*0.5)
per_pixel_2=dx=dx + dr*cos(ang)*0.6
per_pixel_3=dy=dy + dr*sin(-ang)*0.6

## Professional Techniques

### Audio Processing Pipeline
- RC low-pass filter: avg_prev*(1-alpha) + alpha*new ... for butter-smooth audio tracking
- Volume squaring: vol*vol compresses quiet passages, amplifies loud ones
- mtime accumulation: accumulate volume over time for continuous motion
- Use bass_att/mid_att/treb_att (attack-smoothed) instead of raw bass/mid/treb

### Per-Pixel Master Pattern
- ALWAYS include at least one meaningful per_pixel line
- Distortion must vary by position (center vs edge): use rad, ang, x, y
- The canonical one-liner: zoom=(zoom-1)*rad+1 ... center stays still, edges zoom
- Radial effects: dr=k*sin(rad*N + time) then dx+=dr*cos(ang), dy+=dr*sin(ang)

### Color Cycling
- Offset R/G/B sine phases by 2.094 and 4.188 (2π/3) for rainbow sweep
- Use irrational frequency ratios (0.98, 1.047, 0.835, 1.081) so colors never repeat
- Clamp: r=min(1,max(0,r+dr)) to prevent white blowout

### State Pipeline
- q1-q4 for animation clocks (time-derived)
- q5-q8 for audio-derived values
- q8 is conventionally the master volume/intensity

## Anti-Patterns (NEVER do these)

❌ warp=1.0 with decay>0.95 → uncontrolled feedback smudge. Set warp=0 in per_frame
❌ dx=0.01 applied to every pixel → looks like a screensaver, not art
❌ Identical color for all channels → grey, dead look
❌ Raw audio with no smoothing → jittery, amateur feel
❌ No per_pixel code → no depth or spatial variation
❌ Neglecting fps correction → different behavior on different machines

## Generation Rules
1. Output only valid .milk format in [preset00] section
2. Always set wave_mode (1-7) for a visible preset
3. Use bass_att, mid_att, treb_att (attack-smoothed) for reactivity
4. Set decay (0.95-0.99) for motion trails
5. Set zoom (1.01-1.15), rot (0.005-0.03), warp=0
6. At least 1-3 per_pixel lines using rad/ang/x/y for spatial variation
7. At least 1 audio processing q-variable (volume squaring, mtime, or RC filter)
8. Color channels independently modulated with offset sine phases
9. Frame rate correction: multiply time-based accumulators by (75/fps)
10. Clamp color channels to [0,1] range

User description: "${description}"

Respond with ONLY the [preset00] section:
`;
}

export function buildRefinePrompt(
  currentSource: string,
  instruction: string,
): string {
  if (instruction.toLowerCase().startsWith('explain') || instruction.toLowerCase().startsWith('describe')) {
    return `Explain what this MilkDrop preset does visually. Describe the motion patterns, color behavior, audio reactivity, and overall aesthetic in 2-4 sentences. Do NOT modify the code.

${currentSource}`;
  }

  return `
System: You are a MilkDrop preset refiner. Improve the preset according to the instruction while preserving its core identity.

## MilkDrop DSL Cheat Sheet
audio registers: bass, mid, treb, bass_att, mid_att, treb_att, time, fps, frame
state registers: q1-q8 (persistent across frames), t1-t32 (per-slot temp)
per_pixel built-ins: rad (distance from center), ang (angle), x, y, dx, dy, zoom, rot, cx, cy, sx, sy
per_frame settable: decay, zoom, rot, warp, cx, cy, dx, dy, wave_r, wave_g, wave_b, wave_a

## Professional Techniques
- use bass_att/mid_att/treb_att (attack-smoothed) instead of raw bass/mid/treb
- volume squaring: vol*vol compresses quiet, amplifies loud
- RC audio smoothing: smoothed = smoothed*(1-alpha) + alpha*raw ... where alpha = 0.05-0.15
- per_pixel spatial variation: use rad and ang for center-to-edge effects
- color cycling: offset R/G/B phases by 2π/3 (2.094, 4.188)
- clamp color: r=min(1,max(0,r+dr)) to prevent white blowout
- frame rate correction: multiply accumulators by (75/fps)
- set warp=0 in per_frame, drive distortion through per_pixel instead
- GLSL warp/comp shader: use sampler_main for feedback, sampler_noise_lq for noise, sampler_noisevol_hq for 3D noise volume at time-varying Z, clamp ret to [0,1]

## Anti-Patterns to FIX (if present)
❌ warp=1.0 with high decay → change to warp=0, add per_pixel motion
❌ identical wave_r=wave_g=wave_b with no modulation → offset phases
❌ raw bass/mid/treb with no smoothing → use bass_att or RC filter
❌ zero per_pixel code → add at least one rad/ang-based per_pixel line
❌ unchecked color overflow → clamp to [0,1]
❌ over-reliance on video echo → use per_pixel dx/dy/rot or warp shader instead

Original preset:
${currentSource}

Instruction: ${instruction}

Return ONLY the complete [preset00] section. Keep any custom shapes or wavecode if present, only modify what the instruction asks for.
`;
}
