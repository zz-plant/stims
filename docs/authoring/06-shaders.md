# Track 6 — Shaders

Everything through Track 5 is EEL: small equations, evaluated on the CPU-side VM, one value per knob per frame (or per pixel, at most). Shaders are different in kind, not just in syntax — GLSL code that runs on the GPU, once per *screen pixel*, every frame. This is where reaction-diffusion, edge detection, and fractal iteration live: effects that need every pixel to see its neighbors, which EEL's per-pixel context can't do.

**64% of the bundled catalog uses this pair of shaders.** This is the cliff every existing MilkDrop resource has left unbridged — the [authoring docs assessment](../PRESET_AUTHORING_DOCS_PLAN.md) found exactly two worked shader examples in the entire canonical reference. Here's the missing tutorial.

## Lesson 0 · A language note, stated plainly

MilkDrop's original shaders are HLSL (DirectX). **Stims compiles a GLSL 1.20 dialect, not HLSL.** Presets written against real MilkDrop/Winamp use HLSL syntax that Stims's parser accepts where the two languages overlap (which is most day-to-day code — the examples below are valid in both). Where they diverge, Stims has firm limits: no matrix uniforms, no `texture2D()` with an explicit LOD argument, no `gl_FragCoord`. Every example in this track stays inside those limits and inside GLSL 1.20 (`texture2D`, not `texture`).

## Lesson 1 · The smallest possible warp shader

```text
[warp_shader]
ret = uv;
```

[**▶ Run the identity warp**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgc21hbGxlc3QgcG9zc2libGUgd2FycF9zaGFkZXI6IHNhbXBsZSB0aGUgcHJldmlvdXMgZnJhbWUgYXQgdGhlCi8vIHVubW9kaWZpZWQgY29vcmRpbmF0ZS4gQmVoYXZlcyBleGFjdGx5IGxpa2Ugbm8gc2hhZGVyIGF0IGFsbCDigJQgdGhlCi8vIHBvaW50IGlzIHRvIHNlZSB0aGUgcmVxdWlyZWQgc2hhcGUgb2YgYSB3YXJwIHNoYWRlciBiZWZvcmUgY2hhbmdpbmcgaXQuCmZSYXRpbmc9NQpmRGVjYXk9MC45OApmV2F2ZUFscGhhPTEuMgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKW3dhcnBfc2hhZGVyXQpyZXQgPSB1djsK "examples/61-warp-shader-identity.milk")

