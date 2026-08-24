# Runtime performance evidence

This document defines how Stims measures frame-rate changes and which runtime
performance claims the repository can support. It is deliberately narrower
than a product-wide benchmark: one successful preset, backend, or machine does
not establish universal FPS or visual-fidelity claims.

## What the runtime measures

The certification-corpus performance runner records both delivered cadence and
work performed inside each frame:

- average and median delivered FPS;
- average, median, and p95 cadence;
- average and p95 frame work;
- simulation and render phase time;
- actual renderer backend and whether fallback occurred;
- terminal adaptive-quality step, density, render scale, and feedback scale;
- browser errors encountered during playback.

Delivered FPS is the user-visible result, but it is capped by the display and
can be distorted by scheduler stalls. Average frame work is the better signal
when a fast tier is already display-capped. Both must be reported.

## Fixed-tier comparison contract

Before/after comparisons must hold these inputs constant:

1. Preset, audio source, viewport, renderer profile, and browser build.
2. Adaptive-quality step via `--lock-quality-step`.
3. Warmup and capture windows.
4. CDP CPU-throttle rate.
5. Required backend, with fallback treated as a failed measurement.

The configured benchmark lock is independent of the temporary live-performance
hold. Releasing the live hold must reveal the configured lock rather than
silently resuming adaptation. Reports should end with the requested quality
step and a reason such as `Configured quality lock remains at balanced.`

The benchmark summary must repeat the requested warmup and duration. The
per-preset report is the source of truth for frame metrics; a run with browser
errors, the wrong backend, or renderer fallback is not comparable.

## 2026-08-24 JIT store result

Commit [`ac2b354d`](https://github.com/zz-plant/stims/commit/ac2b354d)
removed duplicate property writes from a hot EEL2 JIT path.
Per-point and per-pixel callers can deliberately pass the same object as the
engine environment and local scope. The compiled program previously stored an
ordinary local result through both references even when they were identical.
The JIT now skips the redundant mirror while preserving explicit environment
writes for `q` registers and buffer targets.

Measurement setup:

- Host: Apple M1 Max, 64 GB RAM.
- Browser path: Chromium with native WebGPU; no fallback.
- Viewport: 1280×720.
- Preset: `eos-apocalypse`.
- Audio: built-in demo audio.
- Adaptive quality: step 2 (`balanced`), locked.
- Warmup: 2,000 ms.
- Capture: 8,000 ms; the longer 8× repeat used 3,000/10,000 ms.

| CDP CPU throttle | Median FPS before | Median FPS after | Average frame work before | Average frame work after | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| 1× | 120.48 | 120.48 | 3.43 ms | 2.87 ms | Display-capped; 16.5% more frame-time headroom. |
| 2× | 120.48 | 120.48 | 7.96 ms | 6.75 ms | Display-capped; 15.2% more frame-time headroom. |
| 4× | 58.14 | 59.88 | 17.56 ms | 15.31 ms | Crossed below the 16.7 ms work budget. |
| 6× | 38.61 | 39.68–39.84 | 25.91 ms | 24.08–24.26 ms | Repeatable median and frame-work improvement. |
| 8× | 24.57 | 23.92 / 29.59 | 35.51 ms | 40.45 / 33.09 ms | Scheduler-sensitive; do not promote as a stable uplift. |

The result supports a narrow claim: the duplicate-store removal reduces frame
work for this equation-heavy stress case across the measured tiers. It does not
establish the same percentage for every preset, device, renderer, or display.

## Reproduce a tier

Start the normal dev server, then run the same preset at a fixed quality step:

```bash
bun run dev

bun run perf:certification-corpus -- \
  --port 5173 \
  --preset eos-apocalypse \
  --renderer webgpu \
  --cpu-throttle 4 \
  --viewport-width 1280 \
  --viewport-height 720 \
  --lock-quality-step 2 \
  --warmup 2000 \
  --duration 8000 \
  --output ./screenshots/runtime-perf-4x
```

Change only `--cpu-throttle` and the output directory when sweeping resource
tiers. Generated reports belong under `screenshots/` and are measurement
artifacts, not source files to commit.

## Regression coverage

- `tests/unit/milkdrop-program-jit.test.ts` asserts that aliased environment
  and local scopes receive one ordinary property write, while the bundled
  program differential tests retain interpreter/JIT equivalence.
- `tests/unit/eel-csp-fallback.test.ts` compares the JIT and interpreter-only
  paths across seeded programs.
- `tests/unit/adaptive-quality-controller.test.ts` pins the independence of a
  configured benchmark lock and the live-performance hold.
- `tests/corpus/run-certification-corpus-perf-suite.test.ts` pins custom
  evidence windows used by the summary.

Run `bun run verify --changed` during iteration and `bun run check` before
committing runtime changes. See
[`FRONTEND_PERFORMANCE_BOTTLENECKS.md`](./FRONTEND_PERFORMANCE_BOTTLENECKS.md)
for the current optimization queue.
