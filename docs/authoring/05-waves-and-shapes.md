# Track 5 — Waves and shapes

Everything so far distorts the feedback loop — the paint already on screen. Waves and shapes are the *new* ink laid on top each frame, before the loop's distortion is applied to it next time around. They're not a minor feature: **88% of the bundled catalog uses custom waves, and 99% uses custom shapes** — this is the layer most presets actually draw with.

## Lesson 1 · A second waveform

Every preset has one built-in waveform (`wave_r`/`wave_g`/`wave_b`, the one you've been coloring since Track 1). Custom waves are additional ones, up to eight, each fully independent:

```text
wavecode_0_enabled=1
wavecode_0_samples=200
wavecode_0_scaling=1
wavecode_0_smoothing=0.5
wavecode_0_r=1
wavecode_0_g=0.7
wavecode_0_b=0.2
wavecode_0_a=1
```

[**▶ Run a static custom wave**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBBIHNlY29uZCB3YXZlZm9ybSwgZHJhd24gaW5kZXBlbmRlbnRseSBvZiB0aGUgbWFpbiBvbmUsIHdpdGggbm8KLy8gZXF1YXRpb25zIGF0IGFsbCB5ZXQg4oCUIGp1c3Qgc3RhdGljIHBhcmFtcy4gQmFzZWxpbmUgZm9yIFRyYWNrIDUuCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTAuNgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMQp3YXZlX2c9MC4yCndhdmVfYj0wLjMKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCndhdmVjb2RlXzBfZW5hYmxlZD0xCndhdmVjb2RlXzBfc2FtcGxlcz0yMDAKd2F2ZWNvZGVfMF9zZXA9MAp3YXZlY29kZV8wX3NjYWxpbmc9MQp3YXZlY29kZV8wX3Ntb290aGluZz0wLjUKd2F2ZWNvZGVfMF9yPTEKd2F2ZWNvZGVfMF9nPTAuNwp3YXZlY29kZV8wX2I9MC4yCndhdmVjb2RlXzBfYT0xCg%3D%3D "examples/50-static-wave.milk")

`wavecode_0_*` are static parameters — enable it, give it 200 sample points, an amber color. On its own it draws the audio waveform again, just as a second colored line. The interesting part is next.

## Lesson 2 · Shaping every sample point

`wave_N_per_point` equations run once *per sample point* of the wave — the finest-grained code in the whole language, potentially hundreds of times a frame for one wave:

```text
wave_0_per_point1=t=sample*6.283185+time*0.3;
wave_0_per_point2=x=0.5+0.3*sin(t*3)*(1+0.3*value);
wave_0_per_point3=y=0.5+0.3*cos(t*2)*(1+0.3*value);
```

[**▶ Run the Lissajous wave**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTYW1lIGN1c3RvbSB3YXZlLCBub3cgc2hhcGVkIGJ5IGEgcGVyLXBvaW50IGVxdWF0aW9uIGluc3RlYWQgb2YgdGhlCi8vIGF1ZGlvIHNhbXBsZSBkaXJlY3RseS4gd2F2ZV8wX3Blcl9wb2ludDEgcnVucyBvbmNlIHBlciBzYW1wbGUgcG9pbnQKLy8gKHNhbXBsZSBydW5zIDAuLjEgYWNyb3NzIHRoZSB3YXZlKTsgeCx5IGFyZSB3aGF0IGl0IG11c3Qgc2V0LgpmUmF0aW5nPTUKZkRlY2F5PTAuOTcKZldhdmVBbHBoYT0wLjYKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjEKd2F2ZV9nPTAuMgp3YXZlX2I9MC4zCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAp3YXZlY29kZV8wX2VuYWJsZWQ9MQp3YXZlY29kZV8wX3NhbXBsZXM9MjAwCndhdmVjb2RlXzBfc2VwPTAKd2F2ZWNvZGVfMF9zY2FsaW5nPTEKd2F2ZWNvZGVfMF9zbW9vdGhpbmc9MC41CndhdmVjb2RlXzBfcj0xCndhdmVjb2RlXzBfZz0wLjcKd2F2ZWNvZGVfMF9iPTAuMgp3YXZlY29kZV8wX2E9MQp3YXZlXzBfcGVyX3BvaW50MT10PXNhbXBsZSo2LjI4MzE4NSt0aW1lKjAuMzsKd2F2ZV8wX3Blcl9wb2ludDI9eD0wLjUrMC4zKnNpbih0KjMpKigxKzAuMyp2YWx1ZSk7CndhdmVfMF9wZXJfcG9pbnQzPXk9MC41KzAuMypjb3ModCoyKSooMSswLjMqdmFsdWUpOwo%3D "examples/51-wave-lissajous.milk")

The two inputs unique to this context:

- `sample` — this point's position along the wave, `0` to `1`. Multiplying by `6.283185` (2π) turns it into a full angle sweep — the standard move whenever a wave should trace a closed curve instead of a left-to-right line.
- `value` — the actual audio sample at this point, roughly `-1..1`. Folding it into the radius (`1+0.3*value`) is how the shape stays a recognizable curve while still visibly responding to the waveform, rather than the waveform being replaced outright.

You must set `x`/`y` yourself here — nothing else positions the point. This is the fundamental deal with per-point code: total control over where every point of the wave lands, in exchange for writing the geometry from scratch.

## Lesson 3 · A shape, sitting still

Custom shapes (up to four, each with 3–100 sides and up to 1024 instances) are the other half of this layer — solid polygons instead of lines:

```text
shapecode_0_enabled=1
shapecode_0_sides=5
shapecode_0_thickoutline=1
shapecode_0_x=0.5
shapecode_0_y=0.5
shapecode_0_rad=0.15
shapecode_0_r=0.9
shapecode_0_g=0.6
shapecode_0_b=0.1
```

[**▶ Run a static pentagon**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBBIGN1c3RvbSBzaGFwZSAoYSBwZW50YWdvbiksIHNpdHRpbmcgc3RpbGwsIGNvbG9yZWQsIG5vIGVxdWF0aW9ucyB5ZXQuCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTAKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wCndhdmVfZz0wCndhdmVfYj0wCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApzaGFwZWNvZGVfMF9lbmFibGVkPTEKc2hhcGVjb2RlXzBfc2lkZXM9NQpzaGFwZWNvZGVfMF9hZGRpdGl2ZT0wCnNoYXBlY29kZV8wX3RoaWNrb3V0bGluZT0xCnNoYXBlY29kZV8wX3RleHR1cmVkPTAKc2hhcGVjb2RlXzBfeD0wLjUKc2hhcGVjb2RlXzBfeT0wLjUKc2hhcGVjb2RlXzBfcmFkPTAuMTUKc2hhcGVjb2RlXzBfYW5nPTAKc2hhcGVjb2RlXzBfcj0wLjkKc2hhcGVjb2RlXzBfZz0wLjYKc2hhcGVjb2RlXzBfYj0wLjEKc2hhcGVjb2RlXzBfYT0xCg%3D%3D "examples/52-static-shape.milk")

Static params only — the pentagon just sits there. `shapecode_0_*` mirrors `wavecode_0_*`: `_enabled`, geometry (`sides`, `x`, `y`, `rad`, `ang`), color (`r`/`g`/`b`/`a`).

## Lesson 4 · Giving a shape a per_frame

`shape_N_per_frame` runs once per frame for that shape instance — the same rhythm as the root `per_frame`, just scoped to one shape:

```text
shape_0_per_frame1=x=0.5+0.25*sin(time*0.7);
shape_0_per_frame2=y=0.5+0.25*cos(time*0.7);
shape_0_per_frame3=ang=time*0.7;
```

[**▶ Run the orbiting pentagon**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgc2FtZSBwZW50YWdvbiwgbm93IG9yYml0aW5nIHRoZSBjZW50ZXIgb24gYSBwZXJfZnJhbWUgZXF1YXRpb24uCi8vIHNoYXBlXzBfcGVyX2ZyYW1lIHJ1bnMgb25jZSBwZXIgZnJhbWUgZm9yIHRoaXMgc2hhcGUgaW5zdGFuY2Ug4oCUIHRoZQovLyBzYW1lIHJoeXRobSBhcyB0aGUgcm9vdCBwZXJfZnJhbWUsIGp1c3Qgc2NvcGVkIHRvIG9uZSBzaGFwZS4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MApmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAKd2F2ZV9nPTAKd2F2ZV9iPTAKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCnNoYXBlY29kZV8wX2VuYWJsZWQ9MQpzaGFwZWNvZGVfMF9zaWRlcz01CnNoYXBlY29kZV8wX2FkZGl0aXZlPTAKc2hhcGVjb2RlXzBfdGhpY2tvdXRsaW5lPTEKc2hhcGVjb2RlXzBfdGV4dHVyZWQ9MApzaGFwZWNvZGVfMF94PTAuNQpzaGFwZWNvZGVfMF95PTAuNQpzaGFwZWNvZGVfMF9yYWQ9MC4xNQpzaGFwZWNvZGVfMF9hbmc9MApzaGFwZWNvZGVfMF9yPTAuOQpzaGFwZWNvZGVfMF9nPTAuNgpzaGFwZWNvZGVfMF9iPTAuMQpzaGFwZWNvZGVfMF9hPTEKc2hhcGVfMF9wZXJfZnJhbWUxPXg9MC41KzAuMjUqc2luKHRpbWUqMC43KTsKc2hhcGVfMF9wZXJfZnJhbWUyPXk9MC41KzAuMjUqY29zKHRpbWUqMC43KTsKc2hhcGVfMF9wZXJfZnJhbWUzPWFuZz10aW1lKjAuNzsK "examples/53-orbiting-shape.milk")

Nothing new mechanically — this is Track 1's `sin(time)` heartbeat, just steering a shape's position instead of a screen-wide knob. `shape_N_init` (unused here) runs once, the first frame only, for one-time setup.

## Lesson 5 · Morphing instead of moving

A shape doesn't have to move to be alive — it can change identity entirely, frame by frame. [Pattern 12 from the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-12-shape-state-machine-evet):

```text
shape_0_per_frame1=s=frame%6+4;
shape_0_per_frame2=sides=s;
shape_0_per_frame3=rad=0.08+s*0.01;
shape_0_per_frame4=ang=s*0.3;
shape_0_per_frame5=r=sin(s*1.1)*0.5+0.5;
shape_0_per_frame6=g=sin(s*2.2)*0.5+0.5;
shape_0_per_frame7=b=sin(s*3.3)*0.5+0.5;
```

[**▶ Run the shape state machine**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDEyIGZyb20gdGhlIGNvZGluZyBndWlkZTogYSBzaGFwZSBjeWNsaW5nIHRocm91Z2ggaWRlbnRpdGllcy4KLy8gRXZlcnkgNnRoIGZyYW1lIGl0IGFkdmFuY2VzIHRvIGEgbmV3IHNpZGVzL2NvbG9yL3JhZCBjb21iaW5hdGlvbiDigJQgdGhlCi8vIHNoYXBlIGRvZXNuJ3QgbW92ZSwgaXQgKm1vcnBocyouCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTAKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wCndhdmVfZz0wCndhdmVfYj0wCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApzaGFwZWNvZGVfMF9lbmFibGVkPTEKc2hhcGVjb2RlXzBfc2lkZXM9NApzaGFwZWNvZGVfMF9hZGRpdGl2ZT0wCnNoYXBlY29kZV8wX3RoaWNrb3V0bGluZT0xCnNoYXBlY29kZV8wX3RleHR1cmVkPTAKc2hhcGVjb2RlXzBfeD0wLjUKc2hhcGVjb2RlXzBfeT0wLjUKc2hhcGVjb2RlXzBfcmFkPTAuMQpzaGFwZWNvZGVfMF9hbmc9MApzaGFwZWNvZGVfMF9yPTEKc2hhcGVjb2RlXzBfZz0xCnNoYXBlY29kZV8wX2I9MQpzaGFwZWNvZGVfMF9hPTEKc2hhcGVfMF9wZXJfZnJhbWUxPXM9ZnJhbWUlNis0OwpzaGFwZV8wX3Blcl9mcmFtZTI9c2lkZXM9czsKc2hhcGVfMF9wZXJfZnJhbWUzPXJhZD0wLjA4K3MqMC4wMTsKc2hhcGVfMF9wZXJfZnJhbWU0PWFuZz1zKjAuMzsKc2hhcGVfMF9wZXJfZnJhbWU1PXI9c2luKHMqMS4xKSowLjUrMC41OwpzaGFwZV8wX3Blcl9mcmFtZTY9Zz1zaW4ocyoyLjIpKjAuNSswLjU7CnNoYXBlXzBfcGVyX2ZyYW1lNz1iPXNpbihzKjMuMykqMC41KzAuNTsK "examples/54-shape-state-machine.milk")

`frame%6+4` cycles `s` through `4, 5, 6, 7, 8, 9, 4, 5, …` — one step every frame. Every other line reads that same `s`: sides count, radius, rotation, and all three color channels are just different functions of it. The shape isn't animating a fixed pentagon — it's cycling through six entirely different polygon identities, each with its own look, six times a second at 36fps-equivalent stepping. This is the technique behind shapes that seem to "breathe" between forms rather than simply move.

## Lesson 6 · Wired to the music

Everything in this track has run on `time` alone. Bridge it to audio exactly the way Track 4 did — smooth in `per_frame`, write a q-var, read it wherever it's needed:

```text
per_frame_1=ra=1/fps*0.1;
per_frame_2=bass_avg=bass_avg*(1-ra)+ra*bass;
per_frame_3=q8=bass_avg;
wave_0_per_point1=t=sample*6.283185+time*0.3;
wave_0_per_point2=x=0.5+(0.2+0.15*q8)*sin(t*3);
wave_0_per_point3=y=0.5+(0.2+0.15*q8)*cos(t*2);
shape_0_per_frame1=rad=0.1+q8*0.15;
shape_0_per_frame2=ang=time*0.5;
```

[**▶ Run the reactive wave + shape**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBFdmVyeXRoaW5nIGluIFRyYWNrIDUgY29tYmluZWQgYW5kIG1hZGUgYXVkaW8tcmVhY3RpdmU6IHE4IGNhcnJpZXMKLy8gc21vb3RoZWQgdm9sdW1lIGZyb20gcGVyX2ZyYW1lIGludG8gYm90aCB0aGUgc2hhcGUgKHJhZGl1cykgYW5kIHRoZQovLyB3YXZlIChhbXBsaXR1ZGUgdmlhIHZhbHVlJ3MgbmF0dXJhbCBzY2FsaW5nKSwgdGhlIHNhbWUgcS12YXIgYnJpZGdlCi8vIFRyYWNrIDQgdXNlZCBmb3IgcGVyX3BpeGVsLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTcKZldhdmVBbHBoYT0wLjUKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjEKd2F2ZV9nPTAuMgp3YXZlX2I9MC4zCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAp3YXZlY29kZV8wX2VuYWJsZWQ9MQp3YXZlY29kZV8wX3NhbXBsZXM9MjAwCndhdmVjb2RlXzBfc2VwPTAKd2F2ZWNvZGVfMF9zY2FsaW5nPTEKd2F2ZWNvZGVfMF9zbW9vdGhpbmc9MC41CndhdmVjb2RlXzBfcj0xCndhdmVjb2RlXzBfZz0wLjcKd2F2ZWNvZGVfMF9iPTAuMgp3YXZlY29kZV8wX2E9MQpzaGFwZWNvZGVfMF9lbmFibGVkPTEKc2hhcGVjb2RlXzBfc2lkZXM9NQpzaGFwZWNvZGVfMF9hZGRpdGl2ZT0wCnNoYXBlY29kZV8wX3RoaWNrb3V0bGluZT0xCnNoYXBlY29kZV8wX3RleHR1cmVkPTAKc2hhcGVjb2RlXzBfeD0wLjUKc2hhcGVjb2RlXzBfeT0wLjUKc2hhcGVjb2RlXzBfcmFkPTAuMTUKc2hhcGVjb2RlXzBfYW5nPTAKc2hhcGVjb2RlXzBfcj0wLjkKc2hhcGVjb2RlXzBfZz0wLjYKc2hhcGVjb2RlXzBfYj0wLjEKc2hhcGVjb2RlXzBfYT0xCnBlcl9mcmFtZV8xPXJhPTEvZnBzKjAuMTsKcGVyX2ZyYW1lXzI9YmFzc19hdmc9YmFzc19hdmcqKDEtcmEpK3JhKmJhc3M7CnBlcl9mcmFtZV8zPXE4PWJhc3NfYXZnOwp3YXZlXzBfcGVyX3BvaW50MT10PXNhbXBsZSo2LjI4MzE4NSt0aW1lKjAuMzsKd2F2ZV8wX3Blcl9wb2ludDI9eD0wLjUrKDAuMiswLjE1KnE4KSpzaW4odCozKTsKd2F2ZV8wX3Blcl9wb2ludDM9eT0wLjUrKDAuMiswLjE1KnE4KSpjb3ModCoyKTsKc2hhcGVfMF9wZXJfZnJhbWUxPXJhZD0wLjErcTgqMC4xNTsKc2hhcGVfMF9wZXJfZnJhbWUyPWFuZz10aW1lKjAuNTsK "examples/55-reactive-shape-and-wave.milk")

`q8` is computed exactly once, in the root `per_frame`, and both the wave's per-point code and the shape's per-frame code read the same value that frame. This is the general answer to "how do waves/shapes hear the music": they don't read audio directly — `per_frame` does the listening (Track 3), everything downstream just reads the result.

## What you can now build

Waves and shapes are how a preset draws something recognizable rather than just distorting a blur — lines that trace curves, polygons that orbit or morph, both wired into the same audio pipeline as everything else. Between Tracks 1–5 you can now read the `per_frame`/`per_pixel`/wave/shape portion of almost any preset in the catalog.

**Next: [Track 6 — Shaders](06-shaders.md)**, the one piece left: the GLSL `warp_shader`/`comp_shader` pair that 64% of modern presets use for the effects equations alone can't reach.
