# Track 6 — Shaders

Everything through Track 5 is EEL: small equations evaluated by the VM, with eligible per-pixel and wave-point programs lowered to the GPU on WebGPU. Shaders differ in kind as well as syntax: code that runs on the GPU, once per _screen pixel_, every frame. This is where reaction-diffusion, edge detection, and fractal iteration live: effects that need every pixel to see its neighbors. EEL's per-pixel context can't do that.

**Of the 1,787 catalog presets, 1,060 (59%) carry both a warp and a composite shader, and 1,201 (67%) carry at least one** (non-empty `[warp_shader]`/`[comp_shader]` or `warp_N`/`comp_N` source, counted October 2026).

The written material has not kept up: the [authoring docs assessment](../archive/PRESET_AUTHORING_DOCS_PLAN.md) found about two worked shader examples in Geiss's authoring guide, the one complete reference, and the best-known beginners' tutorial predates shaders. Each of the five lessons below is a worked example you can run.

## Lesson 0 · A language note, stated plainly

MilkDrop's original shaders are HLSL (DirectX). Stims normalizes supported HLSL-style types, calls, and shader bodies into its shader representation, then emits GLSL for WebGL or executes supported statements through WebGPU materials. The lessons use GLSL-style notation, so MilkDrop's `float2` and `tex2D(sampler_main, uv).xyz` appear here as `vec2` and `texture2D(sampler_main, uv).rgb`. They are not a claim of full HLSL or GLSL support. Matrix locals and selected explicit LOD/gradient sampling paths are supported, with backend-specific limits. Use the studio's Compat and Shader diagnostics for the source you actually load; see [Shipping](./08-shipping.md#compatibility-matrix).

## Lesson 1 · The smallest possible warp shader

```text
[warp_shader]
ret = texture2D(sampler_main, uv).rgb;
ret *= 0.98;
```

[**▶ Run the identity warp**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgc21hbGxlc3QgcG9zc2libGUgd2FycF9zaGFkZXI6IHJlYWQgdGhlIHByZXZpb3VzIGZyYW1lIGF0IHV2LCBmYWRlCi8vIGl0LCBhbmQgd3JpdGUgdGhlIGNvbG9yIHRvIHJldC4gVGhlIHNoYWRlcmxlc3MgYmVuY2ggZG9lcyB0aGUgc2FtZQovLyByZWFkIHdpdGggZkRlY2F5PTAuOTggYXMgaXRzIGZhZGUuIE1pbGtEcm9wIHNraXBzIGZEZWNheSBvbmNlIGEgcHJlc2V0Ci8vIGhhcyBhIHdhcnAgc2hhZGVyLCBzbyBmRGVjYXkgaXMgMSBoZXJlIGFuZCByZXQgKj0gMC45OCBpcyB0aGUgZmFkZS4KZlJhdGluZz01CmZEZWNheT0xCmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApbd2FycF9zaGFkZXJdCnJldCA9IHRleHR1cmUyRChzYW1wbGVyX21haW4sIHV2KS5yZ2I7CnJldCAqPSAwLjk4Owo%3D "examples/61-warp-shader-identity.milk")

