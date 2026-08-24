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

## Open bottlenecks (verified against current code)

### 1. Low-quality path clones the frame state every frame

`runtime/lifecycle.ts` (`buildRenderFrameState`) and
`runtime/enhanced-effects-policy.ts` early-return the frame state unchanged
on the fast path, but when `shaderQuality === 'low'`, `low-motion`, or
mobile-low-power is active they clone the full `MilkdropFrameState` plus
nested `post` / `postprocessingProfile` / `gpuGeometry` / `particleField`
objects — 120–180 large objects per second, imposed exactly on the devices
that can least afford GC.

Why it is not a one-line fix: the derived state is consumed by
`adapter.render()` in the same frame, but the adapters' retention semantics
are not locally provable, and the tile pool runs up to 10 engines through
the same code path — a shared scratch object would alias state across
engines if any consumer holds the reference. The fix needs either a
per-experience scratch object with an audited no-retention contract on the
adapter seam, or mutable render flags the adapter reads instead of a derived
state object.

### 2. Full-catalog `JSON.parse` on the main thread

`use-catalog-loading.ts` parses the 1.7 MB catalog and maps every entry on
the main thread. The work is idle-scheduled, which is right, but
`JSON.parse` of that payload is a single non-yieldable ~80–150 ms block on
mobile. Comlink is already a dependency: parse in a worker and transfer, or
ship the catalog as NDJSON and stream it. (Delivery-side caching is fixed —
catalog JSON now has stale-while-revalidate headers and the service worker
serves preset payloads cache-first.)

### 3. Continuous dynamic resolution scaling is written but not wired

`core/services/continuous-drs.ts` implements a PID-style analog render-scale
controller, unit-tested, referenced only by its test. The shipping path uses
the discrete `adaptive-quality-controller.ts` steps — exactly the
step-hunting the DRS controller's header says it exists to eliminate.
Wiring it in behind the existing controller's sampling seam should produce
visibly smoother degradation than the current stepped drops.

### 4. Stage `--energy` CSS pulse is event-driven, not frame-driven

`StageControls.tsx` updates the `--energy` custom property from
`subscribeAudioEnergy`, which is fed from engine *snapshot* changes — and
snapshots emit on discrete events (preset change, audio start/stop), not per
frame. The "energy" visual therefore does not track the music. The fix is a
dedicated per-frame publisher across the engine seam (a rAF reader of the
live analyser writing `style.setProperty` directly, no React), which needs a
small API addition on the engine adapter.

### 5. Spectrum processed in multiple passes per frame

On the AnalyserNode fallback path, each frame runs: `getByteFrequencyData`
copy, a stylize pass, a `getAverageFrequency` pass used only for a silence
threshold, and an optional blend pass (`animation-loop.ts`,
`audio-handler.ts`). Fusing the copy+stylize passes and returning the mean
from the stylize pass would drop 2 of the 4–5 full-array walks nearly for
free.

### 6. Blend-state cloning during preset transitions

`cloneBlendState()` deep-copies wave positions, custom waves, shapes,
borders, and motion vectors when a blend transition begins. Not per-frame,
but it can spike a frame during preset switches on dense presets.

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
