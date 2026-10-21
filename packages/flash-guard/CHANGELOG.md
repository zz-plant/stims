# Changelog

## Unreleased

- The governor models the brightness filter it applies. `luminanceScale` is
  a CSS `brightness()` factor, which browsers apply to sRGB-encoded values,
  so the luminance a viewer sees falls roughly as its 2.2-2.4th power, not in
  proportion. The governor took it as a luminance multiplier: it
  overestimated the swing left on screen, counted flashes the viewer could
  not see, and held a 0.02-to-0.95 strobe at brightness 0.069, where 0.328
  meets the solve's target. Each luminance sample is now taken through
  `luminanceThroughBrightness` when judged, solved and released, so expect
  higher `luminanceScale` values for the same content. The red channel was
  already exact: the filter scales the red-flash value by its factor.
- The solved step composes with the filter the flash was seen through, not
  with the engage hold applied in the same step. Composing with that landed
  every first engagement at 0.8 of the solved scale.
- The solved step also holds the strongest field-wide transition the content
  made in the last `windowMs`, not only the one that completed the flash.
  Every field-wide transition now records its ceiling, not only those made
  while a failing strobe is held. Solved for a weak second flash alone, the
  clamp let the stronger transitions around it through.
- `primingHoldForMeasurement` derives the hold from the same filter model.
- New exports: `luminanceThroughBrightness`, `encodeSrgb`, `decodeSrgb`.
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
- `FlashAnalysis.maxFlashLuminanceDelta`: the luminance swing of the
  strongest general flash, the largest change that samples covering 25% of a
  visual field made together over the transitions that paired into flashes.
  `analyzeRgbaFrames` and `analyzeFlashTimeline` report it;
  `analyzeFlashEvents` reports it when `FlashCountInput` carries the new
  `risingSwing` and `fallingSwing`. `flashSwing` computes one transition's.
- `primingHoldForMeasurement` documents `maxLuminanceDelta` as that figure.
  It was documented as `luminanceVolatility`, a standard deviation of
  frame-mean changes that is not the size of any flash.
- The governor no longer releases into a strobe that is still running. It
  pairs the content's transitions as drawn, undimmed, alongside the ones the
  viewer sees; while those exceed the limit, release stops at the largest
  scale that holds every field-wide transition of the last
  `windowMs + releaseDelayMs` under `safetyMargin` of the threshold, and
  tightens to it if the content grows stronger. Release runs to zero once
  the content has stayed at or under the limit for `releaseDelayMs`. Before
  this, release eased back to the threshold every few seconds: on a 15 s
  `(80,0,0)` to `(100,0,0)` strobe the frames shown read 6 red flashes in
  one second, and a luminance strobe just over the limit read 4. Content at
  or under the limit undimmed is released as before.

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
