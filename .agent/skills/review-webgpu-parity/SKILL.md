---
name: review-webgpu-parity
description: "Review changes to WebGPU/WebGL dual-backend parity. Use when a PR touches feedback managers, renderer adapters, shader lowering, or any code that affects both WebGPU and WebGL rendering paths."
---

# Review WebGPU/WebGL Parity

Use this skill when reviewing or authoring changes to `src/js/milkdrop/feedback-manager-*`, `src/js/milkdrop/renderer-adapter*`, `src/js/milkdrop/backend-behavior.ts`, `src/js/milkdrop/compiler/gpu-descriptor-plan.ts`, or any shader-lowering code.

## Why this exists

**28% of fix commits — the #1 category.** Parity drift between WebGPU and WebGL: alpha blending order, feedback color math, wave interpolation, resolution scales, and shader lowering. The share has grown since the previous audit (~22%), so this surface is getting more fragile, not less. Measured 2026-08-27 over the last 400 commits (134 fix/revert), one category per commit by dominant file share; re-run it with [`audit-recurring-fixes`](../audit-recurring-fixes/SKILL.md) rather than trusting this number.

## Pre-merge checklist

### 1. Both backends must be exercised

- [ ] `bun run test:compat` passes
- [ ] If the change touches shader generation or feedback sampling, run the parity reference suite:

  ```bash
  bun run test tests/unit/milkdrop-renderer-adapter.test.ts
  bun run test tests/unit/milkdrop-feedback-composite-profile.test.ts
  bun run test tests/unit/milkdrop-shader-sampler-aliases.test.ts
  ```

- [ ] If the change touches compiler IR or GPU descriptor plans, run:

  ```bash
  bun run test tests/unit/milkdrop-compiler.test.ts
  bun run test tests/unit/milkdrop-compiler-seams.test.ts
  ```

### 2. No hardcoded backend-specific values without comment

- [ ] Every literal resolution scale, target size, sampler config, or blend factor is either:
  - a shared constant with a name explaining its parity role, or
  - accompanied by a comment explaining the WebGPU vs. WebGL semantic difference

### 3. Blend alpha order verified

- [ ] If changing wave, shape, or custom-wave blend behavior, confirm the additive/multiplicative/alpha order matches the projectM baseline.
- [ ] Prefer adding a regression test (see `tests/unit/milkdrop-renderer-adapter.test.ts` for patterns).
- [ ] A reference implementation (projectM source, butterchurn) tells you what
      to **try**, not what to **ship**. Shape `a2 = 0` semantics are verifiably
      butterchurn's, and applying them alone moved krash from 47% to ~90%
      because they are only correct paired with the textured-shape multiply.
      If a semantically-correct change measures worse, the usual reason is a
      second defect it now exposes — look for the pair before reverting.

### 4. Reference presets must not shift — measured, not eyeballed

Do not load the preset in `bun run dev` and compare by eye. The repo has an
oracle; use it, and judge the delta against the preset's measured noise band
(`src/data/milkdrop-parity/parity-noise-bands.json`) rather than against the
previous number:

```bash
bun run parity:capture -- --preset 260-compshader-noise_lq --preset eos-phat-cubetrace-v2
bun run parity:suite          # per-preset status + changeVerdict vs the band
```

`changeVerdict` is the answer: `improved` / `regressed` / `no-measurable-change`.
A raw delta smaller than the band is noise, whatever it looks like.

Which presets to check, and why:

| Preset | Role |
| --- | --- |
| `260-compshader-noise_lq` | Repeats bit-exactly (band 0.000pp). Any movement at all is real. Best single canary. |
| `100-square` | The tonal canary. Re-measure it after **any** color, gamma, or transfer change — a change that flatters one preset by cancelling two errors shows up here. |
| `eos-phat-cubetrace-v2`, `rovastar-parallel-universe` | Feedback- and echo-heavy; catch composite/accumulator mistakes. |

Do **not** use `krash-rovastar-cerebral-demons-stars` or
`eos-glowsticks-v2-03-music` as evidence. Their references are near-black at
every frame count probed, so a renderer that draws nothing scores as well as
one that draws correctly; `parity:suite` reports them `reference-no-signal`
and refuses to grade them.

