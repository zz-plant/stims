# Track 4 — Warp fields

Every knob in Tracks 1–3 applied to the *whole screen at once*: one `zoom` value, one `rot` value, the same for every pixel. `per_pixel` code breaks that — it runs once per mesh point, so the same knobs can take a different value depending on *where* the point is. This is how MilkDrop gets depth, tunnels, and ripples out of a flat feedback loop.

## Lesson 1 · One value everywhere

The baseline, so the next lesson has something to compare against:

```text
zoom=1.02
```

[**▶ Run uniform zoom**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTYW1lIHBlcl9mcmFtZSB6b29tIGZvciBldmVyeSBwaXhlbCDigJQgdGhlIHVuaWZvcm0gYmFzZWxpbmUgVHJhY2sgNCBvcGVucwovLyB3aXRoLiBDb21wYXJlIGFnYWluc3QgNDEtcmFkaWFsLXpvb20ubWlsay4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDIKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MAo%3D "examples/40-uniform-zoom.milk")

Every point on the mesh redraws 1.02× larger, center included. Flat, uniform outward push — the whole frame breathing as one rigid sheet.

## Lesson 2 · `rad` — distance from center

`per_pixel` code gets two built-in reads that `per_frame` doesn't: `rad`, each mesh point's distance from the pivot (`0` at dead center, `~1` at the edge), and `ang`, its angle around the pivot. [Pattern 3 from the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-3-per-pixel-radial-zoom):

```text
per_pixel_1=zoom=(zoom-1)*rad+1;
```

[**▶ Run radial zoom**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDMgZnJvbSB0aGUgY29kaW5nIGd1aWRlOiBwZXJfcGl4ZWwgcmFkaWFsIHpvb20uIHJhZCBpcyBhCi8vIGJ1aWx0LWluIOKAlCBlYWNoIG1lc2ggcG9pbnQncyBkaXN0YW5jZSBmcm9tIGNlbnRlciAoMCBhdCB0aGUgbWlkZGxlLAovLyB%2BMSBhdCB0aGUgZWRnZSkuIEF0IHJhZD0wIHRoaXMgbGluZSByZWR1Y2VzIHRvIHpvb209MSAodW50b3VjaGVkKTsKLy8gYXQgcmFkPTEgaXQncyB0aGUgZnVsbCBwZXJfZnJhbWUgem9vbS4gT25lIGxpbmUsIG9yZ2FuaWMgZGVwdGguCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTEuMgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xLjA1CnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX3BpeGVsXzE9em9vbT0oem9vbS0xKSpyYWQrMTsK "examples/41-radial-zoom.milk")

Read it at the two extremes. At `rad=0`: `(zoom-1)*0+1` collapses to `1` — the center point is untouched, no matter what `zoom` was set to. At `rad=1`: `(zoom-1)*1+1` simplifies back to `zoom` — the edge gets the full per-frame value. Everywhere in between is a smooth ramp. One line turns a flat push into something with a center of gravity — the difference between a screensaver and a tunnel.

This is the single most-copied line in the entire preset corpus for a reason: it's cheap, it's one line, and it instantly adds depth to *any* motion you already have.

## Lesson 3 · `ang` — direction from center

Add `ang` and you can steer, not just scale. [Pattern 4 from the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-4-radial-pulse-with-rings):

```text
per_pixel_1=dr=0.01+0.02*sin(rad*12+time*0.5);
per_pixel_2=dx=dx+dr*cos(ang)*0.6;
per_pixel_3=dy=dy+dr*sin(-ang)*0.6;
```

[**▶ Run the rings**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDQgZnJvbSB0aGUgY29kaW5nIGd1aWRlOiBjb25jZW50cmljIHJpbmdzIHB1bHNpbmcgb3V0d2FyZC4KLy8gcmFkKjEyIHBhY2tzIDEyIHJpbmdzIGludG8gdGhlIHJhZGl1czsgdGltZSowLjUgcm90YXRlcyB0aGUgcmluZwovLyBwYXR0ZXJuOyBhbmcgKGJ1aWx0LWluIGFuZ2xlIGZyb20gY2VudGVyKSBzdGVlcnMgZWFjaCBwaXhlbCdzIHB1c2gKLy8gYWxvbmcgaXRzIG93biByYWRpYWwgZGlyZWN0aW9uIHZpYSBjb3MoYW5nKS9zaW4oYW5nKS4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfcGl4ZWxfMT1kcj0wLjAxKzAuMDIqc2luKHJhZCoxMit0aW1lKjAuNSk7CnBlcl9waXhlbF8yPWR4PWR4K2RyKmNvcyhhbmcpKjAuNjsKcGVyX3BpeGVsXzM9ZHk9ZHkrZHIqc2luKC1hbmcpKjAuNjsK "examples/42-radial-rings.milk")

- `rad*12` — twelve full sine cycles between center and edge, i.e. twelve rings. Change the `12` and recount them.
- `time*0.5` inside the same `sin(...)` — the ring pattern itself rotates outward over time, like ripples leaving a source.
- `dr` is a *magnitude* — how far this pixel should be pushed this frame. `cos(ang)` and `sin(-ang)` turn that magnitude into a direction: push each point *along its own radial line*, not sideways. That's why the result is rings expanding from the center rather than a wave sliding across the screen.

`dx`/`dy` here work exactly like Track 2's screen-wide push — they're just being set to a *different value per pixel* instead of one constant.

## Lesson 4 · Bridging per_frame and per_pixel with q-vars

