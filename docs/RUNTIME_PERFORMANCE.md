# Runtime performance evidence

Deliberately narrower than a product-wide benchmark: one successful preset,
backend, or machine does not establish universal FPS or visual-fidelity claims.

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

## 2026-10-11 hardware spot-check (headed tab, not the fixed-tier runner)

Method and its boundary: the host's headless tools render with SwiftShader, so
this pass drove the live dev server (`806f8984`) in a headed,
hardware-accelerated tab (native WebGPU, no fallback) and sampled delivered
rAF cadence in-page over 240-frame windows via `__stims_agent`, plus one
JavaScript CPU profile. It is a spot-check, not the certification runner:
dev build, no CDP throttle, no three-trial median, single machine. Numbers
below narrow what to measure next; they support no universal FPS claim.

Setup: Apple M-series, 120 Hz display (8.33 ms budget), quality step 0,
renderScale 1.25, demo audio, `shifter-glassworms-flare` and `eos-apocalypse`.

| Observation | Result |
| --- | --- |
| `shifter-glassworms-flare` cadence | p50 8.30 ms — the vsync floor, not a work measurement. The tail (p95 9.3–10.3 ms across runs, one 16.6 ms skip) shows roughly one frame in ten missing vsync. Sub-budget frame work is not resolvable by cadence sampling. |
| `eos-apocalypse` cadence | p50 8.3 ms (vsync floor), p95 10.0 ms — roughly one frame in five misses vsync on the strongest consumer tier; frame work under the budget is not resolvable from cadence. |
| JS CPU profile, glassworms, 7.3 s | `runProgram` self ~2.0 s plus anonymous JIT program bodies ~2.5 s of 6.5 s sampled: ~68% of non-idle JavaScript in the VM/EEL, matching the ~59% share the 2026-08 profile found. The JIT bodies' self time is the largest single bucket. |
| WebGPU render bundles A/B ×2 | p95 10.1–10.3 ms both conditions; the deltas are within run-to-run noise. No cadence-level effect (sub-budget work savings would be invisible to this method); the flag stays off. |
| Blend crossfade cadence (×2) | During-blend p50/p95 (8.3/10.3) ≈ steady state (8.3/10.1): the outgoing preset's full VM step is invisible in cadence at this tier. |
| Transition-start spike (×2, reproduced) | One to two single frames of 258–433 ms at blend start on every preset switch — the most user-visible artifact measured. |
| `cloneBlendState` context | Its 2.5–8 ms synthetic tail is second-order next to the 250–430 ms transition-start spike; revisit after that is fixed. |

Narrow claims: on the strongest consumer tier both presets ride the vsync
ceiling with a missed-frame tail (one frame in ten and one in five), which
bounds work *above* the budget only — cadence sampling cannot say how much
headroom remains below it, and weaker devices also adapt to lower quality
steps. The weaker-tier deficit is established by the fixed-tier runner
instead (the 2026-08-24 table: `eos-apocalypse` at 15.31 ms of a 16.7 ms
budget under 4× CPU throttle, locked step 2), not by this spot-check. What
this spot-check does establish on its own: EEL evaluation dominates the
JavaScript profile, so JIT-side work targets the measured center of mass;
the transition-start spike is real, reproducible, and outranks the
per-frame crossfade cost at this tier. The mid-range reality still requires
the fixed-tier runner on a host whose headless browser is not
software-rendering.

**Follow-up: the spike's fix shipped, unverified by this method.** #1422
(`7c646016`, 2026-10-12) compiles the incoming preset's WebGPU pipelines
before the fade begins and holds the fade for up to 1,500 ms
(`runtime/preset-switch-warmup.ts`). The deadline was tuned from warm-up
durations measured on this hardware (236 ms to 1,611 ms per preset), and
a deadline miss measured a 50–68 ms hitch rather than a cold build. Switch
cadence has not been re-sampled with the headed-tab method above, so the
258–433 ms rows stand as the before measurement only.

## 2026-10-11 Inlined RNG and repeated-read caching in the JIT

Two changes to the CPU JIT, aimed at the per-point/per-vertex hot path that
the shifter-glassworms-flare profile attributes ~68% of non-idle JavaScript to
(anonymous JIT bodies plus TurboFan-inlined bodies attributed to
`runProgram`):

- **Inlined RNG.** `rand()`/`randint()` drew through a per-call closure
  (`vm.ts` `nextRandom`). The VM now passes its RNG state as a mutable cell
  and the compiled body advances the LCG in place — one cell load on entry,
  one store on exit, no call per draw. The interpreter-backed CSP fallback
  draws through the same cell, so the two tiers interleave on one sequence.
  The conformance contract is unchanged: `compileMilkdropProgram` keeps a
  `'closure'` mode whose `rng` argument is a host-supplied draw callable, and
  `spec/eel-conformance/` runs that tier (the corpus pins every draw to a
  fixed 0.5, which only a callable can reproduce).
