# Track 3 — Listening

Every knob so far has moved on its own clock (`sin(time*k)`). Now the music takes the wheel. This track covers the audio registers, the smoothing idiom every serious preset uses, how to detect a beat without a beat detector, and how to measure whether any of it actually worked.

## Lesson 1 · Raw audio is jittery

The simplest possible link: read a band, drive a knob.

```text
per_frame_1=zoom = 1.01 + bass*0.15;
```

[**▶ Run raw bass → zoom**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTYW1lIGJlbmNoLCBkcml2ZW4gc3RyYWlnaHQgb2ZmIHJhdyBiYXNzIOKAlCB0aGUgaml0dGVyeSBiYXNlbGluZSBUcmFjayAzCi8vIG9wZW5zIHdpdGguIENvbXBhcmUgYWdhaW5zdCAzMS1hdHRhY2stc21vb3RoZWQubWlsay4KZlJhdGluZz01CmZEZWNheT0wLjk2CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfZnJhbWVfMT16b29tID0gMS4wMSArIGJhc3MqMC4xNTsK "examples/30-raw-jitter.milk")

Watch it for a few seconds. It twitches — `bass` is close to instantaneous, so every sample-level flicker in the low end shows up as a visible jolt. This is the single most common beginner tell: a preset that shudders instead of breathes.

Swap in the attack-smoothed register:

```text
per_frame_1=zoom = 1.01 + bass_att*0.15;
```

[**▶ Run bass_att → zoom**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTYW1lIGFzIDMwLXJhdy1qaXR0ZXIubWlsayBidXQgcmVhZGluZyBiYXNzX2F0dCBpbnN0ZWFkIG9mIGJhc3Mg4oCUIHRoZQovLyBhdHRhY2stc21vb3RoZWQgcmVnaXN0ZXIsIG5vdCBhIGhhbmQtcm9sbGVkIGZpbHRlci4KZlJhdGluZz01CmZEZWNheT0wLjk2CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfZnJhbWVfMT16b29tID0gMS4wMSArIGJhc3NfYXR0KjAuMTU7Cg%3D%3D "examples/31-attack-smoothed.milk")

Same music, calmer motion. `bass_att`/`mid_att`/`treb_att` are envelope-followed versions of `bass`/`mid`/`treb` — they still rise fast on a hit, but they don't chatter. Default to the `_att` versions for anything continuous; reach for the raw bands only when you deliberately want the jitter (texture, noise).

## Lesson 2 · Rolling your own smoothing

`_att` isn't the only tool. The RC low-pass filter — one line, tunable — is the idiom you'll see in nearly every hand-written preset that predates or ignores the `_att` registers:

```text
per_frame_1=ra = 1/fps*0.1;
per_frame_2=bass_avg = bass_avg*(1-ra) + ra*bass;
per_frame_3=zoom = 1.01 + bass_avg*0.15;
```

[**▶ Run the RC filter**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBSQyBsb3ctcGFzcyBmaWx0ZXIgb3ZlciBiYXNzLCBoYW5kLXJvbGxlZCB3aXRoIGEgcGVyc2lzdGVudCBnbG9iYWwKLy8gKGJhc3NfYXZnIGtlZXBzIGl0cyB2YWx1ZSBmcmFtZSB0byBmcmFtZSBiZWNhdXNlIGV2ZXJ5IEVFTCB2YXJpYWJsZSBkb2VzKS4KZlJhdGluZz01CmZEZWNheT0wLjk2CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEuMDEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfZnJhbWVfMT1yYSA9IDEvZnBzKjAuMTsKcGVyX2ZyYW1lXzI9YmFzc19hdmcgPSBiYXNzX2F2ZyooMS1yYSkgKyByYSpiYXNzOwpwZXJfZnJhbWVfMz16b29tID0gMS4wMSArIGJhc3NfYXZnKjAuMTU7Cg%3D%3D "examples/32-rc-smoothed.milk")