`per_frame` runs once and can read audio; `per_pixel` runs per point and can read `rad`/`ang` — but it can't read audio directly, and it has no memory between frames. The bridge is a q-register, written once in `per_frame`, read by every point in `per_pixel`:

```text
per_frame_1=ra=1/fps*0.1;
per_frame_2=bass_avg=bass_avg*(1-ra)+ra*bass;
per_frame_3=q8=bass_avg;
per_pixel_1=dr=0.01+0.05*q8*sin(rad*12+time*0.5);
per_pixel_2=dx=dx+dr*cos(ang)*0.6;
per_pixel_3=dy=dy+dr*sin(-ang)*0.6;
```

[**▶ Run the audio-driven rings**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTYW1lIHJpbmdzLCBidXQgdGhlIGFtcGxpdHVkZSBjb21lcyBmcm9tIHE4IOKAlCBzZXQgb25jZSBpbiBwZXJfZnJhbWUKLy8gZnJvbSBzbW9vdGhlZCB2b2x1bWUsIHRoZW4gcmVhZCBieSBldmVyeSBtZXNoIHBvaW50IGluIHBlcl9waXhlbC4KLy8gVGhpcyBpcyB0aGUgcS12YXIgYnJpZGdlOiBwZXJfZnJhbWUgY2FuJ3Qgc2VlIHBlci1waXhlbCBzdGF0ZSwgYW5kCi8vIHBlcl9waXhlbCBjYW4ndCBzZWUgYWNyb3NzIGZyYW1lcywgc28gcTEtcTMyIGFyZSB0aGUgaGFuZG9mZi4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfZnJhbWVfMT1yYT0xL2ZwcyowLjE7CnBlcl9mcmFtZV8yPWJhc3NfYXZnPWJhc3NfYXZnKigxLXJhKStyYSpiYXNzOwpwZXJfZnJhbWVfMz1xOD1iYXNzX2F2ZzsKcGVyX3BpeGVsXzE9ZHI9MC4wMSswLjA1KnE4KnNpbihyYWQqMTIrdGltZSowLjUpOwpwZXJfcGl4ZWxfMj1keD1keCtkcipjb3MoYW5nKSowLjY7CnBlcl9waXhlbF8zPWR5PWR5K2RyKnNpbigtYW5nKSowLjY7Cg%3D%3D "examples/43-audio-rings.milk")

`per_frame` does the Track 3 work — RC-smooth the bass, once — and drops the result in `q8`. Every mesh point then reads the same `q8` this frame, so the rings' amplitude breathes with the music while the per-pixel shape logic stays untouched. This is the general pattern: **smooth and derive in per_frame, distribute in per_pixel.** Reversing it — smoothing separately at every mesh point — would just be redundant work computed hundreds of times a frame instead of once.

## Lesson 5 · Not everything has to be radial

`rad`/`ang` are convenient, not mandatory — `x` and `y` (each point's raw screen position, `0..1`) are available too, and let you build a current centered anywhere:

```text
per_pixel_1=nx=x-0.75;
per_pixel_2=ny=y-0.3;
per_pixel_3=nrad=sqrt(nx*nx+ny*ny)+0.001;
per_pixel_4=dx=dx-0.02*ny/nrad;
per_pixel_5=dy=dy+0.02*nx/nrad;
```

[**▶ Run the off-center current**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBBIHBlci1waXhlbCBjdXJyZW50IHRoYXQgaXNuJ3QgY2VudGVyZWQgb24gY3gvY3k6IGl0IHJlYWRzIHRoZSByYXcKLy8gbWVzaCBjb29yZGluYXRlcyB4LHkgZGlyZWN0bHkgaW5zdGVhZCBvZiByYWQvYW5nLCBzbyB0aGUgImNlbnRlciIgb2YKLy8gdGhlIHN3aXJsIGlzIHdoZXJldmVyIHRoaXMgbGluZSBwdXRzIGl0LCBpbmRlcGVuZGVudCBvZiB0aGUgcm90YXRpb24KLy8gcGl2b3QuCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTEuMgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX3BpeGVsXzE9bng9eC0wLjc1OwpwZXJfcGl4ZWxfMj1ueT15LTAuMzsKcGVyX3BpeGVsXzM9bnJhZD1zcXJ0KG54Km54K255Km55KSswLjAwMTsKcGVyX3BpeGVsXzQ9ZHg9ZHgtMC4wMipueS9ucmFkOwpwZXJfcGl4ZWxfNT1keT1keSswLjAyKm54L25yYWQ7Cg%3D%3D "examples/44-off-center-current.milk")

`nx`/`ny` recenters the coordinate system on an arbitrary point — here `(0.75, 0.3)`, off in the upper right, independent of wherever `cx`/`cy` has the rotation pivot. `nrad` is a hand-built distance (the `+0.001` avoids a division by exactly zero at the new center). The `-ny/nrad, nx/nrad` pair is a 90°-rotated unit vector — pushing perpendicular to the radius produces a *swirl* around the off-center point rather than a push toward or away from it. Whenever a preset has a distortion source that clearly isn't at screen center, this is usually how.

## What you can now build

Anything that varies across the screen — tunnels, ripples, off-center vortices, audio-breathing rings — is per-pixel code doing exactly what you've just written: read `rad`/`ang` (or build your own coordinate system from `x`/`y`), turn that into a push, optionally scale it by a q-var carried over from `per_frame`.

**Next: [Track 5 — Waves and shapes](05-waves-and-shapes.md)**, where custom waves and shapes — the layer drawn *on top* of the warped feedback loop — get their own equations.
