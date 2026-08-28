# Front-end performance bottlenecks

> Rewritten 2026-08. The previous version of this note was materially stale:
> its top findings (full per-frame `variables` snapshot, duplicate drag-magnitude
> math, imperative overlay browse-list re-rendering, `syncCatalog()` cascades)
> were fixed as the overlay moved to React (`useDeferredValue`, capped lists)
> and the VM gained a lazy variables proxy. This version reflects the current
> code so an audit does not re-file solved issues.

## Fixed since the original audit (do not re-file)

- **Autoplay advance stampede** (fixed 2026-08-18) — the frame loop fired
  `selectRandomPreset` on every frame of the fetch+compile window (6–20
  superseded fetch+compiles per advance); an in-flight latch in
  `experience-frame-loop.ts` allows one advance at a time.
- **Per-frame `variables` snapshot** — `vm.ts` now exposes a lazy proxy and
  nulls the frame snapshot; the full copy only materializes when a debug
  consumer asks for it.
- **Duplicate drag-magnitude computation** — `interaction-response.ts`
  computes `inputSpeed` once.
- **Stage `--energy` pulse was event-driven** (fixed 2026-08-26) — the CSS
  custom property only updated on discrete snapshot emits, so the visual did
  not track the music. `getAudioLevels()` on the experience controller +
  engine session now exposes the live signal tracker, and a rAF loop in
  `useWorkspaceSessionState` feeds the audio-energy store per frame while
  audio is active (verified: 30/30 distinct values over 30 frames).
- **Spectrum processed in 5 full-array passes per frame** (fixed 2026-08-26)
  — `getFrequencyFrame()` fuses the copy/peak/sum walks into one loop, the
  stylize transform accumulates its own output mean, and `animation-loop.ts`
  consumes that mean instead of re-walking the array: 5 walks → 2. The
  now-unused `getAverageFrequency`/`getWeightedAverageFrequency` exports
  were deleted.
- **Overlay browse-list full DOM re-render** — the browse UI is React with
  deferred search values and a capped result list.
- **Renderer-service Proxy churn** — bound renderer methods are now cached
  per underlying renderer instance (`render-service.ts`), instead of minting
  a fresh closure on every property access in the frame path.
- **Meyda / stats-gl in the startup payload** — both are dynamic imports now;
  Meyda only loads on the AnalyserNode fallback path, stats-gl only when the
  overlay is enabled.
- **Telemetry and automation in the startup payload** (fixed 2026-08-24) —
  crash/renderer telemetry, the agent API/driver, and gamepad navigation start
  after the first paint. Device-tier, refresh-rate, and battery probes remain
  early because they affect the first renderer choice.
- **Abrupt static-loader replacement** (fixed 2026-08-24) — the loader now
  sits outside the React root, shares the launch screen's starting geometry,
  and crossfades after `shell-rendered`. Reduced-motion users get an immediate
  removal, and a timeout still cleans up when a browser drops transition events.
- **Full-catalog parsing on the main thread** — the catalog fetch/parse/merge
  pipeline runs in `catalog-parse-worker.ts`; unsupported browsers retain the
  identical main-thread fallback.
- **Per-frame Meyda FFT on the fallback path** — spectral features refresh
  every fourth frame once a snapshot exists (`audio-handler.ts`).
- **Repeated `Object.setPrototypeOf` in `createEnv`** — the reuse path only
  rewrites the prototype when it actually changed, so persistent shape/wave
  locals no longer trigger V8 deopts every frame.
- **Duplicate EEL2 JIT stores for aliased scopes** — per-point and per-pixel
  programs can use one object as both environment and locals. Ordinary results
  are now written once instead of mirrored back onto the same object; seeded
  interpreter/JIT differential coverage pins semantics.
- **Live tile pool vs. the stage** — the pool's engine cap now follows the
  adaptive-quality controller via `engine-quality-store.ts`; when the stage
  degrades, browse-grid previews shed engines instead of competing.
- **Low-tier frame-state cloning** (fixed 2026-08-24) — lifecycle and enhanced
  effects policies now reuse one scratch shell per experience. Adapter calls
  consume it synchronously, while debug snapshots explicitly detach any data
  they retain.
- **Unwired continuous resolution controller** (fixed 2026-08-24) — resolved
  WebGPU hardware timestamps now drive a continuous resolution multiplier
  inside each discrete quality step. GPU fill pressure can shed pixels without
  immediately reducing mesh density; quality locks freeze both lanes.
- **Exact-size dynamic GPU buffers** (fixed 2026-08-24) — resizable vertex
  attributes now grow with power-of-two item capacity, which removes validation
  failures at awkward geometry counts and absorbs nearby size changes.
- **Read-only EEL field locals** (fixed 2026-08-24) — variables that are read
  but never assigned lower as zero-initialized GPU temporaries, matching
  NS-EEL/CPU semantics and moving procedural field coverage to 1,611 of 1,619
  bundled per-pixel programs.

## Open bottlenecks (verified against current code)

### 1. Blend-state cloning during preset transitions

