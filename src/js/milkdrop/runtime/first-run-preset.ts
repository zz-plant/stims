/**
 * The preset a visitor sees when nothing better is known: first run, no
 * history, no favorites, no `?preset=` deep link, or a requested preset that
 * this backend cannot render.
 *
 * A deliberate pick, and — since 2026-08-22 — a measured one. The choice has
 * now been wrong twice for the same reason, so the criterion is written down
 * here and enforced by a test rather than re-argued each time.
 *
 * The landing page makes exactly one claim: "full-screen visuals that move to
 * whatever you're listening to". The first-run preset is the only proof of it
 * most visitors ever see, so it has to be lit enough to look at and it has to
 * visibly change when the music does.
 *
 * What the two previous defaults got wrong:
 *
 * - `eos-glowsticks-v2-03-music` was chosen by curated sort order and was
 *   98.6% below near-black — nothing to look at.
 * - `krash-rovastar-cerebral-demons-stars` replaced it on a *parameter count*
 *   (8 of 36 variables read audio, against glowsticks' 3). That count did not
 *   predict anything visible: the reactive variables were q1/q2/q8, wave
 *   deviation and dx/dy-with-no-baseline, while zoom, rot, warp, sx, sy, cx,
 *   cy and decay — every variable that moves the whole frame — measured
 *   0.000. At the pixel level demo audio moved it no more than silence did.
 *
 * Measured on 2026-08-22 with `bun run lab:visual` (silence vs demo audio):
 *
 * | preset (webgpu)                      | mean luma | visible | ΔL demo−silence | motion ratio |
 * | ------------------------------------ | --------- | ------- | --------------- | ------------ |
 * | krash-rovastar-cerebral-demons-stars | 65.0      | 89%     | −1.9            | 0.93         |
 * | shifter-glassworms-flare             | 45.6      | 84%     | −24.5           | 0.84         |
 *
 * A ΔL of −1.9 is the incumbent's whole answer to "does it react": audio
 * changed the image by under 1% of the luminance range. Glassworms answers
 * with −24.5 on the same instrument, and the gap is an order of magnitude
 * wider than the run-to-run variance (repeat runs put it at −17 to −25).
 *
 * Known limit, recorded rather than hidden: the same preset measures
 * ΔL −4.2 on WebGL, where it is also much brighter (mean luma 94). The two
 * backends do not render this preset the same, which is a fidelity bug in its
 * own right — but WebGPU is the production default, and on WebGL glassworms
 * still responds twice as strongly as the preset it replaces (−4.2 vs −0.2).
 *
 * The measurements are checked in at `src/data/first-run-preset-evidence.json`
 * and `tests/unit/bundled-first-run-preset.test.ts` fails when the shipped id
 * stops matching them. Changing this id means re-measuring:
 *
 *   bun run lab:visual -- --preset <id> --renderer webgl
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgpu
 *   bun run generate:first-run-evidence
 *   bun run lab:reactivity -- --preset <id>
 *   bun run generate:first-run-evidence
 *
 * This preset's source is also compiled into the bundle
 * (`runtime/default-preset.ts`) so the frames rendered before the catalog
 * arrives are already this preset rather than a placeholder. Changing the id
 * here means regenerating that file — the guard test names the command.
 */
export const FIRST_RUN_PRESET_ID = 'shifter-glassworms-flare';

/** Catalog metadata for {@link FIRST_RUN_PRESET_ID}, needed before the catalog loads. */
export const FIRST_RUN_PRESET_TITLE = 'Shifter - Glassworms - Flare';
export const FIRST_RUN_PRESET_AUTHOR = 'Shifter';

/**
 * Crossfade length used when nothing is stored in preferences yet.
 *
 * This used to be read off whichever preset happened to be compiled at boot,
 * which meant the bundled placeholder's `blend_duration` silently became the
 * product default for every transition a first-time visitor saw. It is a
 * product decision, so it is stated here.
 */
export const DEFAULT_BLEND_DURATION_SECONDS = 2.5;
