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
- resolved WebGPU render time when the browser exposes hardware timestamp
  queries (otherwise the report remains explicitly coarse-frame timing);
- actual renderer backend and whether fallback occurred;
- terminal adaptive-quality step, GPU resolution multiplier, density, render
  scale, and feedback scale;
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
6. Production build and repetition count. The runner defaults to three trials,
   reports the median plus min/max spread, and alternates corpus order between
   trials to reduce thermal-position bias.

The configured benchmark lock is independent of the temporary live-performance
hold. Releasing the live hold must reveal the configured lock rather than
silently resuming adaptation. Reports should end with the requested quality
step and a reason such as `Configured quality lock remains at balanced.`

The benchmark summary must repeat the requested warmup and duration. The
per-preset report is the source of truth for frame metrics; a run with browser
exceptions, WebGPU validation/device errors, the wrong backend, or renderer
fallback is incomplete evidence. Non-fatal console noise remains recorded but
does not silently erase an otherwise valid trial.

## Current runtime tiering (2026-08-24)

- **Hardware timing is evidence-triggered.** WebGPU requests
  `timestamp-query` when available and drains Three.js render timestamps
  asynchronously every 30 frames. Merely advertising the feature does not
  change the timing label; the controller switches from `coarse-frame` to
  `gpu-phase-timestamps` only after a finite hardware sample resolves.
- **GPU pressure trims pixels before geometry.** Once hardware samples show
  sustained GPU pressure, a continuous multiplier adjusts render and feedback
  resolution inside the current discrete quality step. The square-root
  correction models fill cost as pixel area, changes by at most six percentage
  points at a time, and bottoms out at the greater of 72% or the feedback
  manager's truthful scale floor. Geometry density stays fixed until the
  existing discrete controller has evidence to change the whole step. A
  configured quality lock freezes both lanes.
- **Low-resource policies reuse state.** Low shader quality, low-motion, and
  mobile-low-power paths keep one scratch shell per experience and refresh it
  in place instead of cloning the frame-state object graph every frame. Debug
  snapshots detach retained data so inspection cannot observe later scratch
  mutation.
- **Dynamic GPU uploads carry capacity headroom.** Resizable vertex attributes
  grow to power-of-two item capacity, avoiding both validation failures at
  non-power-of-two geometry counts and repeated near-size reallocations.
- **GPU equation coverage fails closed.** In the bundled source corpus, 1,611
  of 1,619 presets with parsed per-pixel programs lower to the procedural GPU
  field path. The remaining eight stay on the compatible path: six use
  `randint`, whose sequential RNG semantics are not reproduced by the field
  path's stateless hash; one reads shared `gmegabuf` memory; and one depends on
  assignment side effects inside an expression. Read-only EEL variables are
  no longer among the blockers: both CPU and GPU now apply the language's
  exact zero-initialization rule.
- **Per-frame compute remains opt-in.** `bun run lab:vm-tier-bench` measures the
  upload/dispatch/readback path against the CPU JIT. On the measured preset
  samples, tiny per-frame programs took microseconds on CPU and milliseconds
  through the GPU round trip, so `gpuComputeVM` remains disabled by default.
  That result does not rule out GPU execution for parallel per-vertex work.

Evidence boundary: production browser checks on this host resolved real WebGPU
timestamps and kept native WebGPU active. Even at 4K and 6K, the sampled GPU
time was about 7.4 ms against the browser's 60 Hz budget, so those checks did
not trigger the continuous trim and do not support an FPS-uplift claim for it;
deterministic controller tests currently prove the transition behavior. A
fixed balanced-tier probe around the reusable policy shells was likewise
within noise (2.78 ms before, 2.81 ms after), so that change is claimed as
reduced allocation/GC pressure, not measured speedup. The dynamic-buffer check
did remove repeatable WebGPU validation errors at the Ultra tier.

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

The runner builds and serves production output by default. Run the same preset
at a fixed quality step and require three clean trials:

```bash
bun run perf:certification-corpus -- \
  --server production \
  --port 4173 \
  --repetitions 3 \
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
  configured benchmark lock and the live-performance hold, hardware-timing
  activation, and continuous GPU resolution transitions.
- `tests/unit/gpu-render-timing.test.ts` pins non-blocking timestamp sampling
  and renderer-generation isolation.
- `tests/corpus/run-certification-corpus-perf-suite.test.ts` pins production
  defaults, repeated-trial aggregation, spread reporting, and rejection of
  fatal browser/runtime errors.

Run `bun run verify --changed` during iteration and `bun run check` before
committing runtime changes. See
[`FRONTEND_PERFORMANCE_BOTTLENECKS.md`](./FRONTEND_PERFORMANCE_BOTTLENECKS.md)
for the current optimization queue.