`bass_avg` isn't a built-in — it's an ordinary variable. In NS-EEL, any name you assign persists from frame to frame automatically (there's no declaration step), so `bass_avg*(1-ra) + ra*bass` is a proper exponential moving average: each frame, `bass_avg` drifts 10% of the way from where it was toward the current `bass`. `ra` in the `0.05–0.15` range is the useful cutoff — smaller is smoother and laggier, larger snaps closer to raw. The `1/fps` term keeps the cutoff frequency the same regardless of frame rate, the same correction you saw as `75/fps` in Track 2 — here it's derived directly instead of against a 75fps reference, which is the more common form when a preset builds its own filter.

Why bother when `_att` already exists? Control. You choose the exact cutoff, and the same technique smooths *anything* — not just the three built-in bands, but `vol`, a derived signal, even another filter's output.

## Lesson 3 · The volume-clock pattern

The highest-leverage idiom in the whole language: don't drive a knob from audio directly — drive an accumulating clock, and drive the knob from the clock. This is Pattern 1 from the [coding guide](../MILKDROP_CODING_GUIDE.md#pattern-1-volume-squaring--mtime):

```text
per_frame_1=vol = (bass+mid+treb)*0.333;
per_frame_2=vol = vol*vol;
per_frame_3=mtime = mtime + vol*0.02*(75/fps);
per_frame_4=rot = sin(mtime)*0.03;
per_frame_5=zoom = 1 + 0.03*vol;
```

[**▶ Run the volume clock**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDEgZnJvbSB0aGUgY29kaW5nIGd1aWRlOiBzcXVhcmVkIHZvbHVtZSBkcml2aW5nIGFuIGFjY3VtdWxhdGluZwovLyBjbG9jaywgaW5zdGVhZCBvZiBkcml2aW5nIHpvb20gZGlyZWN0bHkuIFF1aWV0IHBhc3NhZ2VzIG5lYXJseSBmcmVlemUKLy8gdGhlIGNsb2NrOyBsb3VkIG9uZXMgc3BpbiBpdC4KZlJhdGluZz01CmZEZWNheT0wLjk3CmZXYXZlQWxwaGE9MS4yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTEKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC4yCndhdmVfZz0wLjg1CndhdmVfYj0xCndhdmVfeD0wLjUKd2F2ZV95PTAuNQpvYl9hPTAKaWJfYT0wCm12X2E9MApwZXJfZnJhbWVfMT12b2wgPSAoYmFzcyttaWQrdHJlYikqMC4zMzM7CnBlcl9mcmFtZV8yPXZvbCA9IHZvbCp2b2w7CnBlcl9mcmFtZV8zPW10aW1lID0gbXRpbWUgKyB2b2wqMC4wMiooNzUvZnBzKTsKcGVyX2ZyYW1lXzQ9cm90ID0gc2luKG10aW1lKSowLjAzOwpwZXJfZnJhbWVfNT16b29tID0gMSArIDAuMDMqdm9sOwo%3D "examples/33-vol-clock.milk")

Two ideas stacked:

- **Squaring compresses quiet and amplifies loud.** `vol*vol` on a 0–1ish range pushes background hiss toward zero while barely touching a loud passage — the preset visibly *rests* between hits instead of humming continuously.
- **`mtime` accumulates instead of following.** `rot` doesn't read `vol` directly — it reads `sin(mtime)`, and `mtime` only advances when there's volume to advance it. During a quiet bridge the clock nearly stops and the whole preset holds its pose; during a loud chorus it races. This is why energetic presets still feel *composed* rather than nervous: the music controls tempo, not just amplitude.

## Lesson 4 · Detecting a beat without a beat detector

MilkDrop has no `on_beat()` callback. Beats are inferred from a threshold that adapts to the track, [Pattern 6 in the coding guide](../MILKDROP_CODING_GUIDE.md#pattern-6-beat-detection-with-adaptive-threshold):

```text
per_frame_1=bass_thresh = above(bass_att,bass_thresh)*2 + (1-above(bass_att,bass_thresh))*((bass_thresh-1.3)*0.96+1.3);
per_frame_2=beat_fired = above(bass_att,bass_thresh);
per_frame_3=wave_r = 0.2 + beat_fired*0.7;
per_frame_4=wave_g = 0.85 - beat_fired*0.3;
```

[**▶ Run the beat flash**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBQYXR0ZXJuIDYgZnJvbSB0aGUgY29kaW5nIGd1aWRlOiBhbiBhZGFwdGl2ZSBiZWF0IHRocmVzaG9sZC4gYmFzc190aHJlc2gKLy8ganVtcHMgdG8gMi4wIHRoZSBpbnN0YW50IGEgYmVhdCBmaXJlcyAoc28gaXQgY2FuJ3QgcmV0cmlnZ2VyIG5leHQgZnJhbWUpLAovLyB0aGVuIGRlY2F5cyBiYWNrIHRvd2FyZCAxLjMg4oCUIHNlbGYtdHVuaW5nIHRvIGxvdWQgb3IgcXVpZXQgdHJhY2tzLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTYKZldhdmVBbHBoYT0xLjIKZldhdmVTY2FsZT0xCm5XYXZlTW9kZT0wCmJXYXZlVGhpY2s9MQpiTWF4aW1pemVXYXZlQ29sb3I9MQpiVGV4V3JhcD0xCnpvb209MS4wMQpyb3Q9MApjeD0wLjUKY3k9MC41CmR4PTAKZHk9MApzeD0xCnN5PTEKd2FycD0wCndhdmVfcj0wLjIKd2F2ZV9nPTAuODUKd2F2ZV9iPTEKd2F2ZV94PTAuNQp3YXZlX3k9MC41Cm9iX2E9MAppYl9hPTAKbXZfYT0wCnBlcl9mcmFtZV8xPWJhc3NfdGhyZXNoID0gYWJvdmUoYmFzc19hdHQsYmFzc190aHJlc2gpKjIgKyAoMS1hYm92ZShiYXNzX2F0dCxiYXNzX3RocmVzaCkpKigoYmFzc190aHJlc2gtMS4zKSowLjk2KzEuMyk7CnBlcl9mcmFtZV8yPWJlYXRfZmlyZWQgPSBhYm92ZShiYXNzX2F0dCxiYXNzX3RocmVzaCk7CnBlcl9mcmFtZV8zPXdhdmVfciA9IDAuMiArIGJlYXRfZmlyZWQqMC43OwpwZXJfZnJhbWVfND13YXZlX2cgPSAwLjg1IC0gYmVhdF9maXJlZCowLjM7Cg%3D%3D "examples/34-beat-flash.milk")

Read it as a state machine with two states, chosen by `above(bass_att, bass_thresh)` (1 if a beat just cleared the bar, else 0):

- **Beat fired** (`above` is 1): the whole right-hand expression collapses to `1*2 + 0*(...)` — `bass_thresh` snaps to `2.0`. The bar is now so high that next frame's `bass_att` almost certainly can't clear it, which is exactly the point: one hit can't retrigger itself for several frames.
- **No beat** (`above` is 0): it collapses to `0*2 + 1*((bass_thresh-1.3)*0.96+1.3)` — `bass_thresh` decays 4% of the way back toward a `1.3` floor every frame. Give it enough quiet frames and the bar is low again, ready for the next hit.

No branch, no `if` even used here — `above()` returning exactly 1 or 0 is what lets both terms be written as one line that only one half of ever survives. This self-tuning bar is why the same threshold code works on a whisper-quiet ambient track and a wall-of-noise one: it's relative to recent loudness, not an absolute number picked for one song.

`beat_fired` itself is reusable — Track 5 uses the identical pattern to advance a shape's state machine.

## Lesson 5 · Measuring it

Everything above is a claim about what the preset does. Stims ships the same instrument its own agents use to check that claim — point it at a file and it reports, per variable, whether audio actually explains the motion:

```bash
bun run lab:reactivity -- --file docs/authoring/examples/35-reactive-vortex.milk
```

[**▶ Run the reactive vortex**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBUaGUgbGFiLW1lYXN1cmVkIGV4YW1wbGU6IFJDLXNtb290aGVkIGJhc3MgZHJpdmVzIHJvdGF0aW9uIHNwZWVkLCBhbgovLyBhZGFwdGl2ZSBiZWF0IHRocmVzaG9sZCBkcml2ZXMgYSBjb2xvciBmbGFzaCwgYW5kIHZvbCBkcml2ZXMgem9vbS4KLy8gUnVuIHRocm91Z2g6IGJ1biBydW4gbGFiOnJlYWN0aXZpdHkgLS0gLS1maWxlIGRvY3MvYXV0aG9yaW5nL2V4YW1wbGVzLzM1LXJlYWN0aXZlLXZvcnRleC5taWxrCmZSYXRpbmc9NQpmRGVjYXk9MC45NwpmV2F2ZUFscGhhPTEuMgpmV2F2ZVNjYWxlPTEKbldhdmVNb2RlPTAKYldhdmVUaGljaz0xCmJNYXhpbWl6ZVdhdmVDb2xvcj0xCmJUZXhXcmFwPTEKem9vbT0xCnJvdD0wCmN4PTAuNQpjeT0wLjUKZHg9MApkeT0wCnN4PTEKc3k9MQp3YXJwPTAKd2F2ZV9yPTAuMgp3YXZlX2c9MC44NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX2ZyYW1lXzE9cmEgPSAxL2ZwcyowLjE7CnBlcl9mcmFtZV8yPWJhc3NfYXZnID0gYmFzc19hdmcqKDEtcmEpICsgcmEqYmFzczsKcGVyX2ZyYW1lXzM9dm9sID0gKGJhc3MrbWlkK3RyZWIpKjAuMzMzOwpwZXJfZnJhbWVfND12b2wgPSB2b2wqdm9sOwpwZXJfZnJhbWVfNT16b29tID0gMS4wMDUgKyAwLjAzKnZvbDsKcGVyX2ZyYW1lXzY9cm90ID0gMC4wMSArIGJhc3NfYXZnKjAuMDQ7CnBlcl9mcmFtZV83PWJhc3NfdGhyZXNoID0gYWJvdmUoYmFzc19hdHQsYmFzc190aHJlc2gpKjIgKyAoMS1hYm92ZShiYXNzX2F0dCxiYXNzX3RocmVzaCkpKigoYmFzc190aHJlc2gtMS4zKSowLjk2KzEuMyk7CnBlcl9mcmFtZV84PWJlYXRfZmlyZWQgPSBhYm92ZShiYXNzX2F0dCxiYXNzX3RocmVzaCk7CnBlcl9mcmFtZV85PXdhdmVfciA9IHdhdmVfciArIDAuMypiZWF0X2ZpcmVkKigxLXdhdmVfcik7Cg%3D%3D "examples/35-reactive-vortex.milk") — RC-smoothed bass drives rotation speed, the volume-clock pattern drives zoom, and the adaptive threshold drives a color flash: everything in this lesson, combined.

The report gives each variable a verdict:

| Verdict | Meaning |
|---|---|
| `reactive` | measurably correlated with audio — the number you want |
| `autonomous` | moves, but on its own clock (`sin(time)`), not audio |
| `weak` | some correlation, but faint |
| `static` | never changes — not necessarily wrong (most variables in a preset should be) |

For `zoom`, `rot`, and `wave_r` in the vortex you should see `reactive`, with the strongest correlation usually on the waveform's own deviation (`mainWave.deviation`) — the tool is measuring the same thing your eyes were doing in Lesson 1, just with a number attached. This is the loop real authors use: write, measure, adjust the coupling strength until the verdict — not just the vibe — says reactive. It's also exactly what [`bun run lab:visual`](../MILKDROP_CODING_GUIDE.md) checks on the pixel side, and what the [contributing guide](../../CONTRIBUTING.md#contributing-presets) asks for before a preset is submitted.

## Lesson 6 · Signals only Stims has

Everything above is standard MilkDrop, portable to Winamp, projectM, and Butterchurn. Stims also feeds presets what the person watching is doing — where the pointer is, how hard it is being dragged, pinch and twist, and a set of key pulses — plus device motion. Every name is in the [reference](reference.md#signals-read-only-inputs), completed and hover-documented in the editor:

| Family | Names | What it carries |
|---|---|---|
| Pointer | `input_x` `input_y` `input_dx` `input_dy` `input_speed` `input_pressed` `input_count` | position (-1..1), per-frame movement, and whether anything is held |
| Hover | `hover_active` `hover_x` `hover_y` | a mouse over the stage that is *not* pressing |
| Force | `drag_intensity` `drag_angle` `wheel_delta` `wheel_accum` | how hard, which way, and the scroll wheel |
| Gesture | `gesture_scale` `gesture_rotation` `gesture_translate_x` `gesture_translate_y` | pinch and twist — `=`/`-` and `,`/`.` on a keyboard |
| Keys | `action_remix` `action_accent` `action_mode_next` `action_mode_previous` `action_quick_look_1..3` | R, Enter, X, Q/Z, 1/2/3 as pulses that decay over ~220ms |

The keys only reach the preset while the stage has focus — click the visuals first. Shift and an arrow key steers the pointer without a mouse.

**None of the 2,686 bundled presets read any of them**, which cuts both ways: there is no prior art to copy, and a preset that answers the person watching is instantly unlike everything else in the catalog.

[**▶ Run the interactive drift**](https://toil.fyi/?tool=editor#code=W3ByZXNldDAwXQovLyBTdGltcy1vbmx5OiB0aGUgcGljdHVyZSBhbnN3ZXJzIHRoZSBwZXJzb24gd2F0Y2hpbmcgaXQuCi8vIERyYWcgdGhlIHN0YWdlIChvciBob2xkIFNoaWZ0IGFuZCBhbiBhcnJvdyBrZXkpIHRvIHB1c2ggdGhlIGRyaWZ0IGFyb3VuZCwKLy8gdHdpc3QgdHdvIGZpbmdlcnMg4oCUIG9yIHByZXNzICwgYW5kIC4g4oCUIHRvIHNwaW4gaXQsIGFuZCBwcmVzcyBSIHRvIHNuYXAKLy8gdGhlIGNvbG91ci4gV2l0aCBubyBoYW5kcyBvbiBpdCwgZXZlcnkgb25lIG9mIHRoZXNlIHJlYWRzIDAgYW5kIHRoZSBwcmVzZXQKLy8gYmVoYXZlcyBsaWtlIGFuIG9yZGluYXJ5IHNsb3cgZHJpZnQsIHdoaWNoIGlzIHRoZSBwb2ludDogaW50ZXJhY3Rpb24gaXMgYQovLyBsYXllciBvbiB0b3Agb2YgYSBwcmVzZXQgdGhhdCBhbHJlYWR5IHdvcmtzLgpmUmF0aW5nPTUKZkRlY2F5PTAuOTgKZldhdmVBbHBoYT0yCmZXYXZlU2NhbGU9MQpuV2F2ZU1vZGU9MApiV2F2ZVRoaWNrPTEKYk1heGltaXplV2F2ZUNvbG9yPTAKYlRleFdyYXA9MQp6b29tPTEKcm90PTAKY3g9MC41CmN5PTAuNQpkeD0wCmR5PTAKc3g9MQpzeT0xCndhcnA9MAp3YXZlX3I9MC41NQp3YXZlX2c9MC43NQp3YXZlX2I9MQp3YXZlX3g9MC41CndhdmVfeT0wLjUKb2JfYT0wCmliX2E9MAptdl9hPTAKcGVyX2ZyYW1lXzE9dm9sID0gKGJhc3MrbWlkK3RyZWIpKjAuMzMzOwpwZXJfZnJhbWVfMj16b29tID0gMS4wMTIgKyAwLjAyKnZvbCp2b2w7Ci8vIERyYWcgcHVzaGVzIHRoZSBmaWVsZDogaW5wdXRfZHgvaW5wdXRfZHkgYXJlIHBlci1mcmFtZSBwb2ludGVyIG1vdmVtZW50LAovLyBzbyB0aGlzIGlzIGEgc2hvdmUgcmF0aGVyIHRoYW4gYSBwb3NpdGlvbi4KcGVyX2ZyYW1lXzM9ZHggPSBkeCowLjkgKyBpbnB1dF9keCowLjM1OwpwZXJfZnJhbWVfND1keSA9IGR5KjAuOSAtIGlucHV0X2R5KjAuMzU7Ci8vIFdoZXJlIHRoZSBoYW5kIGlzIGRlY2lkZXMgd2hlcmUgdGhlIHpvb20gcHVsbHMgZnJvbS4gaW5wdXRfeC9pbnB1dF95IGFyZQovLyAtMS4uMSBhY3Jvc3MgdGhlIHN0YWdlLCBhbmQgY3gvY3kgd2FudCAwLi4xLgpwZXJfZnJhbWVfNT1jeCA9IDAuNSArIGlucHV0X3gqMC4yNSppbnB1dF9wcmVzc2VkOwpwZXJfZnJhbWVfNj1jeSA9IDAuNSAtIGlucHV0X3kqMC4yNSppbnB1dF9wcmVzc2VkOwovLyBQaW5jaCBhbmQgdHdpc3QgcmlkZSBvbiB0b3Agb2Ygd2hhdGV2ZXIgdGhlIGF1ZGlvIGlzIGFscmVhZHkgZG9pbmcuCnBlcl9mcmFtZV83PXJvdCA9IDAuMDIgKyBnZXN0dXJlX3JvdGF0aW9uKjAuMjUgKyBiYXNzKjAuMDE7CnBlcl9mcmFtZV84PXdhcnAgPSAwLjIgKyBkcmFnX2ludGVuc2l0eSoxLjU7Ci8vIFIgaXMgYSBwdWxzZSB0aGF0IGRlY2F5cyBvdmVyIH4yMjBtcywgc28gdGhpcyByZWFkcyBhcyBhIHNuYXAsIG5vdCBhIGhvbGQuCnBlcl9mcmFtZV85PXdhdmVfciA9IDAuNTUgKyBhY3Rpb25fcmVtaXgqMC40NTsKcGVyX2ZyYW1lXzEwPXdhdmVfZyA9IDAuNzUgLSBhY3Rpb25fcmVtaXgqMC41Owo%3D "examples/36-interactive-drift.milk") — drag the stage to shove the field, twist to spin it, press R to snap the colour; with no hands on it, it is an ordinary slow drift.

**These are not standard MilkDrop.** A preset that reads them will still compile and run fine elsewhere (unknown identifiers just evaluate to 0), but the interactivity silently disappears. Use them freely for Stims-native work; if portability matters, keep them behind a variable you can zero out, or skip them. The full contract, including the device-motion signals (`motion_x`/`motion_y`/`motion_z`), is in the [signal contract](../MILKDROP_PRESET_RUNTIME.md).

## What you can now build

Any preset whose personality comes from audio — which is most of them — is now legible: find the smoothing, find whether it's driving a knob directly or a clock, find the threshold logic if there's a beat effect, and measure instead of guessing.

**Next: [Track 4 — Warp fields](04-warp-fields.md)**, where knobs stop being one number for the whole screen and start varying per pixel.
