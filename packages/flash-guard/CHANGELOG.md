# Changelog

## Unreleased

- The governor counts red flashes. `sample()` takes `red`, the same samples'
  red-flash values and saturated-red flags (`FlashRedField`), pairs and
  windows red transitions on their own channel with the offline analysis's
  definitions, and engages the clamp on either channel. Decisions carry
  `redFlashesInWindow` and `redFlashed`. Before this, a saturated-red strobe
  under the luminance threshold, such as `(80,0,0)` to `(100,0,0)`, was never
  mitigated.
- The sampler reads the red-flash field from the same pixels and hands it to
  `onGrid` as a second argument; `createFlashController` passes it on.
  `createMainThreadFlashReader` exposes it as `red`.

## 0.1.1

Documentation only; no code changes.

- docs: README reflects the published package. It leads with the install command, moves the clone-and-build steps under Development, links the live demo site, and uses absolute links that resolve on npm and on the mirror, including the `demo/` page the npm package does not contain.

## 0.1.0

First release as a package, extracted from
[zz-plant/stims](https://github.com/zz-plant/stims).

- Thresholds, offline analysis (`analyzeFlashEvents`, `analyzeFlashTimeline`),
  the live governor, the off-thread sampler and the risk classifier, carried
  over with their tests.
- New: `analyzeRgbaFrames` and `createFlashFrameCounter`, the per-pixel
  frontend that used to be inlined in Stims' audit script.
- New: `createFlashController` is the Stims controller with its preference
  gate and stage filter replaced by `isEnabled` and `applyLuminanceScale`
  callbacks, plus `createBrightnessFilterApplier`.
- `analyzeFlashTimeline` and `analyzeFlashEvents` now share one pairing and
  windowing implementation. When both directions qualify on one transition
  the larger area wins on both paths (the timeline path used to prefer
  rising).
- `primingHoldForProfile` is renamed `primingHoldForMeasurement`.
- `createFlashSampler` takes `{ grid, createWorker }` (a bare grid number is
  still accepted).
- The governor judges each pixel sample before counting area, on a field of
  8x8 samples per tile (`RECOMMENDED_SAMPLE_DENSITY`); one value per tile read
  fine moving texture as flashing. `sample()` takes `{ density, viewScale }`.
- `viewScale`: frames are judged at the scale in force, so the governor's own
  dimming step no longer counts as the content darkening. Pass the frame as
  drawn instead of multiplying the scale into it.
- The clamp is solved from the whole field rather than its largest swing.
- The sampler reads a 128x128 nearest-neighbour field, queues up to
  `MAX_CAPTURES_IN_FLIGHT` readbacks in capture order, and takes `density`.
- `MIN_SAMPLE_INTERVAL_MS` is three quarters of a 60 Hz frame, so timestamp
  jitter no longer skips frames.
