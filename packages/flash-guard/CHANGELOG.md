# Changelog

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
