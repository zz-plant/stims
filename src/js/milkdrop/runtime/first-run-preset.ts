/**
 * The preset a visitor sees when nothing better is known: first run, no
 * history, no favorites, no `?preset=` deep link, or a requested preset that
 * this backend cannot render.
 *
 * This is a deliberate pick, not "whatever sorts first". The selection used to
 * fall through to the head of the curated sort order, which was
 * `eos-glowsticks-v2-03-music` — a preset that measures badly on the two things
 * a first impression actually depends on:
 *
 * | preset                                | reactive params | preview mean luma |
 * | ------------------------------------- | --------------- | ----------------- |
 * | eos-glowsticks-v2-03-music (previous) | 3 of 36         | 1.1 / 255         |
 * | krash-rovastar-cerebral-demons-stars  | 8 of 36         | 67.1 / 255        |
 *
 * On the previous default every motion parameter — zoom, warp, rot, dx, dy, sx,
 * sy — measured 0.000 correlation with audio, so the one claim the landing page
 * makes ("visuals that move to whatever you're listening to") was not
 * demonstrated by the first thing anyone saw, and 98.6% of the frame was below
 * near-black.
 *
 * This preset's source is also compiled into the bundle
 * (`runtime/default-preset.ts`) so the frames rendered before the catalog
 * arrives are already this preset rather than a placeholder. Changing the id
 * here means regenerating that file — the guard test names the command.
 *
 * Re-measure before changing this:
 *   bun run lab:reactivity -- --preset <id>
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
