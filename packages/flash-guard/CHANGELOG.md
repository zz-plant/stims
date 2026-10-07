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
