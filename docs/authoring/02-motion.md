# Track 2 — Motion

Every knob in this track answers the same question: *where does the previous frame get redrawn?* You already know `zoom`. Here are the rest, one at a time on [the bench](01-how-milkdrop-thinks.md), then combined, then read in the wild.

## Lesson 1 · `zoom`, pushed harder

```text
zoom=1.04
```

[**▶ Run the tunnel rush**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDQKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/20-zoom-rush.milk")

At 4% per frame the compounding stops being subtle: this is the classic flying-through-a-tunnel move. Above `1` flies outward, below `1` falls inward, and the distance from `1` is speed. Almost every preset keeps it within `0.9–1.1`; the drama comes from *changing* it (as in Lesson 4 of Track 1), not from large constants.

## Lesson 2 · `rot` and the pivot

```text
zoom=1.01
rot=0.02
```

[**▶ Run the spiral**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAuMDIKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/21-spiral.milk")

`rot` rotates the previous frame by a fixed angle (in radians) each frame. On its own it smears history into rings. Combined with outward `zoom` it makes the signature MilkDrop move: the spiral — every trail is simultaneously growing and turning.

Rotation happens around the pivot `cx, cy` (screen fractions, `0.5,0.5` is dead center):

```text
cx=0.3
cy=0.35
```

[**▶ Run the off-center spiral**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAuMDIKY3g9MC4zCmN5PTAuMzUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAK "examples/22-off-center.milk")

Moving the pivot breaks the symmetry — the vortex leans, and trails on the far side travel farther per frame than trails near the pivot. Run both and watch how different the same `rot` feels.

## Lesson 3 · `dx`, `dy` — the push

```text
dx=0.003
dy=-0.002
```

[**▶ Run the drift**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wLjAwMwpkeT0tMC4wMDIKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/23-drift.milk")

`dx`/`dy` slide the whole previous frame sideways each frame, in screen fractions. Run it and note which way the image travels versus the signs — the vertical axis in particular will surprise you once here so it never surprises you again. Constant small values give wind; audio-driven values (Track 3) give shoves on the beat.

## Lesson 4 · `sx`, `sy` — the stretch

```text
sx=1.02
sy=0.98
```

[**▶ Run the stretch**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MS4wMgpzeT0wLjk4CndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/24-stretch.milk")

Per-axis scaling: this pair widens history 2% per frame while squashing it vertically. It's `zoom` with an opinion about direction — good for flames (stretch up), water (stretch sideways), and funhouse smears.

## Lesson 5 · `warp` — the wobble

```text
warp=0.2
fWarpAnimSpeed=1
fWarpScale=1.5
```

[**▶ Run the wobble**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MC4yCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCmZXYXJwQW5pbVNwZWVkPTEKZldhcnBTY2FsZT0xLjUK "examples/25-warp.milk")

`warp` displaces the previous frame through a built-in animated noise field — instant liquid. `fWarpAnimSpeed` sets how fast the field churns, `fWarpScale` how large its blobs are.

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

[**▶ Run the gentle vortex**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGVzc29uIGJlbmNoOiBhIGJyaWdodCB3YXZlZm9ybSwgbm8gbW90aW9uLCBub3RoaW5nIGhpZGRlbi4KLy8gRXZlcnkgVHJhY2sgMSBhbmQgVHJhY2sgMiBleGFtcGxlIGlzIHRoaXMgZmlsZSB3aXRoIG9uZSBvciB0d28gbGluZXMgY2hhbmdlZC4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDA4CnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX2ZyYW1lXzE9cm90ID0gMC4wMDggKyAwLjAwNCpzaW4odGltZSowLjEzKTsKcGVyX2ZyYW1lXzI9d2F2ZV9yID0gd2F2ZV9yICsgMC4yNSooMC42KnNpbigwLjk4KnRpbWUpICsgMC40KnNpbigxLjA0Nyp0aW1lKSk7CnBlcl9mcmFtZV8zPXdhdmVfZyA9IHdhdmVfZyArIDAuMjUqKDAuNipzaW4oMC44MzUqdGltZSkgKyAwLjQqc2luKDEuMDgxKnRpbWUpKTsKcGVyX2ZyYW1lXzQ9d2F2ZV9iID0gd2F2ZV9iICsgMC4yNSooMC42KnNpbigwLjgxNCp0aW1lKSArIDAuNCpzaW4oMS4wMTEqdGltZSkpOwo%3D "examples/26-gentle-vortex.milk")

Line by line:

- `per_frame_1` — the spiral's twist is not constant: it drifts between `0.004` and `0.012` on a slow sine (`time*0.13` ≈ one swing per 48 s). The motion never settles, so the eye never files it away.
- `per_frame_2–4` — each color channel wanders on a *sum of two sines at unrelated frequencies* (`0.98` vs `1.047`, …). Irrational-ratio frequencies never realign, so the palette never repeats. This is **color cycling with irrational frequencies** — [Pattern 5 in the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-5-color-cycling-with-irrational-frequencies), and a Geiss signature you'll see next.

**Turn one knob.** Make the vortex violent: shorten `decay`, raise the `rot` swing, speed up the color sines. Then make it glacial. The same six lines cover the whole mood spectrum.

## Lesson 7 · Dissection: *Geiss — Happy Drops* (Ryan Geiss)

Time to read a real one. This ships in the Stims catalog and is old enough to drink — it's pure Track 1–2 material plus exactly one line of foreshadowing.

[**▶ Open Happy Drops in the editor**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQpmUmF0aW5nPTUuMDAwMDAwCmZHYW1tYUFkaj0xLjk5NApmRGVjYXk9MC45OApmVmlkZW9FY2hvWm9vbT0yCmZWaWRlb0VjaG9BbHBoYT0wCm5WaWRlb0VjaG9PcmllbnRhdGlvbj0wCm5XYXZlTW9kZT0yCmJBZGRpdGl2ZVdhdmVzPTEKYldhdmVEb3RzPTAKYldhdmVUaGljaz0xCmJNb2RXYXZlQWxwaGFCeVZvbHVtZT0wCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKYkRhcmtlbkNlbnRlcj0wCmJSZWRCbHVlU3RlcmVvPTAKYkJyaWdodGVuPTAKYkRhcmtlbj0wCmJTb2xhcml6ZT0wCmJJbnZlcnQ9MApmV2F2ZUFscGhhPTAuNDIKZldhdmVTY2FsZT0wLjY5MTM1OApmV2F2ZVNtb290aGluZz0wLjQKZldhdmVQYXJhbT0wCmZNb2RXYXZlQWxwaGFTdGFydD0wLjc1CmZNb2RXYXZlQWxwaGFFbmQ9MC45NQpmV2FycEFuaW1TcGVlZD0xCmZXYXJwU2NhbGU9MQpmWm9vbUV4cG9uZW50PTAuODg4CmZTaGFkZXI9MQp6b29tPTAuOTk5NzEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKd2FycD0wLjI5ODgxNgpzeD0xCnN5PTEKd2F2ZV9yPTAuNjUKd2F2ZV9nPTAuNjUKd2F2ZV9iPTAuNjUKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX3NpemU9MC4wMQpvYl9yPTAKb2JfZz0wCm9iX2I9MApvYl9hPTAKaWJfc2l6ZT0wLjAxCmliX3I9MC4yNQppYl9nPTAuMjUKaWJfYj0wLjI1CmliX2E9MApuTW90aW9uVmVjdG9yc1g9MTIKbk1vdGlvblZlY3RvcnNZPTkKbXZfZHg9MAptdl9keT0wCm12X2w9MC45Cm12X3I9MQptdl9nPTEKbXZfYj0xCm12X2E9MApwZXJfZnJhbWVfMT13YXZlX3IgPSB3YXZlX3IgKyAwLjM1MCooIDAuNjAqc2luKDAuNzQyKnRpbWUpICsgMC40MCpzaW4oMS4wMjEqdGltZSkgKTsKcGVyX2ZyYW1lXzI9d2F2ZV9nID0gd2F2ZV9nICsgMC4zNTAqKCAwLjYwKnNpbigwLjcwMyp0aW1lKSArIDAuNDAqc2luKDAuOTY5KnRpbWUpICk7CnBlcl9mcmFtZV8zPXdhdmVfYiA9IHdhdmVfYiArIDAuMzUwKiggMC42MCpzaW4oMS4wOTAqdGltZSkgKyAwLjQwKnNpbigwLjk2Myp0aW1lKSApOwpwZXJfZnJhbWVfND1yb3QgPSByb3QgKyAwLjA0MCooIDAuNjAqc2luKDAuMzgxKnRpbWUpICsgMC40MCpzaW4oMC4yNzkqdGltZSkgKTsKcGVyX2ZyYW1lXzU9Y3ggPSBjeCArIDAuMTEwKiggMC42MCpzaW4oMC4zNzQqdGltZSkgKyAwLjQwKnNpbigwLjI5NCp0aW1lKSApOwpwZXJfZnJhbWVfNj1jeSA9IGN5ICsgMC4xMTAqKCAwLjYwKnNpbigwLjM5Myp0aW1lKSArIDAuNDAqc2luKDAuMjIzKnRpbWUpICk7CnBlcl9waXhlbF8xPWRyID0gMC4wMSArIDAuMDMqbWluKG1heChiYXNzX2F0dC0xLDAuMCksIDAuNSkqc2luKHJhZCoxNSk7CnBlcl9waXhlbF8yPWR4ID0gZHggKyBkcipjb3MoYW5nKSowLjc1OwpwZXJfcGl4ZWxfMz1keSA9IGR5ICsgZHIqc2luKC1hbmcpOwo%3D "public/milkdrop-presets/libraries/projectm-cream-of-the-crop/geiss-happy-drops.milk") · [Watch it in the app](https://toil.fyi/?preset=geiss-happy-drops)

The lines that matter (the rest of the file is default housekeeping):

```text
fDecay=0.98
rot=0.00744
bWaveThick=1
bMaximizeWaveColor=1
wave_r=0.9
wave_g=0.45
wave_b=0
per_frame_1=wave_r = wave_r + 0.100*( 0.60*sin(0.933*time) + 0.40*sin(1.045*time) );
per_frame_2=wave_g = wave_g + 0.050*( 0.60*sin(0.900*time) + 0.40*sin(0.956*time) );
per_frame_3=decay = decay - 0.01*equal(frame%40,0);
per_pixel_1=zoom=0.9615+rad*0.1;
```

- `rot=0.00744` — a twist so slow you feel it rather than see it. Compare your own spiral's `0.02`: Geiss is running at a third of your gentlest setting. Restraint is a recurring master move.
- `per_frame_1`/`per_frame_2` — the same irrational-frequency color drift you just wrote, tuned warm: red wanders twice as far as green (`0.100` vs `0.050`) and blue stays at its base `0`, so the palette lives between ember-orange and gold and never leaves.
- `per_frame_3` — the sneaky one. `equal(frame%40,0)` is `1` on every 40th frame and `0` otherwise, so `decay` dips from `0.98` to `0.97` for a single frame — a metronome tick of extra fade, about every two-thirds of a second, that keeps the accumulated paint from ever going stale. A conditional built from arithmetic: there is no `if` statement in sight, and you'll write beats the same way in Track 3.
- `per_pixel_1` — the foreshadow. This line runs *per mesh point*, and `rad` is each point's distance from center: so `zoom` is `0.96` at the center (falling inward) rising past `1.0` toward the edges (streaming outward). One line, two opposing currents — that's why the drops seem to *rain* toward the middle while the edges glow outward. Making knobs vary across the screen is all of [Track 4], and this is its simplest useful sentence.

**Exercise.** Remix Happy Drops (the editor's Remix button preserves the credit lineage): cool the palette to blues, retime the decay tick to `frame%15`, and flip the per-pixel current (`zoom=1.04-rad*0.1`). Export it, or copy the URL — the link is the preset.

## What you can now read

Any preset whose motion lives in `per_frame` — which includes most of the pre-2007 classics — is now legible to you: find the knobs, find the sines driving them, find the eraser. **Next up: Track 3 — Listening**, where `sin(time)` gives way to the music.
