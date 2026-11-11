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

Production beacons carry the same split (#1641). Each `preset-dwell` row has
average simulation, render, GPU and cadence milliseconds, the quality step and
render scale when the view ended, and the flash guard's state and where it read
pixels. They carry no session or visitor id. `bun run telemetry:report` sorts
rows into on target, simulation-bound, render or GPU-bound, and unattributed.
Unattributed means cadence over 1.12x a 60 Hz budget with tracked work under
0.85x of it, so the time went somewhere the runtime doesn't time.

### Unattributed cadence and the quality controller

Unattributed loss reads as no pressure, because lowering quality can't fix a
cost that doesn't scale with it. After 60 samples of it the controller takes one
trial step and judges it 45 samples later. It keeps the step if cadence improved
by at least 5%, and protects it from recovery for 1,800 samples, so its own
headroom doesn't undo it. Otherwise it restores the step and holds off for 1,800
samples, doubling up to 14,400 after each failed trial. A preset switch drops an
unjudged trial, and a locked step is never trialled.

### When `lab:profile` numbers can be trusted

`bun run lab:profile` runs on a Vite dev server by default and warns that it
does. Use those numbers to rank functions and to compare against the same
machine's checked-in baseline. They don't describe production: a dev run of one
preset made 1,030 synchronous flash-sampler reads in 20 s, where production made
none (#1640).

For what visitors get, use `bun run lab:profile -- --server production --preset
<id>`. It builds first, and function names in the profile are minified. It
refuses the baseline, which holds dev-server numbers.

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
  [Re-measured 2026-11-04](#2026-11-04-webgpu-platform-features-1541).

Evidence boundary: production browser checks on this host resolved real WebGPU
timestamps and kept native WebGPU active. Even at 4K and 6K, the sampled GPU
time was about 7.4 ms against the browser's 60 Hz budget, so those checks did
not trigger the continuous trim and do not support an FPS-uplift claim for it;
deterministic controller tests currently prove the transition behavior. A
fixed balanced-tier probe around the reusable policy shells was likewise
within noise (2.78 ms before, 2.81 ms after), so that change is claimed as
reduced allocation/GC pressure, not measured speedup. The dynamic-buffer check
did remove repeatable WebGPU validation errors at the Ultra tier.

## Open

The optimization queue, verified against the code on 2026-10-13. The audit it came from is [archived](./archive/FRONTEND_PERFORMANCE_BOTTLENECKS.md) with its list of fixed bottlenecks.

### 1. Re-measure preset switches after #1422

The 258–433 ms single frames at blend start (2026-10-11 spot-check below) had a fix ship the next day; switch cadence has not been re-sampled since. Re-run the headed-tab cadence sampling on `next-preset` crossfades, on WebGPU, with and without a deadline miss.

### 2. Blend-state cloning at transition start — bounded, unproven

`cloneBlendState()` deep-copies wave positions, custom waves and motion
vectors once per accepted transition, never per frame, so cold-call and tail
latency matter more than a warmed average. The copy is required: the frame
state's buffers are reused every frame, and aliasing them would corrupt the
fading-out preset. Measured in isolation on synthetic frames under Bun
(JavaScriptCore, not V8, so the shape is indicative), 3 fresh-process runs per
row, 3,000 individually timed calls, 2026-09-29:

| Frame density                            | Cold first call | p50     | p95     | Worst (max) |
| ---------------------------------------- | --------------- | ------- | ------- | ----------- |
| 4 custom waves × 512 pts                 | ~0.2 ms         | 0.01 ms | 0.06 ms | 1.6–2.8 ms  |
| 8 waves × 1024 pts, 200 motion vectors   | ~0.6 ms         | 0.06 ms | 0.27 ms | 3.0–5.4 ms  |
| 16 waves × 2048 pts, 1000 motion vectors | ~2.5 ms         | 0.33 ms | 1.0 ms  | 5.4–7.8 ms  |

On the densest case the cold call is about 15% of a 16.7 ms frame and the
worst tail 5–8 ms, so one transition frame on a very dense preset could miss
budget; `evaluateBlendGate` already refuses to crossfade those above its
workload ceiling. No real browser transition has measured it. Pre-allocated
blend buffers are the idea on file, after item 1 shows what remains.

## Deliberate boundaries

Each of these was measured or reasoned through and left as is. Re-open one only with the evidence it names.
- **Queue-write speedups need no adoption; linear canvas colour spaces and
  transient colour targets stay out.** See
  [the 2026-11-04 decisions](#2026-11-04-webgpu-platform-features-1541). Re-open
  transient attachments for a depth-using pass only once removing depth has been
  tried, and wide gamut only after an eye check on a P3 display.
- **WebGPU render bundles stay off.** The 2026-10-11 hardware A/B below
  found no cadence effect. Re-evaluate only with a component-level profile
  showing CPU submission time that cadence sampling cannot see.
- **The eight per-pixel lowering misses stay on the CPU** (see "GPU equation
  coverage fails closed" above). For the six `randint` callers: the VM's RNG
  is a linear congruential generator advanced once per call in program order (the shared
  `randomCell` in `vm.ts`, inlined into compiled bodies), so its sequence
  depends on evaluation order, which per-pixel GPU execution does not have.
  Lowering it would change what these presets draw, not just where. It is
  not a small cost either: `shifter-glassworms-flare` calls `randint` 59
  times and profiles at about 59% EEL VM
  (`bun run profile:frame -- --preset shifter-glassworms-flare`).
  For the `gmegabuf` reader: moving it needs a coherent storage binding and
  ordering contract, and zero or a stale CPU snapshot would only hide the
  dependency. For the nested `exec2` assignment: the field descriptor is a
  pure expression tree, so lowering it would lose evaluation order and side
  effects.
- **WebGPU sessions still ship WebGL's three.js code; the fix is upstream.**
  `three.core.js` holds the classes both renderers share; only
  `three.module.js` adds `WebGLRenderer`, and splitting them in
  `manualChunks` isolates 82 KB gzipped. It does not help: 43 of our modules
  import from `'three'`, which is `three.module.js`, so rolldown merges it
  back into the core chunk (the split chunk hash came back byte-identical).
  Making `webgl-renderer.ts` a dynamic import changed the eager payload by
  nothing (503 KB / 43 files either way) and was reverted. Avoiding it needs
  per-backend builds or a public core-only entry from three. Measured
  2026-08-27.
- **The many small chunks are the price of four HTML entries.** 61 of 102
  chunks were under 5 KB (105 KB total). Grouping app code by directory in
  `manualChunks` cut the count to 60 and took the eager payload from 503 KB
  to 2,237 KB, because the groups dragged lazily imported renderer code into
  the entry graph; a utils-only grouping traded 3 fewer requests for 39 KB of
  extra critical-path bytes. Measured 2026-08-27; do not re-attempt without a
  per-entry reachability model.

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

| CDP CPU throttle | Median FPS before | Median FPS after | Average frame work before | Average frame work after | Interpretation                                          |
| ---------------- | ----------------: | ---------------: | ------------------------: | -----------------------: | ------------------------------------------------------- |
| 1×               |            120.48 |           120.48 |                   3.43 ms |                  2.87 ms | Display-capped; 16.5% more frame-time headroom.         |
| 2×               |            120.48 |           120.48 |                   7.96 ms |                  6.75 ms | Display-capped; 15.2% more frame-time headroom.         |
| 4×               |             58.14 |            59.88 |                  17.56 ms |                 15.31 ms | Crossed below the 16.7 ms work budget.                  |
| 6×               |             38.61 |      39.68–39.84 |                  25.91 ms |           24.08–24.26 ms | Repeatable median and frame-work improvement.           |
| 8×               |             24.57 |    23.92 / 29.59 |                  35.51 ms |         40.45 / 33.09 ms | Scheduler-sensitive; do not promote as a stable uplift. |

The result supports a narrow claim: the duplicate-store removal reduces frame
work for this equation-heavy stress case across the measured tiers. It does not
establish the same percentage for every preset, device, renderer, or display.

## 2026-08-24 startup and deploy-build result

Measured on the same checkout and machine:
- Cold Chromium production load, three fresh contexts, service workers
  blocked, 4× CPU throttle, 150 ms latency, and 200,000 bytes/s downstream:
  median `shell-rendered` improved from 2,288.4 ms to 2,120.7 ms, while
  requests completed before the shell fell from 57 to 51.
- Local `bun run site:build`, timed end to end: 3.97 s before concurrent build
  orchestration and 2.74 s after it. The output still contains
  `dist/_worker.js/index.js`, `.assetsignore`, and the complete public preset
  libraries.

These are focused before/after measurements, not production-SLA claims.
Re-run them when the entry graph, Worker compiler, or build host changes.

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

| Observation                             | Result                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifter-glassworms-flare` cadence      | p50 8.30 ms — the vsync floor, not a work measurement. The tail (p95 9.3–10.3 ms across runs, one 16.6 ms skip) shows roughly one frame in ten missing vsync. Sub-budget frame work is not resolvable by cadence sampling.                |
| `eos-apocalypse` cadence                | p50 8.3 ms (vsync floor), p95 10.0 ms — roughly one frame in five misses vsync on the strongest consumer tier; frame work under the budget is not resolvable from cadence.                                                                |
| JS CPU profile, glassworms, 7.3 s       | `runProgram` self ~2.0 s plus anonymous JIT program bodies ~2.5 s of 6.5 s sampled: ~68% of non-idle JavaScript in the VM/EEL, matching the ~59% share the 2026-08 profile found. The JIT bodies' self time is the largest single bucket. |
| WebGPU render bundles A/B ×2            | p95 10.1–10.3 ms both conditions; the deltas are within run-to-run noise. No cadence-level effect (sub-budget work savings would be invisible to this method); the flag stays off.                                                        |
| Blend crossfade cadence (×2)            | During-blend p50/p95 (8.3/10.3) ≈ steady state (8.3/10.1): the outgoing preset's full VM step is invisible in cadence at this tier.                                                                                                       |
| Transition-start spike (×2, reproduced) | One to two single frames of 258–433 ms at blend start on every preset switch — the most user-visible artifact measured.                                                                                                                   |
| `cloneBlendState` context               | Its 2.5–8 ms synthetic tail is second-order next to the 250–430 ms transition-start spike; revisit after that is fixed.                                                                                                                   |

Narrow claims: on the strongest consumer tier both presets ride the vsync
ceiling with a missed-frame tail (one frame in ten and one in five), which
bounds work _above_ the budget only — cadence sampling cannot say how much
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
  `bun run spec:eel` runs that tier (the corpus pins every draw to a
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
fixed): a random call _inside another random call's argument_ draws in
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

## 2026-11-04 Flash guard frame cost (#1640)

Reduce flashing, on by default, cost up to 25 fps at 6x CPU throttle, and the frame tracker did not see it: `averageFrameMs` moved by about 1 ms. The filter was not the cause. Converting and judging each sample on the main thread was, so both moved into the sampler's worker.

Host: Apple M1 Max, headless Chromium, production build, 1280x720, demo audio, CDP 6x throttle. `bun run lab:flash-sampler-bench -- --delivered` prints this table, walking one page through the stages in A-B-B-A order. Each cell is two 6-second windows.

| Backend | Preset | Reduce flashing off | Before | After | Main-thread ms per reply, before → after |
| --- | --- | --- | --- | --- | --- |
| WebGL | `martin-journey-into-space` | 60, 60 | 45, 47 | 60, 60 | 9.02 → 0.03 |
| WebGL | `martin-dune-racer` | 60, 60 | 49, 51 | 60, 56 | 9.42 → 0.01 |
| WebGPU | `martin-journey-into-space` | 60, 59 | 43, 39 | 60, 60 | not measured → 0.04 |
| WebGPU | `martin-dune-racer` | 60, 60 | 51, 51 | 60, 60 | not measured → 0.02 |

Before the move, capture alone held 60 fps, and so did a worker readback with its result discarded (60, 60 on three rows and 60, 57 on the other), which is what located the cost. Skipping the filter write did not help on WebGL (46, 43 and 49, 51), and these presets made no filter writes in those windows.

Captures rose with it, from 34–49 a second to 55–60, so the governor now compares more consecutive frames on these presets. Decisions came back 5–14 ms after the snapshot was posted to the worker.

**What this does not establish:**

- CDP throttles the main thread and not the worker, so that latency is a floor for a slow device, and the worker's own cost on one is unmeasured. No phone or tablet was measured.
- Without throttling, `martin-journey-into-space` showed no clear loss before the change.

Live dimming on two strobing presets on both backends, 25 s each without throttle, stayed comparable: the lowest brightness was 0.06–0.09 after and 0.05–0.11 before, and the stage was dimmed for 81–99% of the run either way.

**The permanent fallback was reachable.** The sampler gave up on its worker when one capture went unanswered for a second, and a main thread blocked that long had the reply still queued behind the frame that noticed. In a dev server run on WebGPU, one heavy preset made 1,030 synchronous reads in 20 s (3,369 ms), and a WebGL profile of it showed `getImageData` at 36% of main-thread time. The sampler now waits to see the capture stay unanswered, and the same WebGPU run made none, which fits that cause without proving it. How often production reached it is unknown, and `substitution-flash-sampler-main-thread` now counts it. A lost worker is retried after 30 s, doubling to at most 5 minutes.

## 2026-11-07 CPU JIT spike (#1642)

This spike compared three independent edits to the generated JavaScript for
the catalog versions of four presets. Each trial used the Vite production build
from `07a7e719` with the spike wired in, headless Chromium 156.0.8078.4, WebGL
via ANGLE Metal on an Apple M1 Max, CDP 6× CPU throttle, a 1280×720 viewport,
demo audio and a locked balanced quality step (2). Every condition started in
a fresh browser context with autoplay disabled. After 2.5 seconds of warmup,
the runtime tracker collected at least 120 more frames. Each trial reports the
mean simulation phase over its final 120 frames. The four rounds rotated preset
order and counterbalanced condition order so each condition occupied each
position once per preset.

- **Local promotion** kept private wave and mesh temporaries in JS `let`
  bindings. Writes that feed later points, draw output, and RNG state stayed
  on the existing path.
- **Frame hoisting** moved Glassworms' frame-dependent rotations and register
  terms and Curlique's sine coefficients into a per-pass prelude. Glowsticks'
  eligible terms were register reads.
- **Vertex caching** reused Float64 arrays for sample-only terms in the waves
  and for Curlique's fixed mesh basis. Curlique's dynamic motion-vector
  positions still evaluated the original expressions. The arrays were rebuilt
  when the sample count or mesh lattice changed.
- **Bridge of Khazad-Dum** served as a control. Its per-pixel program writes
  three constants directly to output fields, so all four conditions used the
  same generated body.

Times are median trial means in milliseconds, with min–max in brackets.
Positive percentages indicate a reduction from the same preset's baseline.

| Preset | Baseline | Local promotion | Frame hoisting | Vertex caching |
| --- | ---: | ---: | ---: | ---: |
| `shifter-glassworms-flare` | 10.09 [9.25–10.46] | 6.57 [6.23–7.22], +34.9% | 8.66 [8.39–8.91], +14.2% | 9.25 [9.08–9.54], +8.3% |
| `eos-glowsticks-v2-03-music` | 11.70 [11.35–12.99] | 7.21 [6.74–7.47], +38.4% | 11.80 [11.67–11.99], -0.9% | 12.27 [11.67–12.76], -4.9% |
| `shifter-curlique` | 7.14 [6.30–7.44] | 6.97 [6.34–7.16], +2.4% | 6.28 [5.99–7.06], +12.1% | 7.13 [6.48–7.54], +0.2% |
| `martin-the-bridge-of-khazad-dum` | 9.61 [9.16–11.47] | 10.34 [8.95–10.75], -7.6% | 10.36 [10.09–12.12], -7.9% | 9.90 [8.88–11.87], -3.0% |

**Local promotion cleared the 15% gate** on Glassworms and Glowsticks. The
reduction was at least 31% in every round on both presets. Curlique's 2.4%
median reduction fell below the gate.

**Frame hoisting and vertex caching fell below the gate.** Hoisting came
closest on Glassworms (14.2%) and Curlique (12.1%). Vertex caching peaked at
8.3% on Glassworms. Bridge's unchanged program varied between 8.88 and
12.12 ms across conditions, which gives a sense of the timing noise in a
single trial.

For correctness, each candidate and the baseline JIT matched the interpreter
bit for bit on 120 deterministic WebGL VM frames per preset, using the
`lab:replay` beat-pulse inputs and changing aspect ratio and detail scale
mid-run. The comparison included numeric frame state and geometry buffers.
A separate production Chromium run requested local promotion with
`script-src 'self'`. The VM's JIT probe was blocked, and Glassworms kept
rendering in WebGL through the interpreter.

The tracked change records the spike. The four-preset result qualifies
local promotion for the issue's separate compiler-pass evaluation on a
12-preset sample.

## 2026-11-11 Local promotion in the JIT (#1642)

Local promotion is now a compiler pass in `expression-jit.ts`. A variable is
kept in a JS local for the length of one call when no call can tell the
difference:

- every read follows a write made earlier in the same call, on every path (a
  write inside a `loop` or `while` body counts only for the rest of that body);
- a statement outside any loop writes it;
- every read spells it the way the store does (`SAM` reads `e["SAM"]` before
  `e["sam"]`);
- no assignment nested inside an expression writes it;
- it is not a `q`/`t` register or a buffer.

Each local is stored back once, through the statement path's own store, when
the call ends. The env, locals, state and register bank therefore hold the
same values after every call as before. Of the 10,307 program blocks in the
1,787-preset catalog, 8,846 promote at least one variable. Each per-point body
of `shifter-glassworms-flare` promotes 28, where the spike picked 21 by hand.

**Output.** Old and new JIT gave the same values on every preset in the
catalog: 30 frames each on both backends, 107,220 frame digests. 129 presets
differed only in key order. A call now creates a promoted variable's key at
its end rather than at its first write, so the first frame can enumerate keys
in a different order. Sorting keys made all 7,740 of their digests match. The
inspector sorts its rows by name, and trace capture sorts its keys. `lab:replay`
traces recorded on main replayed bit for bit on the change: 240 frames each
of the 12 presets below. Against the interpreter, 198 of 199 sampled presets
(every ninth) matched exactly on both backends over 40 frames. The exception,
`stahlregen-benski-fvese-geiss-rovastar-voyager-spark-call-jester-s-smashing-atoms-rmx-1`,
already differs from the interpreter on its WebGL mesh under main's JIT, and
the new JIT matches main's there.

**Time.** Production builds of `d34630ca` with and without the pass, headless
Chromium 158 on WebGL through ANGLE Metal, Apple M1 Max, CDP 6× CPU throttle,
1280×720, demo audio, balanced quality step (2) locked. Each trial used a
fresh browser context, waited 2.5 s, then read the runtime tracker's mean over
its last 120 frames. Three rounds put each condition in each position once per
preset. `rediculator-qrem-glob` logged a console error on every build, so the
runner rejected its trials and 11 presets remain.

Simulation phase, median of three trials in milliseconds, with min–max in
brackets:

| Preset | Before | After | Change |
| --- | ---: | ---: | ---: |
| `schglasmia-danqueer` | 25.70 [25.64–26.87] | 18.13 [17.31–18.55] | −29.5% |
| `eos-glowsticks-v2-03-music` | 12.25 [11.88–12.31] | 8.59 [8.11–8.84] | −29.9% |
| `shifter-glassworms-flare` | 9.74 [9.14–10.08] | 7.06 [6.94–7.37] | −27.6% |
| `flexi-age-of-shading-chaos` | 14.11 [13.35–14.38] | 10.32 [9.98–10.43] | −26.9% |
| `eos-apocalypse` | 20.09 [19.92–20.47] | 15.08 [14.93–15.29] | −24.9% |
| `shifter-digi` | 22.22 [21.82–22.27] | 16.90 [16.03–17.66] | −24.0% |
| `martin-the-bridge-of-khazad-dum` | 10.31 [9.73–10.41] | 9.24 [9.09–9.52] | −10.4% |
| `eos-phat-magnetosphere-13-pulsar` | 7.34 [7.23–7.54] | 6.72 [6.38–6.82] | −8.4% |
| `krash-rovastar-cerebral-demons-stars` | 11.04 [10.95–12.18] | 10.27 [10.04–10.82] | −7.1% |
| `martin-journey-into-space` | 6.13 [5.90–6.52] | 5.96 [5.90–6.29] | −2.7% |
| `shifter-curlique` | 6.93 [6.86–7.32] | 7.08 [6.86–7.17] | +2.2% |

The median reduction is 24.0%, against the issue's 15% gate. The six presets
with the heaviest per-point or per-pixel code in the sample each lost 24–30%,
and their mean frame work fell by 9.9–14.2%. Render time did not move: its
medians stayed within 3.2% either way on every preset. `shifter-curlique` and
`martin-journey-into-space` run seven per-pixel statements or fewer and no
custom waves, and their before and after ranges overlap.

What this does not establish: any device other than this one, the WebGPU
backend's CPU time, or unthrottled frames, where these presets are display
capped. Delivered frame rate rose about 10% on the heavy six, but every
condition here sits below 30 fps, so that number is about this throttle.

## 2026-11-04 WebGPU platform features (#1541)

Each item in [#1541](https://github.com/zz-plant/stims/issues/1541) gets a decision
here, and none adopts a feature or changes the renderer. The depth prototype
described below has not been run.

| Feature | Decision | Reason |
| --- | --- | --- |
| Faster `writeBuffer`/`writeTexture` (Chrome 144) | Nothing to adopt; close | Queue writes take under 1% of a frame on the default path |
| Transient attachments (Chrome 146) | No colour target qualifies; depth only, after trying no depth at all | Transient textures cannot be sampled |
| `srgb-linear` / `display-p3-linear` (Chrome 155–156) | Do not adopt | Accurate output changes nothing visible; a linear canvas changes every preset's brightness |
| Subgroup size control (Chrome 151) | Not adopted | Only serves `gpuComputeVM`, which stays off (see the table below) |

### Upload measurement

Host: Apple M1 Max, adapter `apple` / `metal-3`, not a fallback adapter, page
cross-origin isolated (timer resolution 5 µs). Times were taken 2026-11-04
between 07:07 and 07:28, with each run starting only once the 1-minute load
average was under 6. Five runs per build, alternating builds; the figures are
the median across runs of each run's median and p95.

| Build | Load at start | Load at end |
| --- | --- | --- |
| Chromium 149.0.7827.55 (full browser, new headless) | 4.96–5.39 | 4.21–6.99 |
| Chromium 156.0.8078.4 (full browser, new headless) | 4.21–5.60 | 4.45–7.68 |
| Chromium 156.0.8078.4 (Playwright's default headless shell) | 4.34–5.66 | 4.96–12.16 |

The shell runs are the control: their results match the full 156 browser, so the
differences below come from the Chromium version, not the headless mode.

**There is no before.** Every browser here is past Chrome 144, and so is the
2026-08-22 run: its Playwright 1.62.1 installs Chromium 151. Its load was not
recorded. These numbers cannot show what the Chrome 144 change itself did, which
Chrome describes as ["up to 2X"](https://developer.chrome.com/blog/new-in-webgpu-144#faster_writebuffer_and_writetexture)
depending on data size. They show how much of a frame is left for it to affect.

**The default render path.** The real WebGPU renderer at 1280×720, step 0, demo
audio, 8 windows of 120 frames in each of 5 runs:

| Preset | Build | Writes per frame | Bytes per frame | Write time, ms per frame (p50 / p95) | Cadence, ms (p50 / p95) |
| --- | --- | --- | --- | --- | --- |
| `eos-apocalypse` | 149 | 45.9 | 282 KB | 0.039 / 0.048 | 8.46 / 10.50 |
| `eos-apocalypse` | 156 | 45.6 | 282 KB | 0.133 / 0.143 | 16.67 / 22.93 |
| `shifter-curlique` | 149 | 17.9 | 125 KB | 0.018 / 0.025 | 8.34 / 13.58 |
| `shifter-curlique` | 156 | 16.8 | 125 KB | 0.073 / 0.086 | 16.67 / 20.97 |

That is at most 0.8% of a 16.7 ms frame. Neither preset made a `writeTexture`
call while measured. A 2× change to this cost is under 0.07 ms a frame, which
cadence sampling cannot see. These are call-site costs: the GPU
process does the rest of the copy later. Cadence sits on the vsync floor, and
the 149 build ran its `requestAnimationFrame` at 120 Hz where 156 ran at 60 Hz,
so the cadence columns are not a comparison of frame work.

**The compute VM round trip.** `syncState` + dispatch + readback, 200 iterations
per run. Off by default.

| Program (compiled statements) | CPU JIT µs | GPU ms, 2026-08-22 | GPU ms, 149 (p50 / p95) | GPU ms, 156 (p50 / p95) | GPU ms, 156 shell (p50 / p95) | `syncState` µs, 149 → 156 (p50 / p95) |
| --- | --- | --- | --- | --- | --- | --- |
| `cotc-eos-phat-fractical-dancer-light-in-the-distance` (13) | 0.08 | 0.9 | 0.86 / 1.96 | 0.88 / 2.01 | 0.81 / 1.82 | 5 / 15 → 5 / 15 |
| `flexi-geiss-infused-with-the-spiral-heavy-oil-mix-nz-rapery` (49) | 0.23 | 1.1 | 0.84 / 1.48 | 0.84 / 1.44 | 0.78 / 1.29 | 5 / 10 → 5 / 10 |
| `flexi-amandio-c-organic-random-mashup` (111) | 0.75 | 0.9 | 0.83 / 1.19 | 0.80 / 1.22 | 0.75 / 1.09 | 0 / 10 → 0 / 5 |
| `flexi-alien-fish-pond` (21, guest memory) | 0.08 | 8.0 | **6.30 / 7.60** | **3.05 / 3.55** | 3.01 / 3.62 | **3035 / 3220 → 245 / 280** |
| `cotc-va-ultramix2-208-1` (10) | 0.05 | – | 0.77 / 1.10 | 0.73 / 1.01 | 0.72 / 0.95 | 0 / 5 → 0 / 10 |
| `cotc-flexi-bdrv-ultramix-05-alien-complex-mix-not-roaring-at-all` (27) | 0.12 | – | 0.76 / 0.94 | 0.77 / 1.00 | 0.71 / 1.11 | 0 / 5 → 0 / 5 |
| `cotc-the-ng-flexi-bdrv-ultramix-05-alien-complex-mix-underground` (27) | 0.14 | – | 0.82 / 1.71 | 0.76 / 1.13 | 0.71 / 0.89 | 5 / 10 → 0 / 5 |

Without guest memory the round trip is 0.7–0.9 ms on every build and `syncState`
is at the timer's resolution, so the wait for the GPU is the whole cost. Run-to-run
medians overlap (690–1000 µs). The guest-memory program is the one real move: it
halves from 149 to 156 (run medians 5930–6380 µs against 2960–3520 µs), and it
is still about 38,000× the CPU JIT. `gpuComputeVM` stays off.

**Bare queue writes.** In µs per write, with the call alone and the call plus
`onSubmittedWorkDone`:

| Write | 149 call (p50 / p95) | 149 done (p50 / p95) | 156 call (p50 / p95) | 156 done (p50 / p95) |
| --- | --- | --- | --- | --- |
| `writeBuffer` 256 B | 0.12 / 0.20 | 0.94 / 5.08 | 0.23 / 0.33 | 1.11 / 1.82 |
| `writeBuffer` 4 KiB | 0.21 / 0.74 | 1.91 / 311 | 1.50 / 2.15 | 2.87 / 43.4 |
| `writeBuffer` 64 KiB | 1.72 / 6.88 | 15.3 / 68.4 | 21.6 / 26.4 | 28.3 / 64.1 |
| `writeBuffer` 1 MiB | 25 / 35 | 220 / 1130 | 343 / 381 | 524 / 870 |
| `writeBuffer` 4 MiB | 1460 / 1600 | 3005 / 6155 | 115 / 175 | 835 / 4935 |
| `writeTexture` 4 KiB | 0.70 / 0.88 | 7.32 / 20.6 | 2.11 / 2.38 | 10.8 / 22.3 |
| `writeTexture` 4 MiB | 1445 / 1570 | 2825 / 6125 | 120 / 195 | 1390 / 30090 |

So the write path did change between these builds, and not in one direction. On
156, writes up to 1 MiB cost 2–14× more at the call and 1.2–2.4× more to complete,
while 4 MiB writes cost about 13× less at the call and 3.6× less to complete. The
live write time rises in the same direction (live writes average 6–7 KB), and two
4 MiB writes predict the `syncState` figures for the guest-memory program (2920 µs
and 230 µs).

**Verdict: the first item can be closed.** The move is real and reproducible on
the path that does not run by default. On the path that does, the whole cost is
at most 0.8% of a frame on either build, so no write-path change can be felt.

### Transient attachments

**No colour feedback target can be transient.** A transient texture's usage must
be
[exactly `TRANSIENT_ATTACHMENT | RENDER_ATTACHMENT`](https://github.com/gpuweb/gpuweb/blob/main/proposals/transient-attachments.md),
its pass must clear and discard, and its contents are gone when the pass ends.
Both 149 and 156 reject a transient texture that is also sampled, and a transient
colour attachment that stores. Every colour intermediate on the WebGPU path
(`feedback-manager-webgpu-tsl.ts`) is read by a later pass:

| Target | Read by |
| --- | --- |
| `sceneTarget` | The feedback blend and composite, as the fresh geometry |
| `targets[0]`, `targets[1]` | The next frame's warp (`previousTex`) and the composite (`internalTex`) |
| `displayTargets[0]`, `displayTargets[1]` | The present pass (`currentTex`) and the afterimage (`displayHistoryTex`) |
| `blurTarget` | The vertical blur pass and the `blur1`–`blur3` samplers |
| `savedFrameTargets` | The preset-switch dissolve |

**The candidate is the depth attachment of `displayTargets`.** Every feedback
target also carries a `depth24plus` texture, because `createFeedbackRenderTarget`
leaves `depthBuffer` at three's default. All of them clear and store it each pass:

| Preset | Render passes per frame | Depth textures alive | About (at 4 bytes a texel) |
| --- | --- | --- | --- |
| `eos-apocalypse` | 3 at 1280×720, plus present | 5 at 1280×720 | 18 MB |
| `shifter-curlique` | 2 at 2000×1125 and 1 at 1280×720, plus present | 4 at 2000×1125 and 1 at 1280×720 | 40 MB |

The display target is the one to try first: it runs every frame, draws one
fullscreen quad (`compositeScene`), and is never fed back, so a mistake would last
one frame instead of compounding in the loop.

**Try removing the depth first.** A pass that draws one fullscreen quad has no use
for depth, so `depthBuffer: false` on that target frees the memory on every GPU,
with no capability check and no new usage flag. A transient attachment only earns
its place on a pass that still needs depth after that. Which pass that is has not
been traced: `eos-apocalypse` builds 4 depth-writing pipelines and 8 that only test
depth, and geometry materials such as `renderer-segment-batching.ts` test without
writing.

**What adoption would take, for a pass that keeps depth:**

- **three.** r186 sets `TRANSIENT_ATTACHMENT` only for a multisampled target with
  `storeMultisampledDepthBuffer === false`. These targets are single-sampled, and
  three gives their depth a sampled usage and a store op. This needs an upstream
  change or an override. Chrome
  [149–150 also requires](https://developer.chrome.com/blog/new-in-webgpu-149-150#stricter_validation_for_transient_attachments)
  empty `viewFormats` and a view that keeps the texture's usage.
- **Capability check.** `GPUTextureUsage.TRANSIENT_ATTACHMENT !== undefined`, the
  test three and Chrome's sample both use, per device rather than per version.
  Keep it behind a new off-by-default key in `webgpu-optimization-flags.ts`, with
  an ordinary depth texture as the fallback.
- **Parity proof that frames do not change.** Run `bun run parity:noise -- --preset <id>
  --repeats 5 --write` for the noise band, then `bun run parity:capture` and
  `bun run parity:diff -- --preset <id>` on the certified presets with the flag off
  and on. Then `bun run lab:backend-diff -- --sample 24`, once plain and once with
  `--query <flag>=1`. Both must stay inside the noise band. A difference smaller
  than a preset's same-backend noise is invisible to `lab:backend-diff`, so measure
  that noise rather than assuming it.
- **Benefit measurement.** JavaScript cannot read GPU memory, so a before/after
  needs device tooling on a tile-based phone (the S22 loop) as well as frame times.

### `srgb-linear` and `display-p3-linear`

**What the corpus's colours are.** MilkDrop's values are display-referred:
`output-conversion-passthrough.ts` exists so that a preset's numbers reach the
screen without tone mapping or an encode, and the feedback loop's decay and
blending are defined on those same numbers. A preset's 1.0 means "the display's
full value", not a light level. Three outputs follow from that:

| Choice | What changes on a P3 display |
| --- | --- |
| Accurate: treat the numbers as sRGB and convert | Nothing. The browser already does this for today's sRGB canvas. |
| Reinterpret: treat the numbers as P3 | Saturated colours get more saturated, in every preset. Greys stay put. A preset's pure red becomes P3 red. This looks vivid, but it is a new look rather than accuracy. |
| Linear canvas: `srgb-linear` or `display-p3-linear` | Every preset brightens, because display-referred numbers are read as light. The earlier output encode took `geiss-game-of-life` from about 14 to about 49 mean luminance. Cancelling it in the present pass gets the same picture back for double the canvas memory (`rgba16float`). Moving the feedback loop itself into linear would change every preset's trails. |

So colour-accurate output buys nothing here, and the only visible option is an art
direction call. A linear canvas also needs extended-range values the corpus was
never authored for: values above 1 would stop clipping, unlike the reference
renderers. That range was not measured.

**The linear spaces are not on by default in the browsers tested.** Chrome lists
them [under 155–156](https://developer.chrome.com/blog/new-in-webgpu-155-156#srgb-linear-and),
but 156.0.8078.4 and 149.0.7827.55 both throw a `TypeError` on `configure()`, and
both accept them with `--enable-experimental-web-platform-features`. Re-run the
probe on stable before relying on them. three r186 also passes no `colorSpace` to
`context.configure()`, so using them means changing three or configuring around it.

**The existing flag does not do what it says on WebGPU.** `core/wide-gamut.ts`
(`localStorage` key `stims:wide-gamut`, no UI sets it) is meant to widen output.
Because three leaves the WebGPU canvas `srgb`, the present pass applies the
sRGB-to-P3 matrix to a canvas that is still sRGB, which narrows the picture. Known
colours through the comp shader, read back at the canvas centre on 156 with the
flag forced on and `(color-gamut: p3)` stubbed, since headless reports `false`:

| Comp shader `ret` | Flag off (both backends) | Flag on, WebGPU | Flag on, WebGL (`display-p3`) |
| --- | --- | --- | --- |
| 1, 0, 0 | 241, 0, 0 | **178, 0, 0** | 242, 0, 0 (clipped) |
| 0, 1, 0 | 0, 241, 0 | **56, 241, 29** | 0, 241, 0 (clipped) |
| 0, 0, 1 | 0, 0, 241 | **4, 0, 218** | 0, 0, 241 (clipped) |
| 1, 0, 1 | 255, 0, 255 | **192, 0, 226** | 255, 0, 255 (clipped) |
| 0.5, 0.5, 0.5 | 180, 180, 180 | 178, 180, 182 | 180, 180, 180 |
| 0.6, 0.2, 0.2 | 197, 114, 114 | 174, 109, 113 | 211, 109, 112 |

WebGL reinterprets, so a dull red gains saturation. The screenshot is sRGB, so
colours outside it clip there and how they look on a P3 panel has not been checked
by eye. WebGPU, the judged backend, loses saturation and shifts hue instead, so the
flag makes the two backends disagree.

**Before any wide-gamut work:** decide by eye on a P3 display whether the
reinterpreted look is wanted, since the parity captures are sRGB and cannot judge
it. Re-run `lab:flash-audit` too, because P3 red has a higher luminance coefficient
than sRGB red (0.2289 against 0.2126) and the flash limits are calibrated on sRGB.

## 2026-11-11 Frame-variable overlays snapshotted the VM every frame

Since #1685 the predictability dial wraps the frame's `variables` in a Proxy
on every frame, at its default setting of 0.5, for every visitor. The
breathing and motion overlays do the same when they are on. Each wrapper's
target was the VM's own variables proxy. After a Proxy's get trap returns, the
engine asks the target for that key's own descriptor to enforce the Proxy
invariants. On the VM proxy that runs its `getOwnPropertyDescriptor` trap,
which builds the whole frame snapshot (state, registers, every wave and shape
local) once a frame and then a descriptor object on every read. The feedback
pass reads `q1`–`q32` twice a frame, plus `zoom`, `rot`, `dx` and `dy`,
through the wrapper.

A CDP profile of the production build on `shifter-curlique` (WebGL, 6× CPU
throttle) put 21% of page CPU in `getStateSnapshot` and 22% in that trap. The
three overlays now share one view whose target is an empty object, and its
traps forward reads, `in` and enumeration to the bag beneath. Reads return the
same values and enumeration lists the same keys.
`tests/unit/milkdrop-motion-dampener.test.ts` fails if a read through the
overlays makes the VM snapshot its state.

Production builds of `d34630ca` with and without the change, headless Chromium
158 through ANGLE Metal on an Apple M1 Max, 1280×720, demo audio, balanced
quality step (2) locked, default comfort settings. Each trial used a fresh
browser context, waited 2.5 s, then read the runtime tracker's mean over its
last 120 frames. Rounds rotated condition order. Medians in milliseconds:

| Backend, CPU throttle | Presets × trials | Render before → after | Frame work before → after | Delivered fps before → after |
| --- | --- | --- | --- | --- |
| WebGL, 6× | 11 × 3 | 21.9–24.3 → 2.3–3.8 (−84 to −90%) | 29.0–49.5 → 8.5–29.5 (−40 to −70%) | 17–27 → 27–58 |
| WebGPU, 6× | 3 × 4 | 21.8–23.9 → 4.1–5.5 (−76 to −83%) | 24.9–37.9 → 7.0–20.3 (−47 to −74%) | 21–30 → 34–60 |
| WebGL, 1× | 3 × 4 | 3.0–3.1 → 0.3–0.4 (−88 to −90%) | 4.1–6.1 → 1.4–3.2 (−48 to −67%) | 60 → 60 |

The WebGL 6× sample is `shifter-glassworms-flare`,
`eos-glowsticks-v2-03-music`, `shifter-curlique`,
`martin-the-bridge-of-khazad-dum`, `krash-rovastar-cerebral-demons-stars`,
`martin-journey-into-space`, `eos-apocalypse`, `shifter-digi`,
`schglasmia-danqueer`, `flexi-age-of-shading-chaos` and
`eos-phat-magnetosphere-13-pulsar`. A twelfth, `rediculator-qrem-glob`, logs a
console error on every build, which fails its trials. The other two rows use
`shifter-curlique`, `eos-glowsticks-v2-03-music` and `eos-apocalypse`. The
cost barely varied by preset: about 2.7 ms of render time a frame unthrottled,
and 17–21 ms at 6× on either backend. It weighed most on light presets. The
frame work of `shifter-curlique`, the first-run preset, fell by two thirds or
more in all three rows.

What this does not establish: any device other than this one. Unthrottled, all
three presets were display capped at 60 fps before and after, so the 1× row
shows headroom rather than a frame-rate change.

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

To repeat the upload measurement on a chosen browser build, with the load average
and adapter recorded in the output:

```bash
bun run lab:vm-tier-bench -- \
  --executable <path-to-browser> \
  --live eos-apocalypse,shifter-curlique \
  --json ./output/vm-tier-bench.json
```

## Regression coverage

- `tests/unit/milkdrop-program-jit.test.ts` asserts that aliased environment
  and local scopes receive one ordinary property write, while the bundled
  program differential tests retain interpreter/JIT equivalence.
- `packages/milkdrop-toolchain/tests/milkdrop-program-jit.test.ts` runs each
  local-promotion rule against the interpreter tier, and fails if the rule is
  removed or promoted variables go back to the env.
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
- `bun run check:bundle-size` asserts bundle budgets against `dist/` after a
  build; run it whenever imports or vendor chunking change.
- `tests/unit/app-shell-performance-regression.test.ts` pins the service
  worker's non-blocking cache-write contract and the lazy runtime imports.
- `tests/unit/site-build.test.ts` pins the deploy packager and its concurrent
  app/Worker build.
- `tests/unit/loading-screen.test.ts` pins the static loader outside the React
  root and its transition-driven handoff into the app shell.
- `tests/unit/milkdrop-motion-dampener.test.ts` reads through all three
  comfort overlays on a real VM and fails if that snapshots the VM's state.

Run `bun run verify --changed` during iteration and `bun run check` before
committing runtime changes. Source inspection or a successful browser load
does not support an FPS claim; use the fixed-tier contract above.
