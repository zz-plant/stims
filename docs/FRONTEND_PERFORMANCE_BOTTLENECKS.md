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
- **Overlay browse-list full DOM re-render** — the browse UI is React with
  deferred search values and a capped result list.
- **Renderer-service Proxy churn** — bound renderer methods are now cached
  per underlying renderer instance (`render-service.ts`), instead of minting
  a fresh closure on every property access in the frame path.
- **Meyda / stats-gl in the startup payload** — both are dynamic imports now;
  Meyda only loads on the AnalyserNode fallback path, stats-gl only when the
  overlay is enabled.
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

### 1. Full-catalog `JSON.parse` on the main thread

`use-catalog-loading.ts` parses the 1.7 MB catalog and maps every entry on
the main thread. The work is idle-scheduled, which is right, but
`JSON.parse` of that payload is a single non-yieldable ~80–150 ms block on
mobile. Comlink is already a dependency: parse in a worker and transfer, or
ship the catalog as NDJSON and stream it. (Delivery-side caching is fixed —
catalog JSON now has stale-while-revalidate headers and the service worker
serves preset payloads cache-first.)

### 2. Stage `--energy` CSS pulse is event-driven, not frame-driven

`StageControls.tsx` updates the `--energy` custom property from
`subscribeAudioEnergy`, which is fed from engine *snapshot* changes — and
snapshots emit on discrete events (preset change, audio start/stop), not per
frame. The "energy" visual therefore does not track the music. The fix is a
dedicated per-frame publisher across the engine seam (a rAF reader of the
live analyser writing `style.setProperty` directly, no React), which needs a
small API addition on the engine adapter.

### 3. Spectrum processed in multiple passes per frame

On the AnalyserNode fallback path, each frame runs: `getByteFrequencyData`
copy, a stylize pass, a `getAverageFrequency` pass used only for a silence
threshold, and an optional blend pass (`animation-loop.ts`,
`audio-handler.ts`). Fusing the copy+stylize passes and returning the mean
from the stylize pass would drop 2 of the 4–5 full-array walks nearly for
free.

### 4. Blend-state cloning during preset transitions

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
- **Shared guest memory stays on the VM path.** One miss reads `gmegabuf` from
  per-pixel code. Moving it requires a coherent storage binding and ordering
  contract; substituting zero or a stale CPU snapshot would only disguise the
  dependency.
- **Expression-side assignments stay on the CPU path.** One miss uses nested
  `exec2` assignments. The current field descriptor is a pure expression tree,
  so lowering it would lose evaluation order and side effects.
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
