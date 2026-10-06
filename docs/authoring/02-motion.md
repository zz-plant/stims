# Track 2 — Motion

Every knob in this track answers the same question: *where does the previous frame get redrawn?* You already know `zoom`. Here are the rest, one at a time on [the bench](01-how-milkdrop-thinks.md), then combined, then read in the wild.

## Lesson 1 · `zoom`, pushed harder

```text
zoom=1.04
```

[**▶ Run the tunnel rush**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDQKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/20-zoom-rush.milk")

At 4% per frame the compounding stops being subtle: this is the classic flying-through-a-tunnel move. Above `1` flies outward, below `1` falls inward, and the distance from `1` is speed. Almost every preset keeps it within `0.9–1.1`; the drama comes from *changing* it (as in Lesson 4 of Track 1), not from large constants.

## Lesson 2 · `rot` and the pivot

```text
zoom=1.01
rot=0.02
```

[**▶ Run the spiral**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAuMDIKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/21-spiral.milk")

`rot` rotates the previous frame by a fixed angle (in radians) each frame. On its own it smears history into rings. Combined with outward `zoom` it makes the signature MilkDrop move: the spiral — every trail is simultaneously growing and turning.

Rotation happens around the pivot `cx, cy` (screen fractions; `0.5,0.5` is dead center):

```text
cx=0.3
cy=0.35
```

[**▶ Run the off-center spiral**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAuMDIKY3g9MC4zCmN5PTAuMzUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAK "examples/22-off-center.milk")

Moving the pivot breaks the symmetry — the vortex leans, and trails on the far side travel farther per frame than trails near the pivot. Run both and watch how different the same `rot` feels.

## Lesson 3 · `dx`, `dy` — the push

```text
dx=0.003
dy=-0.002
```

[**▶ Run the drift**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wLjAwMwpkeT0tMC4wMDIKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/23-drift.milk")

`dx`/`dy` slide the whole previous frame sideways each frame, in screen fractions. Run it and note which way the image travels versus the signs — the vertical axis in particular will surprise you once here so it never surprises you again. Constant small values give wind; audio-driven values (Track 3) give shoves on the beat.

## Lesson 4 · `sx`, `sy` — the stretch

```text
sx=1.02
sy=0.98
```

[**▶ Run the stretch**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MS4wMgpzeT0wLjk4CndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/24-stretch.milk")

Per-axis scaling: this pair widens history 2% per frame while squashing it vertically. It's `zoom` with an opinion about direction — good for flames (stretch up), water (stretch sideways), and funhouse smears.

## Lesson 5 · `warp` — the wobble

```text
warp=0.2
fWarpAnimSpeed=1
fWarpScale=1.5
```

[**▶ Run the wobble**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MC4yCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCmZXYXJwQW5pbVNwZWVkPTEKZldhcnBTY2FsZT0xLjUK "examples/25-warp.milk")

`warp` displaces the previous frame through a built-in animated noise field — instant liquid. `fWarpAnimSpeed` sets how fast the field churns, and `fWarpScale` how large its blobs are.

> **The classic beginner trap:** `warp=1` plus high `decay` turns everything into brown smudge within seconds — the noise field stirs the paint and nothing erases it. Experienced authors keep `warp` low or zero and build distortion with per-pixel equations instead, where *they* control the field. The [anti-pattern table](../MILKDROP_CODING_GUIDE.md#anti-patterns) has the full list.

## Lesson 6 · Combining knobs

One knob is a demo; a preset is a negotiation between several. This one uses everything from this track plus a `per_frame` block:

```text
fDecay=0.97
zoom=1.008
per_frame_1=rot = 0.008 + 0.004*sin(time*0.13);
per_frame_2=wave_r = wave_r + 0.25*(0.6*sin(0.98*time) + 0.4*sin(1.047*time));
per_frame_3=wave_g = wave_g + 0.25*(0.6*sin(0.835*time) + 0.4*sin(1.081*time));
per_frame_4=wave_b = wave_b + 0.25*(0.6*sin(0.814*time) + 0.4*sin(1.011*time));
```

[**▶ Run the gentle vortex**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDA4CnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX2ZyYW1lXzE9cm90ID0gMC4wMDggKyAwLjAwNCpzaW4odGltZSowLjEzKTsKcGVyX2ZyYW1lXzI9d2F2ZV9yID0gd2F2ZV9yICsgMC4yNSooMC42KnNpbigwLjk4KnRpbWUpICsgMC40KnNpbigxLjA0Nyp0aW1lKSk7CnBlcl9mcmFtZV8zPXdhdmVfZyA9IHdhdmVfZyArIDAuMjUqKDAuNipzaW4oMC44MzUqdGltZSkgKyAwLjQqc2luKDEuMDgxKnRpbWUpKTsKcGVyX2ZyYW1lXzQ9d2F2ZV9iID0gd2F2ZV9iICsgMC4yNSooMC42KnNpbigwLjgxNCp0aW1lKSArIDAuNCpzaW4oMS4wMTEqdGltZSkpOwo%3D "examples/26-gentle-vortex.milk")

Line by line:

- `per_frame_1` — the spiral's twist is not constant: it drifts between `0.004` and `0.012` on a slow sine (`time*0.13` ≈ one swing per 48 s). The motion never settles, so the eye never files it away.
- `per_frame_2–4` — each color channel wanders on a *sum of two sines at unrelated frequencies* (`0.98` vs `1.047`, …). Irrational-ratio frequencies never realign, so the palette never repeats. This is **color cycling with irrational frequencies** — [Pattern 5 in the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-5-color-cycling-with-irrational-frequencies), and a Geiss signature you'll see next.

**Turn one knob.** Make the vortex violent: shorten `decay`, raise the `rot` swing, and speed up the color sines. Then make it glacial. The same six lines cover the whole mood spectrum.

## Lesson 7 · Dissection: *Geiss — Happy Drops* (Ryan Geiss)

Time to read a real one. This ships in the Stims catalog and is old enough to drink. Its six `per_frame` lines are pure Track 2 material; its three `per_pixel` lines are a preview of Tracks 3 and 4.

[**▶ Open Happy Drops in the editor**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQpmUmF0aW5nPTUuMDAwMDAwCmZHYW1tYUFkaj0xLjk5NApmRGVjYXk9MC45OApmVmlkZW9FY2hvWm9vbT0yCmZWaWRlb0VjaG9BbHBoYT0wCm5WaWRlb0VjaG9PcmllbnRhdGlvbj0wCm5XYXZlTW9kZT0yCmJBZGRpdGl2ZVdhdmVzPTEKYldhdmVEb3RzPTAKYldhdmVUaGljaz0xCmJNb2RXYXZlQWxwaGFCeVZvbHVtZT0wCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKYkRhcmtlbkNlbnRlcj0wCmJSZWRCbHVlU3RlcmVvPTAKYkJyaWdodGVuPTAKYkRhcmtlbj0wCmJTb2xhcml6ZT0wCmJJbnZlcnQ9MApmV2F2ZUFscGhhPTAuNDIKZldhdmVTY2FsZT0wLjY5MTM1OApmV2F2ZVNtb290aGluZz0wLjQKZldhdmVQYXJhbT0wCmZNb2RXYXZlQWxwaGFTdGFydD0wLjc1CmZNb2RXYXZlQWxwaGFFbmQ9MC45NQpmV2FycEFuaW1TcGVlZD0xCmZXYXJwU2NhbGU9MQpmWm9vbUV4cG9uZW50PTAuODg4CmZTaGFkZXI9MQp6b29tPTAuOTk5NzEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKd2FycD0wLjI5ODgxNgpzeD0xCnN5PTEKd2F2ZV9yPTAuNjUKd2F2ZV9nPTAuNjUKd2F2ZV9iPTAuNjUKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX3NpemU9MC4wMQpvYl9yPTAKb2JfZz0wCm9iX2I9MApvYl9hPTAKaWJfc2l6ZT0wLjAxCmliX3I9MC4yNQppYl9nPTAuMjUKaWJfYj0wLjI1CmliX2E9MApuTW90aW9uVmVjdG9yc1g9MTIKbk1vdGlvblZlY3RvcnNZPTkKbXZfZHg9MAptdl9keT0wCm12X2w9MC45Cm12X3I9MQptdl9nPTEKbXZfYj0xCm12X2E9MApwZXJfZnJhbWVfMT13YXZlX3IgPSB3YXZlX3IgKyAwLjM1MCooIDAuNjAqc2luKDAuNzQyKnRpbWUpICsgMC40MCpzaW4oMS4wMjEqdGltZSkgKTsKcGVyX2ZyYW1lXzI9d2F2ZV9nID0gd2F2ZV9nICsgMC4zNTAqKCAwLjYwKnNpbigwLjcwMyp0aW1lKSArIDAuNDAqc2luKDAuOTY5KnRpbWUpICk7CnBlcl9mcmFtZV8zPXdhdmVfYiA9IHdhdmVfYiArIDAuMzUwKiggMC42MCpzaW4oMS4wOTAqdGltZSkgKyAwLjQwKnNpbigwLjk2Myp0aW1lKSApOwpwZXJfZnJhbWVfND1yb3QgPSByb3QgKyAwLjA0MCooIDAuNjAqc2luKDAuMzgxKnRpbWUpICsgMC40MCpzaW4oMC4yNzkqdGltZSkgKTsKcGVyX2ZyYW1lXzU9Y3ggPSBjeCArIDAuMTEwKiggMC42MCpzaW4oMC4zNzQqdGltZSkgKyAwLjQwKnNpbigwLjI5NCp0aW1lKSApOwpwZXJfZnJhbWVfNj1jeSA9IGN5ICsgMC4xMTAqKCAwLjYwKnNpbigwLjM5Myp0aW1lKSArIDAuNDAqc2luKDAuMjIzKnRpbWUpICk7CnBlcl9waXhlbF8xPWRyID0gMC4wMSArIDAuMDMqbWluKG1heChiYXNzX2F0dC0xLDAuMCksIDAuNSkqc2luKHJhZCoxNSk7CnBlcl9waXhlbF8yPWR4ID0gZHggKyBkcipjb3MoYW5nKSowLjc1OwpwZXJfcGl4ZWxfMz1keSA9IGR5ICsgZHIqc2luKC1hbmcpOwo%3D "public/milkdrop-presets/libraries/projectm-cream-of-the-crop/geiss-happy-drops.milk") · [Watch it in the app](https://toil.fyi/?preset=geiss-happy-drops)

The lines that matter (the rest of the file is default housekeeping):

```text
fDecay=0.98
warp=0.298816
rot=0
wave_r=0.65
wave_g=0.65
wave_b=0.65
per_frame_1=wave_r = wave_r + 0.350*( 0.60*sin(0.742*time) + 0.40*sin(1.021*time) );
per_frame_2=wave_g = wave_g + 0.350*( 0.60*sin(0.703*time) + 0.40*sin(0.969*time) );
per_frame_3=wave_b = wave_b + 0.350*( 0.60*sin(1.090*time) + 0.40*sin(0.963*time) );
per_frame_4=rot = rot + 0.040*( 0.60*sin(0.381*time) + 0.40*sin(0.279*time) );
per_frame_5=cx = cx + 0.110*( 0.60*sin(0.374*time) + 0.40*sin(0.294*time) );
per_frame_6=cy = cy + 0.110*( 0.60*sin(0.393*time) + 0.40*sin(0.223*time) );
per_pixel_1=dr = 0.01 + 0.03*min(max(bass_att-1,0.0), 0.5)*sin(rad*15);
per_pixel_2=dx = dx + dr*cos(ang)*0.75;
per_pixel_3=dy = dy + dr*sin(-ang);
```

- `per_frame_1`–`per_frame_3` — Lesson 6's irrational-frequency color drift at full strength. Each channel swings `0.35` either side of a neutral `0.65`, so red, green, and blue each wander between `0.3` and `1.0` on their own unrelated sines, and the palette never repeats.
- `per_frame_4` — the same two-sine trick applied to motion. The file's base `rot` is `0`, so the twist wanders between `-0.04` and `0.04`: at its peak twice your spiral's `0.02`, but it keeps reversing (each sine takes 16–23 seconds per cycle), so it never settles into a plain spiral.
- `per_frame_5`/`per_frame_6` — the pivot from Lesson 2, set wandering. `cx` and `cy` each drift up to `0.11` from center, so the point the rotation turns around slides slowly around the middle of the screen.
- `per_pixel_1`–`per_pixel_3` — the preview. These lines run *per mesh point*, and `rad`/`ang` are each point's distance and direction from the screen center. `dr` pushes every point about `0.01` outward along its own radial line each frame — a steady outward stream, like a gentle `zoom`. On top of that, `bass_att-1` is how far the bass sits above its average, clamped to `0–0.5`: in quiet passages it is zero, but on a bass hit `sin(rad*15)` adds alternating bands of stronger and weaker push across the radius. Those bands, smeared outward by the feedback loop, are the drops. Track 3 covers `bass_att`; making knobs vary across the screen is all of [Track 4](04-warp-fields.md).

**Exercise.** Remix Happy Drops (**Remix** in the editor's **⋯** menu preserves the credit lineage): cool the palette by lowering the base `wave_r` to `0.3` and its swing to `0.15`, give `rot` a base of `0.05` so the twist keeps one direction, and turn the stream inward by changing `0.01` to `-0.01` in `per_pixel_1`. Export it, or copy the URL — the link is the preset.

## What you can now read

Most of the pre-2007 classics keep their motion in `per_frame`, and any preset that does is now legible to you: find the knobs, find the sines driving them, find the eraser.

**Next: [Track 3 — Listening](03-listening.md)**, where `sin(time)` gives way to the music.