Compare this against [the shaderless bench](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgYmVuY2gsIHVuY2hhbmdlZCDigJQgbm8gc2hhZGVyIGJsb2NrcyB5ZXQuIFRyYWNrIDYncyBiZWZvcmUtc2hvdC4KZlJhdGluZz01CmZEZWNheT0wLjk4CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/60-shader-baseline.milk") — they should look identical. `uv` is the pixel's own texture coordinate, `0..1` across the screen; `ret` is the coordinate the warp shader hands back for sampling the previous frame. Returning `uv` unchanged is a no-op, same as `dx=0; dy=0; zoom=1` in EEL — but now you've seen the minimum shape every warp shader must have: read (or derive) a coordinate, assign it to `ret`.

## Lesson 2 · Distorting the sample coordinate

```text
vec2 center = uv - vec2(0.5, 0.5);
float dist = length(center);
float ripple = 0.01 * sin(dist * 40.0 - time * 2.0);
vec2 dir = center / (dist + 0.0001);
ret = uv + dir * ripple;
```

[**▶ Run the ripple**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBBIHJpcHBsZTogZGlzcGxhY2UgdGhlIHNhbXBsZSBjb29yZGluYXRlIGJ5IGEgc2luZSBvZiBkaXN0YW5jZSBmcm9tCi8vIGNlbnRlci4gVGhpcyBpcyBwZXItcGl4ZWwgcmFkaWFsIGRpc3BsYWNlbWVudCB3cml0dGVuIGluIEdMU0wgaW5zdGVhZAovLyBvZiBFRUwg4oCUIHNhbWUgaWRlYSBhcyBUcmFjayA0J3MgcmluZ3MsIHJ1bm5pbmcgb24gdGhlIEdQVSBwZXIgcGl4ZWwuCmZSYXRpbmc9NQpmRGVjYXk9MC45OApmV2F2ZUFscGhhPTEuMgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKW3dhcnBfc2hhZGVyXQp2ZWMyIGNlbnRlciA9IHV2IC0gdmVjMigwLjUsIDAuNSk7CmZsb2F0IGRpc3QgPSBsZW5ndGgoY2VudGVyKTsKZmxvYXQgcmlwcGxlID0gMC4wMSAqIHNpbihkaXN0ICogNDAuMCAtIHRpbWUgKiAyLjApOwp2ZWMyIGRpciA9IGNlbnRlciAvIChkaXN0ICsgMC4wMDAxKTsKcmV0ID0gdXYgKyBkaXIgKiByaXBwbGU7Cg%3D%3D "examples/62-warp-shader-ripple.milk")

This is Track 4's radial-rings trick, rewritten for the GPU:

- `center`/`dist` — same recentering move as Track 4's off-center-current lesson, just written with GLSL's `vec2`/`length()` instead of hand-rolled `sqrt(x*x+y*y)`.
- `ripple` — a sine of distance, exactly like `sin(rad*12+time*0.5)` in EEL; the coefficient on `dist` sets ring count, the coefficient on `time` sets animation speed.
- `dir = center / (dist + 0.0001)` — a unit vector pointing away from center; the `+0.0001` is the same divide-by-zero guard Track 4's off-center lesson used, just in GLSL now.
- `ret = uv + dir * ripple` — push the sample coordinate along that direction by the ripple amount. This is what "warp" means concretely: you're not moving pixels, you're changing *which* previous-frame pixel gets sampled into this one.

The EEL and GLSL versions of the same idea read almost identically once you know the vocabulary swap: `rad`/`ang` become `length()`/normalize-by-division, `dx`/`dy` become an offset added to `uv`.

## Lesson 3 · The smallest possible composite shader

```text
[comp_shader]
vec3 c = texture2D(sampler_main, uv).rgb;
ret = c * vec3(1.0, 0.85, 0.6);
```

[**▶ Run the tint**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgc21hbGxlc3QgcG9zc2libGUgY29tcF9zaGFkZXI6IHNhbXBsZSB0aGUgY29tcG9zaXRlZCBmcmFtZSBhbmQKLy8gdGludCBpdC4gY29tcF9zaGFkZXIgcnVucyBhZnRlciB3YXZlcy9zaGFwZXMgYXJlIGRyYXduLCBzbyB0aGlzCi8vIGNvbG9ycyBldmVyeXRoaW5nIFRyYWNrcyAxLTUgYWxyZWFkeSBwdXQgb24gc2NyZWVuLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCltjb21wX3NoYWRlcl0KdmVjMyBjID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYpLnJnYjsKcmV0ID0gYyAqIHZlYzMoMS4wLCAwLjg1LCAwLjYpOwo%3D "examples/63-comp-shader-tint.milk")

`comp_shader` runs *after* the warp shader and after waves/shapes are drawn — it's the last stop before the pixel hits the screen. `sampler_main` is the composited frame so far; `texture2D(sampler_main, uv).rgb` reads this pixel's color. Multiplying by `vec3(1.0, 0.85, 0.6)` is a tone-map: full red, 85% green, 60% blue — a warm amber grade over everything Tracks 1–5 already produced. Where warp shaders answer "sample from where?", comp shaders answer "what color should this end up?"

## Lesson 4 · Reading neighbors — the thing EEL can't do

```text
float dx = texture2D(sampler_main, uv + vec2(1.0 / texsize.x, 0.0)).x - texture2D(sampler_main, uv + vec2(-1.0 / texsize.x, 0.0)).x;
float dy = texture2D(sampler_main, uv + vec2(0.0, 1.0 / texsize.y)).x - texture2D(sampler_main, uv + vec2(0.0, -1.0 / texsize.y)).x;
float edge = length(vec2(dx, dy)) * 6.0;
vec3 sharpv = texture2D(sampler_main, uv).rgb;
vec3 blurred = texture2D(sampler_blur1, uv).rgb;
ret = abs(sharpv - blurred) * edge;
```

[**▶ Run edge detection**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDEwIGZyb20gdGhlIGNvZGluZyBndWlkZTogZWRnZSBkZXRlY3Rpb24gdmlhIGEgNC1uZWlnaGJvcgovLyBncmFkaWVudCwgdGhlbiBhIGhpZ2gtcGFzcyAoc2hhcnAgbWludXMgYmx1cnJlZCkgdG8gcGljayBvdXQgZGV0YWlsLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MS4wMQpyb3Q9MC4wMQpjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCltjb21wX3NoYWRlcl0KZmxvYXQgZHggPSB0ZXh0dXJlMkQoc2FtcGxlcl9tYWluLCB1diArIHZlYzIoMS4wIC8gdGV4c2l6ZS54LCAwLjApKS54IC0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYgKyB2ZWMyKC0xLjAgLyB0ZXhzaXplLngsIDAuMCkpLng7CmZsb2F0IGR5ID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYgKyB2ZWMyKDAuMCwgMS4wIC8gdGV4c2l6ZS55KSkueCAtIHRleHR1cmUyRChzYW1wbGVyX21haW4sIHV2ICsgdmVjMigwLjAsIC0xLjAgLyB0ZXhzaXplLnkpKS54OwpmbG9hdCBlZGdlID0gbGVuZ3RoKHZlYzIoZHgsIGR5KSkgKiA2LjA7CnZlYzMgc2hhcnB2ID0gdGV4dHVyZTJEKHNhbXBsZXJfbWFpbiwgdXYpLnJnYjsKdmVjMyBibHVycmVkID0gdGV4dHVyZTJEKHNhbXBsZXJfYmx1cjEsIHV2KS5yZ2I7CnJldCA9IGFicyhzaGFycHYgLSBibHVycmVkKSAqIGVkZ2U7Cg%3D%3D "examples/64-comp-shader-edge.milk") — [Pattern 10 from the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-10-edge-detection-compositing).

`texsize` is the render target's pixel dimensions, so `1.0 / texsize.x` is exactly one texel's width. `dx`/`dy` here sample one texel to each side and subtract — a gradient. Where the image is flat, both differences are near zero; where there's a hard edge, one of them spikes. `length(vec2(dx, dy))` combines both directions into a single edge strength.

The second half is a **high-pass filter**: `sampler_blur1` is a pre-blurred version of the same frame that Stims computes for you every frame (part of the built-in blur chain, alongside `blur2`/`blur3` at increasing radii). `sharp - blurred` cancels out everything low-frequency (broad color regions) and leaves only fine detail — multiplying that by `edge` picks out detail specifically at hard boundaries. This is the one thing this entire track exists for: **no EEL context — not even per-pixel — can read a neighboring pixel's value.** Only a shader can, because only the shader runs after the whole frame already exists.

## Lesson 5 · Crossing the q-var bridge into GLSL

The same bridge from Tracks 4 and 5 — smooth in `per_frame`, write a q-var — works into shaders too. `q1`–`q8` (and up to `q32`) are available as float uniforms inside both `warp_shader` and `comp_shader`:

```text
per_frame_1=ra=1/fps*0.1;
per_frame_2=bass_avg=bass_avg*(1-ra)+ra*bass;
per_frame_3=q1=bass_avg;
[warp_shader]
vec2 center = uv - vec2(0.5, 0.5);
float dist = length(center);
float ripple = (0.005 + 0.02 * q1) * sin(dist * 40.0 - time * 2.0);
vec2 dir = center / (dist + 0.0001);
ret = uv + dir * ripple;
```

[**▶ Run the audio-reactive ripple**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgcmlwcGxlLCBub3cgZHJpdmVuIGJ5IGF1ZGlvOiBwZXJfZnJhbWUgc21vb3RocyBiYXNzIGludG8gcTEsIGFuZAovLyB0aGUgd2FycCBzaGFkZXIgcmVhZHMgcTEgYXMgYSB1bmlmb3JtIGZsb2F0IOKAlCB0aGUgc2FtZSBxLXZhciBicmlkZ2UKLy8gZnJvbSBUcmFjayA0LCBjcm9zc2luZyBmcm9tIEVFTCBpbnRvIEdMU0wgdGhpcyB0aW1lLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCnBlcl9mcmFtZV8xPXJhPTEvZnBzKjAuMTsKcGVyX2ZyYW1lXzI9YmFzc19hdmc9YmFzc19hdmcqKDEtcmEpK3JhKmJhc3M7CnBlcl9mcmFtZV8zPXExPWJhc3NfYXZnOwpbd2FycF9zaGFkZXJdCnZlYzIgY2VudGVyID0gdXYgLSB2ZWMyKDAuNSwgMC41KTsKZmxvYXQgZGlzdCA9IGxlbmd0aChjZW50ZXIpOwpmbG9hdCByaXBwbGUgPSAoMC4wMDUgKyAwLjAyICogcTEpICogc2luKGRpc3QgKiA0MC4wIC0gdGltZSAqIDIuMCk7CnZlYzIgZGlyID0gY2VudGVyIC8gKGRpc3QgKyAwLjAwMDEpOwpyZXQgPSB1diArIGRpciAqIHJpcHBsZTsK "examples/65-warp-shader-reactive.milk")

Nothing new syntactically — `q1` is read on the GLSL side exactly like any other identifier, because as far as the shader is concerned it's just a uniform the compiler wires up automatically. This is the whole answer to "how do shaders hear the music": **they don't listen — `per_frame` does, and hands the result across the same q-register bridge every other layer uses.**

## Engine limits worth knowing before you write your own

- **16 texture samplers total**, not the arbitrary custom-texture loading original MilkDrop allowed. `sampler_main` (frame buffer), `sampler_blur1`–`sampler_blur3` (the blur chain, used above), `sampler_noise_lq`/`sampler_noisevol_hq` (2D/3D noise), plus named procedural textures (`perlin`, `simplex`, `voronoi`, `pattern`, `fractal`, …). Full list and the alias table for legacy/non-standard names in the [coding guide](../MILKDROP_CODING_GUIDE.md#engine-limitations).
- **No external texture loading.** Every texture is pre-authored and shipped with the app; presets can't reference a URL or a data URI.
- **`sampler_pw_main`/`sampler_pc_main`** resolve to `previousTex` — Stims fuses the warp and comp passes into one, unlike the original two-pass pipeline, so "the previous warp pass's output" and "the previous frame's output" are the same buffer here.
- **`texture2D()` only** — no LOD argument, no `texture()`. No matrix uniforms, no `gl_FragCoord`.

The full cross-engine picture — what changes if the same preset runs in Winamp, projectM, or Butterchurn instead — is [Track 8](08-shipping.md#compatibility-matrix).

## What you can now build

You can now read and write both halves of the modern preset pipeline: EEL equations for motion, audio, and per-pixel variation, and GLSL shaders for anything that needs to see the whole frame — edge detection, blur-based effects, reaction-diffusion, fractal iteration. Between this track and Tracks 1–5, there is no longer a construct in the bundled catalog you can't at least partially read.

**Next: [Track 7 — Taste](07-taste.md)**, where the question stops being "what does this line do" and becomes "why is this preset good."