`cloneBlendState()` deep-copies wave positions, custom waves, shapes,
borders, and motion vectors when a blend transition begins. Not per-frame,
but it can spike a frame during preset switches on dense presets.

## Deliberate boundaries and remaining approximations

- **Random per-pixel equations stay off the procedural field path.** Six of
  the eight remaining bundled lowering misses call `randint`. The field
  renderer has a stateless hash approximation for `rand`, not MilkDrop's
  sequential per-vertex RNG state. Adding an allowlist entry would be faster
  but would widen the visual approximation, so these presets remain on the
  compatible path until RNG state or a parity-validated equivalent exists.
  This is a semantic boundary rather than an unfinished optimisation: the VM's
  RNG is a linear congruential generator advanced once per call in program
  order (`vm.ts` `nextRandom`), so its sequence is defined by evaluation order,
  which per-pixel GPU execution does not have. Lowering it would change what
  these presets draw, not merely where they draw it — and it is not a small
  cost: the heaviest preset in the certification corpus,
  `shifter-glassworms-flare`, calls `randint` 59 times and profiles at ~59%
  EEL VM (`bun run profile:frame -- --preset shifter-glassworms-flare`).
- **Shared guest memory stays on the VM path.** One miss reads `gmegabuf` from
  per-pixel code. Moving it requires a coherent storage binding and ordering
  contract; substituting zero or a stale CPU snapshot would only disguise the
  dependency.
- **Expression-side assignments stay on the CPU path.** One miss uses nested
  `exec2` assignments. The current field descriptor is a pure expression tree,
  so lowering it would lose evaluation order and side effects.
- **Shipping less three.js to WebGPU sessions is blocked upstream, not by us.**
  `three.core.js` holds the classes both renderers share; only
  `three.module.js` adds `WebGLRenderer`, and splitting them in `manualChunks`
  isolates 82 KB gzipped that a WebGPU session never executes. It does not
  help: 43 of our modules import from `'three'`, which *is* `three.module.js`,
  so it stays eagerly reachable and rolldown correctly merges it back into the
  core chunk (verified — the split chunk hash returns byte-identical). Making
  `webgl-renderer.ts` a dynamic import, mirroring the WebGPU path, changes the
  eager payload by nothing (503 KB / 43 files either way) and was reverted.
  Avoiding it needs either per-backend builds or a public core-only entry from
  three; `three/src/*` is exported but mixing it with the prebuilt
  `three.core.js` that `three.webgpu.js` imports would duplicate the core
  instead of sharing it. Measured 2026-08-27.
- **The many small chunks are the price of four HTML entries.** 61 of 102
  chunks are under 5 KB (105 KB total), which looks like pure request
  overhead. Grouping app code by directory in `manualChunks` cuts the count to
  60 — and takes the *eager* payload from 503 KB to 2237 KB, because the
  groups drag lazily-imported renderer code into the entry graph. A narrower
  utils-only grouping still traded 3 fewer requests for 39 KB of extra
  critical-path bytes. The fine-grained split is load-bearing: chunks differ by
  which of the four HTML entries reach them. Measured 2026-08-27; do not
  re-attempt without a per-entry reachability model.
- **Per-frame GPU compute is not an automatic upgrade.** The compute VM remains
  opt-in because dispatch and readback dominate the small scalar workloads in
  the measured harness. The useful GPU lane is the parallel field/geometry
  work that does not round-trip state to the CPU every frame.

## Regression guards

The fixed-tier browser method and latest measured result live in
[`RUNTIME_PERFORMANCE.md`](./RUNTIME_PERFORMANCE.md). Use its quality lock,
warmup, duration, backend, and CPU-throttle contract before claiming an FPS
uplift; source inspection or a successful browser load is insufficient.

- `bun run check:bundle-size` (scripts/check-bundle-size.ts) asserts bundle
  budgets against `dist/` after a build — run it whenever imports or vendor
  chunking change.
- `tests/unit/app-shell-performance-regression.test.ts` pins the service
  worker's non-blocking cache-write contract and the lazy runtime imports.
- `tests/unit/site-build.test.ts` pins the dedicated deploy packager and its
  concurrent app/Worker build contract.
- `tests/unit/loading-screen.test.ts` pins the static loader outside the React
  root and verifies its transition-driven handoff into the app shell.

## Latest startup and deploy-build evidence

Measured 2026-08-24 on the same checkout and machine:

- Cold Chromium production load, three fresh contexts, service workers
  blocked, 4× CPU throttle, 150 ms latency, and 200,000 bytes/s downstream:
  median `shell-rendered` improved from 2,288.4 ms to 2,120.7 ms, while
  requests completed before the shell fell from 57 to 51.
- Local `bun run site:build`, timed end to end: 3.97 s before concurrent build
  orchestration and 2.74 s after it. The output still contains
  `dist/_worker.js/index.js`, `.assetsignore`, and the complete public preset
  libraries.

These are focused before/after measurements, not universal production-SLA
claims. Re-run them when the entry graph, Worker compiler, or build host
changes.
