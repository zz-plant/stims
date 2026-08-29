---
name: close-parity-gap
description: "Diagnose and close a rendering gap against native projectM with measured evidence: pick a reference that can actually discriminate, prove the capture describes the current build, and judge every delta against the preset's measured run-to-run noise band."
---

# Close a parity gap against native projectM

Use this skill when the task is "our render doesn't match MilkDrop/projectM"
and you need to find out why and prove you fixed it. The parity pipeline —
capture → diff → promote — is the oracle. This skill is about the three ways
it lies to you if you read it naively.

Do not open the visualizer and compare by eye. A rendering gap that is
visible by eye is already measurable, and one that isn't will not survive
your memory of what the last frame looked like.

## The pipeline

```bash
# 1. Capture the current build's frame for a preset
bun run parity:capture -- --preset <id>

# 2. Grade every certified reference against its newest capture
bun run parity:suite

# 3. Once a result is real, record it
bun run parity:promote-result -- --preset <id>
```

`bun run parity:diff` grades a single capture/reference pair when you want one
preset's per-pixel metrics without the suite. `bun run help --for "parity"`
lists the rest.

## Three ways the number lies

### 1. The reference may not be able to discriminate

Some certified references are near-black. A renderer that draws *nothing*
scores as well against them as a correct one, so a green result proves
nothing. The suite now refuses to grade against those — a result with
`referenceSignal: 'no-signal'` comes back as status `reference-no-signal`,
with the mismatch ratio reported for information only.

- Never cite **krash** or **glowsticks** as evidence. Their references are the
  ones a blank frame passes.
- **260** (bit-exact) and **100-square** (a tonal canary) are the presets that
  actually discriminate. Lead with those.
- `bun run parity:check-references` lists every reference a blank frame would
  pass, so you can check before you build an argument on one.

### 2. The capture may predate the build you are grading

A capture taken before your renderer change describes the old renderer. The
suite compares each capture's time against the newest commit touching
`src/js/milkdrop` or `src/js/core` and flags `staleCapture: true`. **A result
flagged stale is void** — re-capture, do not interpret it. (It uses commit
time, not file mtime, because checking a file out rewrites mtimes without
changing what the renderer does.)

### 3. The delta may be smaller than the instrument's own spread

Every preset's mismatch ratio moves run to run. `parity:noise` measures that
spread and writes a per-preset band to
`src/data/milkdrop-parity/parity-noise-bands.json`; the suite then reports a
`changeVerdict` per preset:

| `changeVerdict` | Means |
| --- | --- |
| `improved` / `regressed` | The delta is larger than the band. Real. |
| `no-measurable-change` | The delta is inside the band. The same build moves this much on its own — calling it an improvement is reading noise. |
| `noise-band-unmeasured` | No band exists yet. You cannot grade this preset until you measure one. |

Before believing a delta on a preset with no band:

```bash
bun run parity:noise -- --preset <id> --repeats 5 --write
```

Cite `changeVerdict`, not the raw ratio. A 0.4% improvement on a preset with a
0.9% band is not an improvement.

## The parity suite is WebGPU-only

This is the failure mode that has actually shipped: a change to shared shader
text broke WebGL, the parity suite stayed green because it never runs WebGL,
and a black screen reached users.

**If you touched shared shader text, sweep WebGL too:**

```bash
bun run sweep:milkdrop-loops -- --limit 40
```

`bun run lab:backend-diff -- --sample 24` checks WebGL and native WebGPU
render the same frame without needing any external reference, which is often
the faster way to localize a backend-specific gap.

## Prefer an invariant to a reference when one exists

A reference tells you *that* you differ. An invariant derived from the
effect's own definition tells you *how*, and needs no capture at all — video
echo's 180-degree rotational symmetry located a real bug with no reference
read. When the effect you are debugging has a property that must hold by
construction (symmetry, energy conservation, idempotence, a fixed point),
assert that first.

`bun run lab:replay` is the other localizing instrument: record a
deterministic VM trace, replay it, and bisect to the first frame where
semantics drift. `bun run trace:butterchurn` answers "which variable diverged,
on which frame" against Butterchurn.

## Closing the gap

1. Reproduce with a discriminating preset and a fresh capture.
2. Localize with an invariant, `lab:replay`, or `lab:backend-diff` — narrow to
   a stage (VM → warp/comp shader → blend → display) before editing.
3. Fix, then re-capture and re-run `parity:suite`. Read `changeVerdict`.
4. Sweep WebGL if shared shader text moved.
5. `bun run parity:promote-result -- --preset <id>` to record the measured
   result, and `bun run parity:sync-catalog` if catalog fidelity fields should
   follow.

**Verify:** `bun run parity:suite` (no stale captures, no
`noise-band-unmeasured` on the presets you are citing) and `bun run check`.