- **Repeated-read caching.** Identifiers read two or more times within one
  statement — the `x = if(x, x, ...)` idiom that dominates this preset's
  per-point blocks — now read once into a temp and splice it for the repeats.
  The cache is per-statement and invalidated by any store to the variable;
  conditionally-evaluated regions (`if` branches, the right side of `&&`/
  `||`, loop bodies) either compile from a snapshot or drop the cache, so a
  temp assigned on an untaken path can never be observed. Identifiers read
  once emit exactly what they did before.

Evidence, all on this host (SwiftShader; timing numbers are INDICATIVE ONLY,
never a hardware claim):

- `lab:replay --record` on unchanged code, then replay after both changes:
  240 frames of `shifter-glassworms-flare` verified **bit-for-bit** — the RNG
  sequence and every cached read are semantically identical.
- Emitted read count for the preset's two 74-statement per-point bodies:
  410 → 326 env reads per 512-point pass (−20%); the isolated closure draw
  cost ~16.6 ns/call (Bun/JSC microbench), so the inline form removes the
  call boundary rather than measurable per-draw arithmetic.
- Tier agreement: 500 seeded interpreter-vs-JIT programs with rand/randint
  in loops, `if` branches, and mixed q-register writes (both RNG modes),
  the CSP fallback on the same cell, and the bundled-fixture differential —
  all green; mutation checks (LCG constant, store invalidation, region
  barriers) confirmed each new test goes red on the corresponding bug.

Known pre-existing divergence found during this work (not introduced, not
fixed): a random call *inside another random call's argument* draws in
opposite orders on the interpreter (args first) and the JIT (draw first);
two bundled `cotc-suksma-*` presets nest `rand` but run on the JIT tier
consistently, so production output is unaffected. The conformance corpus
cannot express it (a fixed draw hides draw order).

Browser-frame verification (V8, real WebGPU, per the 2026-08-24 setup above)
was the outstanding item for both changes; the measured result follows.

## 2026-10-12 hardware result: RNG inlining + statement-local read caching

Measured on the same machine as the 2026-10-11 spot-check, with the runner
itself (`perf:certification-corpus --no-headless`, real WebGPU,
`timingMode: gpu-phase-timestamps`, quality step 1 locked, three trials):

- Before (main, 2026-10-11 corpus sweep): `shifter-glassworms-flare`
  **median 5.24 ms** average frame work.
- After (this change): **median 4.51 ms** (trials 4.41 / 4.51 / 4.72;
  `fallbackOccurred: false`; simulation phase 3.73 ms).

That is a **14% reduction in median frame work for the heaviest preset in
the certification corpus**, with output proven identical by the replay and
differential instruments above. The claim stays narrow: it is this preset's
shape (repeated identifier reads inside large per-point bodies plus RNG
draws) on this hardware at one quality step — not a universal percentage
for every preset, device, or renderer, and the delivered FPS stays
display-capped either way (medianFps 120.48 before and after).

## 2026-10-12 hardware result: unreferenced per-vertex built-ins skipped in the mesh transform

The mesh lane's change (skip computing per-vertex built-ins the per-pixel
program never references; seeded/derived values read frame constants that
are bit-identical to the old per-vertex resets) is proven output-identical
by trace and mesh digests. Measured with the same hardware protocol as the
2026-10-11 spot-check (runner, `--no-headless`, real WebGPU, quality step 1
locked, three trials), on `eos-apocalypse` (references few per-pixel
built-ins):

- Before (main, 2026-10-11 corpus sweep): median 4.14 ms average frame work
  (trials 3.78 / 4.14 / 4.49).
- After: **median 3.77 ms** (trials 3.37 / 3.77 / 4.18) — the entire
  after-spread sits below the before-median, and min, median, and max all
  moved down.

That is a **9% median reduction on the mesh-heavy stress preset on top-tier
hardware**, where the skipped stores and trig are relatively cheap — the
structural reduction is larger in count (14 writes → 7, 13 post-reads → ~7,
2 trig/frame → 0 on this preset), so weaker tiers, where property stores and
`Math.cos`/`Math.sin` are relatively costlier, are the real target. Narrow
claim: this preset, this hardware, one quality step; the microbench on
presets that reference nearly all built-ins read ±1% (noise), as expected —
their per-vertex loops are unchanged.

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
- `packages/milkdrop-toolchain/tests/eel-csp-fallback.test.ts` compares the JIT and interpreter-only
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