Compare this against [the shaderless bench](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgYmVuY2gsIHVuY2hhbmdlZCDigJQgbm8gc2hhZGVyIGJsb2NrcyB5ZXQuIFRyYWNrIDYncyBiZWZvcmUtc2hvdC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/60-shader-baseline.milk"); they should look identical, because these two lines are MilkDrop's default warp with the bench's `fDecay=0.98` written in.

A warp shader runs once per pixel and answers one question: what color does this pixel carry into the next frame? Three names do the work:
- `sampler_main` is the previous frame.
- `uv` is the point in that frame this pixel reads from. The motion from Tracks 2 and 4 (`zoom`, `rot`, `dx`, `dy`, `warp` and their per-pixel forms) has already moved it; the bench holds all of those at rest, so here `uv` is the pixel's own position.
- `ret` is the answer: a color (`vec3`), not a coordinate. Waves and shapes are drawn over it, and the result is the next frame's `sampler_main`.

The second line is the fade. Once a preset has its own warp shader, MilkDrop stops applying `fDecay` and the shader writes the fade itself; the example sets `fDecay=1` so its header doesn't claim a fade that isn't running. Delete `ret *= 0.98;` and nothing fades: every waveform the bench has drawn stays on screen.

Writing a coordinate to `ret`, as in `ret = uv;`, is the mistake to avoid. HLSL rejects it, and the Stims editor marks the line as an error and suggests the `texture2D` read to write instead.

## Lesson 2 · Distorting the sample coordinate

```text
vec2 center = uv - vec2(0.5, 0.5);
float dist = length(center);
float ripple = 0.01 * sin(dist * 40.0 - time * 2.0);
vec2 dir = center / (dist + 0.0001);
ret = texture2D(sampler_main, uv + dir * ripple).rgb;
ret *= 0.98;
```

[**▶ Run the ripple**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBBIHJpcHBsZTogcmVhZCB0aGUgcHJldmlvdXMgZnJhbWUgYXQgYSBjb29yZGluYXRlIHB1c2hlZCBhbG9uZyBhIHNpbmUgb2YKLy8gZGlzdGFuY2UgZnJvbSBjZW50ZXIuIFNhbWUgaWRlYSBhcyBUcmFjayA0J3MgcmluZ3MsIHdyaXR0ZW4gaW4gR0xTTCBhbmQKLy8gcnVuIHBlciBwaXhlbCBvbiB0aGUgR1BVLiBUaGUgc2hhZGVyIG93bnMgdGhlIGZhZGUsIHNvIGZEZWNheSBpcyAxLgpmUmF0aW5nPTUKZkRlY2F5PTEKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wClt3YXJwX3NoYWRlcl0KdmVjMiBjZW50ZXIgPSB1diAtIHZlYzIoMC41LCAwLjUpOwpmbG9hdCBkaXN0ID0gbGVuZ3RoKGNlbnRlcik7CmZsb2F0IHJpcHBsZSA9IDAuMDEgKiBzaW4oZGlzdCAqIDQwLjAgLSB0aW1lICogMi4wKTsKdmVjMiBkaXIgPSBjZW50ZXIgLyAoZGlzdCArIDAuMDAwMSk7CnJldCA9IHRleHR1cmUyRChzYW1wbGVyX21haW4sIHV2ICsgZGlyICogcmlwcGxlKS5yZ2I7CnJldCAqPSAwLjk4Owo%3D "examples/62-warp-shader-ripple.milk")

This is Track 4's radial-rings trick, rewritten for the GPU:
- `center`/`dist` — the same recentering move as Track 4's off-center-current lesson, written with GLSL's `vec2`/`length()` instead of hand-rolled `sqrt(x*x+y*y)`.
- `ripple` — a sine of distance, the same idea as `sin(rad*12+time*0.5)` in EEL; the coefficient on `dist` sets how many rings fit, and the coefficient on `time` sets their speed. The minus sign sends these rings outward, the opposite of Track 4's `+time`.
- `dir = center / (dist + 0.0001)` — a unit vector pointing away from center; the `+0.0001` is the same divide-by-zero guard Track 4's off-center lesson used, now in GLSL.
- `texture2D(sampler_main, uv + dir * ripple)` — read the previous frame a short way along that direction instead of at `uv`. This is what "warp" means concretely: you're not moving pixels; you're changing _which_ previous-frame pixel gets sampled into this one.
- `ret *= 0.98` — Lesson 1's fade, which every warp shader writes for itself.

The displacement compounds. Each frame reads from a picture the last frame already displaced, so the rings drag the waveform's trails into radial streaks, where a single displaced read would only make the waveform wobble.

The EEL and GLSL versions of the same idea read almost identically once you know the vocabulary swap: `rad`/`ang` become `length()`/normalize-by-division, and `dx`/`dy` become an offset added to `uv` before the read.

## Lesson 3 · The smallest possible composite shader

```text
[comp_shader]
vec3 c = texture2D(sampler_main, uv).rgb;
ret = c * vec3(1.0, 0.85, 0.6);
```

[**▶ Run the tint**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgc21hbGxlc3QgcG9zc2libGUgY29tcF9zaGFkZXI6IHNhbXBsZSB0aGUgY29tcG9zaXRlZCBmcmFtZSBhbmQKLy8gdGludCBpdC4gY29tcF9zaGFkZXIgcnVucyBhZnRlciB3YXZlcy9zaGFwZXMgYXJlIGRyYXduLCBzbyB0aGlzCi8vIGNvbG9ycyBldmVyeXRoaW5nIFRyYWNrcyAxLTUgYWxyZWFkeSBwdXQgb24gc2NyZWVuLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCltjb21wX3NoYWRlcl0KdmVjMyBjID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYpLnJnYjsKcmV0ID0gYyAqIHZlYzMoMS4wLCAwLjg1LCAwLjYpOwo%3D "examples/63-comp-shader-tint.milk")

`comp_shader` runs _after_ the warp shader and after waves/shapes are drawn — it's the last stop before the pixel hits the screen. `sampler_main` is the composited frame so far; `texture2D(sampler_main, uv).rgb` reads this pixel's color. Multiplying by `vec3(1.0, 0.85, 0.6)` is a tone-map: full red, 85% green, and 60% blue — a warm amber grade over everything Tracks 1–5 already produced.

Both shaders write a color to `ret`; what differs is where it goes. A warp shader's `ret` becomes the next frame's starting picture, so its changes compound frame after frame. A comp shader's `ret` goes to the screen and nowhere else, so the amber grade is applied once per frame and never builds up.

## Lesson 4 · Reading neighbors — the thing EEL can't do

```text
float dx = texture2D(sampler_main, uv + vec2(1.0 / texsize.x, 0.0)).x - texture2D(sampler_main, uv + vec2(-1.0 / texsize.x, 0.0)).x;
float dy = texture2D(sampler_main, uv + vec2(0.0, 1.0 / texsize.y)).x - texture2D(sampler_main, uv + vec2(0.0, -1.0 / texsize.y)).x;
float edge = length(vec2(dx, dy)) * 6.0;
vec3 sharpv = texture2D(sampler_main, uv).rgb;
vec3 blurred = texture2D(sampler_blur1, uv).rgb;
ret = abs(sharpv - blurred) * edge;
```

[**▶ Run edge detection**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBQYXR0ZXJuIDEwIGZyb20gdGhlIGNvZGluZyBndWlkZTogZWRnZSBkZXRlY3Rpb24gdmlhIGEgNC1uZWlnaGJvcgovLyBncmFkaWVudCwgdGhlbiBhIGhpZ2gtcGFzcyAoc2hhcnAgbWludXMgYmx1cnJlZCkgdG8gcGljayBvdXQgZGV0YWlsLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MS4wMQpyb3Q9MC4wMQpjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCltjb21wX3NoYWRlcl0KZmxvYXQgZHggPSB0ZXh0dXJlMkQoc2FtcGxlcl9tYWluLCB1diArIHZlYzIoMS4wIC8gdGV4c2l6ZS54LCAwLjApKS54IC0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYgKyB2ZWMyKC0xLjAgLyB0ZXhzaXplLngsIDAuMCkpLng7CmZsb2F0IGR5ID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYgKyB2ZWMyKDAuMCwgMS4wIC8gdGV4c2l6ZS55KSkueCAtIHRleHR1cmUyRChzYW1wbGVyX21haW4sIHV2ICsgdmVjMigwLjAsIC0xLjAgLyB0ZXhzaXplLnkpKS54OwpmbG9hdCBlZGdlID0gbGVuZ3RoKHZlYzIoZHgsIGR5KSkgKiA2LjA7CnZlYzMgc2hhcnB2ID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYpLnJnYjsKdmVjMyBibHVycmVkID0gdGV4dHVyZTJEKHNhbXBsZXJfYmx1cjEsIHV2KS5yZ2I7CnJldCA9IGFicyhzaGFycHYgLSBibHVycmVkKSAqIGVkZ2U7Cg%3D%3D "examples/64-comp-shader-edge.milk") — [Pattern 10 from the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-10-edge-detection-compositing).

`texsize` is the render target's pixel dimensions, so `1.0 / texsize.x` is exactly one texel's width. `dx`/`dy` here sample one texel to each side and subtract — a gradient. Where the image is flat, both differences are near zero; where there's a hard edge, one of them spikes. `length(vec2(dx, dy))` combines both directions into a single edge strength.

The second half is a **high-pass filter**: `sampler_blur1` is a pre-blurred version of the same frame that Stims computes for you every frame (part of the built-in blur chain, alongside `blur2`/`blur3` at increasing radii). `sharpv - blurred` cancels out everything low-frequency (broad color regions) and leaves only fine detail — multiplying that by `edge` picks out detail specifically at hard boundaries. This is the one thing this entire track exists for: **no EEL context — not even per-pixel — can read a neighboring pixel's value.** Only a shader can, because only the shader runs after the whole frame already exists.

## Lesson 5 · Crossing the q-var bridge into GLSL

The same bridge from Tracks 4 and 5 — smooth in `per_frame`, write a q-var — works into shaders too. `q1`–`q8` (and up to `q32`) are available as float uniforms inside both `warp_shader` and `comp_shader`:

```text
per_frame_1=ra=6/fps;
per_frame_2=bass_avg=bass_avg*(1-ra)+ra*bass;
per_frame_3=q1=bass_avg;
[warp_shader]
vec2 center = uv - vec2(0.5, 0.5);
float dist = length(center);
float ripple = (0.005 + 0.02 * q1) * sin(dist * 40.0 - time * 2.0);
vec2 dir = center / (dist + 0.0001);
ret = texture2D(sampler_main, uv + dir * ripple).rgb;
ret *= 0.98;
```

[**▶ Run the audio-reactive ripple**](https://toil.fyi/?tool=editor#code=u1~W3ByZXNldDAwXQovLyBUaGUgcmlwcGxlLCBub3cgZHJpdmVuIGJ5IGF1ZGlvOiBwZXJfZnJhbWUgc21vb3RocyBiYXNzIGludG8gcTEsIGFuZAovLyB0aGUgd2FycCBzaGFkZXIgcmVhZHMgcTEgYXMgYSB1bmlmb3JtIGZsb2F0LiBUaGUgc2FtZSBxLXZhciBicmlkZ2UKLy8gZnJvbSBUcmFjayA0LCBjcm9zc2luZyBmcm9tIEVFTCBpbnRvIEdMU0wgdGhpcyB0aW1lLgpmUmF0aW5nPTUKZkRlY2F5PTEKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCnBlcl9mcmFtZV8xPXJhPTYvZnBzOwpwZXJfZnJhbWVfMj1iYXNzX2F2Zz1iYXNzX2F2ZyooMS1yYSkrcmEqYmFzczsKcGVyX2ZyYW1lXzM9cTE9YmFzc19hdmc7Clt3YXJwX3NoYWRlcl0KdmVjMiBjZW50ZXIgPSB1diAtIHZlYzIoMC41LCAwLjUpOwpmbG9hdCBkaXN0ID0gbGVuZ3RoKGNlbnRlcik7CmZsb2F0IHJpcHBsZSA9ICgwLjAwNSArIDAuMDIgKiBxMSkgKiBzaW4oZGlzdCAqIDQwLjAgLSB0aW1lICogMi4wKTsKdmVjMiBkaXIgPSBjZW50ZXIgLyAoZGlzdCArIDAuMDAwMSk7CnJldCA9IHRleHR1cmUyRChzYW1wbGVyX21haW4sIHV2ICsgZGlyICogcmlwcGxlKS5yZ2I7CnJldCAqPSAwLjk4Owo%3D "examples/65-warp-shader-reactive.milk")

Nothing new syntactically — `q1` is read on the GLSL side exactly like any other identifier, because to the shader it is a uniform the compiler wires up automatically. Shaders can read the raw bands too: `bass`, `mid`, `treb` and their `_att` forms are uniforms, and the shaders in [_Mashup (326)_](https://toil.fyi/?preset=royal-mashup-326) read `mid_att` and `treb_att`. **Anything smoothed or derived still comes from `per_frame`, across the same q-register bridge every other layer uses.**

## Engine limits worth knowing before you write your own

- **16 texture samplers total**, not the arbitrary custom-texture loading original MilkDrop allowed. `sampler_main` (frame buffer), `sampler_blur1`–`sampler_blur3` (the blur chain, used above), `sampler_noise_lq`/`sampler_noisevol_hq` (2D/3D noise), plus named procedural textures (`perlin`, `simplex`, `voronoi`, `pattern`, `fractal`, …). The full list and the alias table for legacy/non-standard names are in the [coding guide](../MILKDROP_CODING_GUIDE.md#engine-limitations).
- **No external texture loading.** Every texture is pre-authored and shipped with the app; presets can't reference a URL or a data URI.
- **Frame samplers** bind to previous, warp, or current frame targets according to the sampler and backend. The runtime has distinct warp and composite targets; do not infer native parity from a successful sampler binding.
- **Advanced shader constructs** depend on the backend and parsed program. Matrix locals and selected LOD/bias/gradient calls have supported paths; runtime-indexed matrix writes and other unsupported statements can force a fallback. Arbitrary custom uniforms and screen-coordinate builtins are not a portable authoring contract.

The full cross-engine picture — what changes if the same preset runs in Winamp, projectM, or Butterchurn instead — is in [Track 8](08-shipping.md#compatibility-matrix).

## What you can now build

You can now read and write both halves of the modern preset pipeline: EEL equations for motion, audio, and per-pixel variation, and GLSL shaders for anything that needs to see the whole frame — edge detection, blur-based effects, reaction-diffusion, and fractal iteration. Use diagnostics and the compatibility guide when moving beyond these examples.

**Next: [Track 7 — Taste](07-taste.md)**, where the question stops being "what does this line do" and becomes "why is this preset good."
