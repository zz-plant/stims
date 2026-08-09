---
name: improve-preset-fidelity
description: "Iteratively improve a MilkDrop preset's visual fidelity and audio reactivity using the preset lab's measured reports. Works for agents with or without computer vision or hearing — all verdicts are numeric/text; images are optional extra evidence."
---

# Improve preset fidelity and audio reactivity

Use this skill when the task is to make a preset (or the runtime behind it)
look better or react to audio better, and you need objective evidence that an
edit helped. The preset lab replaces "eyeball it in the browser" with measured
baseline → edit → compare loops.

## Pick your tier by what you can sense

| Your capabilities | Tool | What you get |
| --- | --- | --- |
| Text only (no vision, no hearing) | `bun run lab:reactivity` | Per-variable audio→motion correlations, verdicts, band influence. Pure bun VM run, no browser, ~15s, fully deterministic. |
| Text only, needs rendered-pixel truth | `bun run lab:visual` | Numeric luminance/contrast/colorfulness/motion metrics and a pixel-level reactivity verdict from headless Chromium. |
| Computer vision | both + the lab's PNGs | Everything above, plus `contact-sheet.png` (whole run in one image) and `comparison.png` (baseline vs current side-by-side). |

Never a reason to skip the lab: even with vision, the numbers are what make
"did my edit help?" answerable without taste disputes.

## The iteration loop

```bash
# 1. Snapshot the current behavior as the baseline
bun run lab:reactivity -- --preset <id> --baseline
bun run lab:visual -- --preset <id> --baseline

# 2. Edit the preset (public/milkdrop-presets/<id>.milk) or runtime code.
#    Equation semantics: docs/MILKDROP_CODING_GUIDE.md

# 3. Measure again and compare — ▲ improved / ▼ REGRESSED lines tell you
#    exactly which metrics moved
bun run lab:reactivity -- --preset <id> --compare
bun run lab:visual -- --preset <id> --compare
```

Reports land in `scratch/preset-lab/<id>/` (gitignored — never write captures
into `screenshots/`, it is tracked). `--json` prints machine-readable output;
`--file path.milk` measures an uncatalogued preset.

## Reading a reactivity report

- **Band influence** — strongest |correlation| any variable reaches per
  band-isolated scenario (bass-pulse / mid-pulse / treble-pulse / full-mix).
  Near 0 for every band = the preset effectively ignores audio.
- **Verdicts per variable** — `reactive` (audio drives it), `autonomous`
  (moves on its own, audio-indifferent), `static` (never moves), `weak`.
- **`via delta`** — the variable is an accumulator (`x = x + vol*speed`);
  audio drives its *rate of change*. This is a healthy MilkDrop idiom, not a
  defect.
- **Derived series** — `mainWave.deviation` (waveform amplitude),
  `customWaves.deviation` (wavecode per-point output), `shapes.motion`
  (shapecode output) catch presets whose reactivity never touches per-frame
  variables. A preset can be fully reactive with every named variable static.
- **Code references** — the report lists which audio inputs (`bass_att`,
  `vol`, …) appear in the preset's equations. References with no measured
  reactivity usually mean a broken or swamped term.

## Reading a visual report

- `verdict: audio-reactive` — demo audio multiplies pixel motion ≥1.3× over
  silence, or motion tracks audio energy (corr ≥ 0.5).
- `verdict: ambient-motion` — animates but audio changes nothing visible.
- `verdict: blank / static / broken` — fidelity bugs; fix before tuning
  reactivity. `near-black frames`, `visible pixels`, and `console errors`
  point at the failure class.
- Contrast (`luminance σ`), `colorfulness`, and `clipped highlights` are the
  fidelity dials: washed-out presets show low σ, monochrome presets show
  colorfulness near 0, blown-out presets show high clipped ratio.

## With computer vision

Read `scratch/preset-lab/<id>/visual/contact-sheet.png` — rows are
silence/demo, columns are time — to judge composition, palette, and motion
character in one image. After `--compare`, read `comparison.png` for a
baseline-vs-current side-by-side. For ground-truth fidelity against native
MilkDrop, the projectM reference frames live in
`tests/fixtures/milkdrop/projectm-reference/` and the parity pipeline
(`bun run parity:suite`) scores against them.

## Gotchas

- Another agent's dev server may be running; `lab:visual` uses port 5197 by
  default — pass `--port` if it collides.
- Reactivity runs are deterministic (VM RNG is seeded from the preset id);
  visual runs are approximately stable but not bit-identical, so compare with
  the built-in tolerances, not exact equality.
- Presets ship from `public/milkdrop-presets/` — never edit `dist/` copies.
- WebGPU behavior can differ: re-run `lab:visual -- --renderer webgpu` when a
  change touches shader codegen.

## Validation before sign-off

```bash
bun run check:quick          # includes catalog fidelity/integrity guards
bun run test:compat          # when preset parsing/runtime support changed
bun run check                # before any commit/PR
```
