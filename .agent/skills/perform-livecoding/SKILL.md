---
name: perform-livecoding
description: "Play Stims as an AV instrument — live-code the audio with Strudel patterns, ride the visual params with timed gestures, and listen back to close the loop. Use when the task is performing or jamming rather than testing, debugging, or tuning preset fidelity."
---

# Perform on Stims

Stims is an instrument, not just a renderer. This skill covers playing it —
writing audio that drives the visuals, and shaping the visuals over time while
that audio runs.

## When to use

- "Play something", "jam", "perform", "do a set", "make it build then drop"
- You want the audio *and* visuals moving together, not one preset held still
- You are demoing what the instrument can do

**Not** for preset fidelity tuning (`improve-preset-fidelity`), browser QA
(`play-visualizer`), or runtime changes (`modify-visualizer-runtime`).

## The verbs

| Verb | Tool | What it is |
|------|------|------------|
| Play | `session_play_pattern` | Strudel pattern → session audio → drives the visuals |
| Shape | `session_ramp` | Glide targets over a duration, as one gesture |
| Move | `session_bind` / `session_unbind` | Continuous modulation: an LFO, or the audio itself |
| Name | `session_macro` | Save a sequence of the above and call it by name |
| Keep | `session_scene` | Snapshot positions + modulators; recall ramps into it |
| Listen | `session_listen` | Measure the real signal: RMS, bands, tempo, fps |

Setup is `start_agent_session`. Pass `headless=false` for a visible window —
a physical MIDI controller plugged into that same tab co-performs through the
same binding pipeline.

Without MCP, the same runtime is on `window.__stims_live` in any `?agent=true`
page, so `bun run dev` plus the devtools console works for quick experiments.

## Gestures vs. movement

These are different things and the instrument treats them differently.

- A **gesture** is something you do: `session_ramp`. It has a start, an end,
  and a duration.
- **Movement** is something that keeps happening: `session_bind`. It has no
  end until you unbind it.

Reaching for a ramp when you want movement is the most common mistake — it
means issuing a call per gesture forever, and anything beat-synced is
impossible because a round-trip is far longer than a beat.

They compose. A modulator is an *offset* around the value ramps leave behind:

```
value = centre + depth × source
```

So `bind` warp to a slow LFO, then `ramp` warp upward, and the wobble rides the
rising centre instead of being overwritten. This is why you rarely need to
unbind before ramping.

## Building movement

```
# kick punches zoom — short attack, longer release so it falls away
session_bind(target="zoom", depth=0.04, kind="audio", band="bass",
             attack=8, release=180)

# slow breath through the warp field, locked to the pattern's own cycle
session_bind(target="warp", depth=0.8, kind="lfo", cycles=0.25)

# stepped, unpredictable movement
session_bind(target="rot", depth=0.3, kind="lfo", shape="random", cycles=1)
```

Prefer `cycles` over `hz` — it stays locked to the pattern when the tempo
changes. `cycles: 1` is once per Strudel cycle, `0.25` once per four.

Start depths small; `min`/`max` clamp anything that runs away. Several
modulators on one target sum, so an LFO plus an audio follower on the same
parameter gives movement that breathes *and* reacts.

## A vocabulary for the piece

Macros take the same verbs, so anything performed by hand can be recorded:

```
session_macro(action="define", name="drop", steps=[
  {"unbind": {"target": "warp"}},
  {"ramp": {"targets": {"warp": 0.4}, "durationMs": 900, "curve": "exp"}},
  {"waitMs": 400},
  {"bind": {"target": "warp", "depth": 0.6,
            "source": {"kind": "lfo", "cycles": 1}}},
  {"ramp": {"targets": {"warp": 2.0}, "durationMs": 3000}}
])
session_macro(action="run", name="drop", speed=2)
```

Scenes are the other half: `save` a look you like, `recall` to ramp back into
it later — modulators and all. Both persist across reloads, so the vocabulary
survives the session that built it.

## The loop

```
play a pattern → listen (is it audible? right tempo?) → ramp visuals to match
→ capture a frame → change one thing → repeat
```

Listening is not optional politeness. `session_play_pattern` returning
successfully only means the pattern *evaluated* — `session_listen` is what
proves sound is reaching the analyser. Check `source: "stream"`; a `telemetry`
source means nothing was measured and the numbers are a frozen snapshot.

## Writing patterns

Strudel syntax. Start sparse and add layers — replacing a pattern is one call,
so iterate rather than composing a masterpiece blind.

```js
// foundation
stack(s("bd*4"), s("hh*8").gain(.4))

// add movement
stack(
  s("bd*4"),
  s("[~ hh]*4").gain(.5),
  note("<c2 eb2 f2 g1>").s("sawtooth").lpf(500)
)
```

`cps` is cycles per second: `0.5` ≈ 120bpm in 4/4. Set it on the call rather
than in the code. `session_listen` estimates tempo independently, so a
mismatch between what you asked for and what it reports means something is
wrong with the pattern, not the estimator.

Bass drives the strongest visual reactivity, so a pattern with no low end will
look inert regardless of how busy it is.

## Shaping visuals

`session_ramp` takes a map, and everything in one call moves together — that
is the difference between a gesture and a sequence of settings.

```
build:  {"warp": 2.4, "decay": 0.98}  over 6000ms
drop:   {"warp": 0.6, "zoom": 1.0}    over 1200ms, curve "exp"
bloom:  {"decay": 0.995}              over 8000ms, curve "sine"
```

- `sine` (default) eases in and out — a hand on a fader
- `linear` is mechanical; use it when you want an obviously synthetic sweep
- `exp` is back-loaded; good for gain-like targets and for drops

Ramps of 2–8s read as musical. Under ~300ms is a step change, so use
`session_midi_set` for that and save the ramp for motion you want *seen*.

The call returns when the gesture lands, so chaining calls sequences a
performance. A second ramp on a target already in flight supersedes the first
rather than fighting it — safe to redirect mid-gesture.

## Gotchas

- **Hidden tabs stall rAF.** The Browser pane reports `document.hidden = true`
  even when visible, which pauses rendering. A ramp still lands its endpoint
  (a watchdog guarantees it) but reports `forcedLanding: true` — meaning the
  motion was not smooth. If you see that, the gesture happened but nobody saw
  it. Modulation is frame-locked with no watchdog (there is nothing to
  modulate when nothing renders), so `session_bind` warns that the loop is
  **stalled** instead. The MCP session's own headless browser renders
  normally; this bites when driving a visible pane.
- **Modulators survive remounts.** They are not cleared when the workspace
  effect re-runs, so binding during startup sticks. `session_unbind` with no
  id or target clears everything.
- **First `session_play_pattern` is slow, and briefly silent.** It loads the
  Strudel engine and the dirt-samples index over the network (~700ms locally,
  longer cold), and individual drum samples stream in after the pattern starts.
  A `session_listen` immediately afterwards can honestly report `rmsMax: 0`
  because nothing is audible *yet*. Give the first pattern a few seconds before
  trusting a silent reading, or listen again. Later calls are fast.
- **A preset must be loaded first.** The runtime installs when the workspace
  mounts; the tools say so plainly if you get there early.
- **`session_hush` stops audio only.** The visualizer keeps rendering the last
  frame state, which is usually what you want between pieces.
