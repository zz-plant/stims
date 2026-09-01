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
 * Measured on 2026-08-22 with `bun run lab:visual` (silence vs demo audio),
 * and re-measured on 2026-08-31 with a steady-state window after the WebGPU
 * feedback-carry change (ea02d0b0) invalidated the first round:
 *
 * The 08-22 numbers sampled t≈1.5–7s. Feedback accumulation only shows after
 * ~20–30s, so the certified pick (`shifter-glassworms-flare`, ΔL −24.5) was
 * measured in its pretty opening seconds and washes out to near-white fog
 * (mean luma 206–220 on WebGPU, 140 on WebGL) in the steady state every
 * visitor actually watches. Re-measuring the curated shortlist with
 * `--settle-ms 30000` on the production backend found most of it broken the
 * same way — saturated white, near-black, or collapsing when demo audio
 * starts — and exactly one preset that is lit, colorful, structured and
 * visibly audio-reactive in the state it settles into:
 *
 * | preset (webgpu, 30s settle)          | silence→demo luma | ΔL    | colorfulness |
 * | ------------------------------------ | ----------------- | ----- | ------------ |
 * | krash-rovastar-cerebral-demons-stars | 88 → 114          | +26.0 | 0.49 → 0.57  |
 * | shifter-glassworms-flare (replaced)  | 220 → 206         | −13.6 | 0.07 → 0.10  |
 *
 * So the default returns to `krash-rovastar-cerebral-demons-stars` — demoted
 * on 08-22 when it measured ΔL −1.9 under the OLD WebGPU feedback semantics
 * (history discarded every frame), and transformed by the feedback carry into
 * the strongest steady-state measurement in the shortlist. The lesson written
 * into the criterion: measure the state the preset settles into, not its
 * opening seconds, and re-measure after renderer-semantics changes.
 *
 * The measurements are checked in at `src/data/first-run-preset-evidence.json`
 * and `tests/unit/bundled-first-run-preset.test.ts` fails when the shipped id
 * stops matching them. Changing this id means re-measuring:
 *
 *   bun run lab:visual -- --preset <id> --renderer webgl --settle-ms 30000
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgpu --settle-ms 30000
 *   bun run generate:first-run-evidence
 *   bun run lab:reactivity -- --preset <id>
 *   bun run generate:first-run-evidence
 *
 * This preset's source is also compiled into the bundle
 * (`runtime/default-preset.ts`) so the frames rendered before the catalog
 * arrives are already this preset rather than a placeholder. Changing the id
 * here means regenerating that file — the guard test names the command.
 */
export const FIRST_RUN_PRESET_ID = 'krash-rovastar-cerebral-demons-stars';

/** Catalog metadata for {@link FIRST_RUN_PRESET_ID}, needed before the catalog loads. */
export const FIRST_RUN_PRESET_TITLE =
  'Krash & Rovastar - Cerebral Demons (Stars Remix)';
export const FIRST_RUN_PRESET_AUTHOR = 'Krash & Rovastar';

/**
 * Crossfade length used when nothing is stored in preferences yet.
 *
 * This used to be read off whichever preset happened to be compiled at boot,
 * which meant the bundled placeholder's `blend_duration` silently became the
 * product default for every transition a first-time visitor saw. It is a
 * product decision, so it is stated here.
 */
export const DEFAULT_BLEND_DURATION_SECONDS = 2.5;