For cross-backend divergence with no reference involved:

```bash
bun run lab:backend-diff -- --sample 24   # WebGL vs WebGPU, scored against same-backend noise
```

### 5. WebGL is not covered by the parity suite

Every certified reference is judged on **WebGPU**. A change that breaks WebGL
outright — a shader that no longer compiles, so every preset renders black —
passes the entire parity suite untouched. This has actually shipped: a display
shader called a helper that was not in scope on the WebGL path, and the
WebGPU-only captures never saw it.

- [ ] Any change to shared shader text (`feedback-manager-shared.ts` templates,
      helper consts, uniform bags) is swept on WebGL before merge:

  ```bash
  bun run sweep:milkdrop-loops -- --limit 40     # WebGL by default
  ```

  Read `consoleErrors` in `screenshots/loop-preset-sweep/summary.json`, not just
  the luminance numbers: a shader compile failure shows up there first.

- [ ] Presets that come back blank are compared against the pre-change build
      before being called a regression — several are blank already:

  ```bash
  git stash -u && git checkout <base-sha> -- src/js/milkdrop/
  bun run sweep:milkdrop-loops -- --preset <id>
  git checkout HEAD -- src/js/milkdrop/ && git stash pop
  ```

### 6. Trust the instrument before the reading

A parity number is only as good as the capture behind it.

- [ ] If `play-toy` prints `Deterministic capture drifted`, **every number from
      that run is void**. It means live frames rendered over the deterministic
      one, on the decorative audio signal instead of the pinned reference
      signal — the state being measured is not the state that was set up.
- [ ] Noise bands measured before a capture-path change are stale. Re-run
      `bun run parity:noise -- --preset <id> --repeats 3 --write` before
      judging small deltas against them.
- [ ] Attribute a delta by capture → revert → capture. If reverting does not
      restore the old number, the delta was never yours.

### 7. Prefer an invariant to a reference

The strongest parity tests need no projectM at all: derive an equality the
effect must satisfy by definition, then measure it on any capture.

Video echo is the worked example. At `fVideoEchoAlpha=0.5` with
`nVideoEchoOrientation=3`, the output is a 50/50 blend of the frame and its
180-degree rotation, so it must equal its own 180-degree rotation for *any*
content and any audio. projectM's reference self-correlates at 0.9994; ours
scored 0.665 while echo was being applied to the accumulator instead of at
display, and 0.973 after the fix — a complete diagnosis with no reference
consulted. Look for the same shape in feedback symmetry, wrap behavior, and
blend-order changes.

### 8. Shader lowering comments

- [ ] Any change to `compiler/gpu-descriptor-plan.ts`, lowered field handling, or shader center normalization includes a comment explaining how the generated GPU code differs between WebGL and WebGPU.

## What to reject in review

- Unconditional `if (isWebGPU)` branches that duplicate logic without a shared helper
- New `innerHTML` or string-built shader code without a corresponding test fixture
- Changes to `feedback-manager-shared.ts` (WebGL) with no matching change in the
  WebGPU composite (`feedback-manager-webgpu-tsl.ts`, `-composite.ts`), or an
  explanation of why the backends legitimately differ
- Shared GLSL/TSL helpers added to one shader's template but not the others
  that call them — this is the WebGL-black-screen failure mode from §5
- Missing regression tests for fixed parity bugs
- A parity number quoted without its noise band, or a "pass" on a preset the
  suite reports as `reference-no-signal`

## Related skills

- [`modify-preset-workflow`](../../modify-preset-workflow/SKILL.md) — when the change is mainly preset content, not renderer parity
- [`modify-visualizer-runtime`](../../modify-visualizer-runtime/SKILL.md) — when the change is broader runtime/shell work
- [`test-visualizer`](../../test-visualizer/SKILL.md) — for running the full validation suite
- [`improve-preset-fidelity`](../../improve-preset-fidelity/SKILL.md) — when the goal is a preset looking/reacting better rather than matching projectM

Current parity standings, open defects, and the measurement rules this
checklist enforces live in
[`docs/MILKDROP_PROJECTM_PARITY_PLAN.md`](../../../docs/MILKDROP_PROJECTM_PARITY_PLAN.md).
