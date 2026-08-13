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
 * Re-measure before changing this:
 *   bun run lab:reactivity -- --preset <id>
 */
export const FIRST_RUN_PRESET_ID = 'krash-rovastar-cerebral-demons-stars';
