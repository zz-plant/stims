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
