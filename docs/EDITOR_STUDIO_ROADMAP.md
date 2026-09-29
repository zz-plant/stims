# Editor studio roadmap

Goal: make Stims the editor MilkDrop authors reach for first. Each phase ships
as its own PR.

## Decisions

- **Gallery stays account-free.** Publishing and remixing carry credit through
  `preset-credit.ts` / `preset-lineage.ts`; no ratings, comments or profiles
  until there is a moderation story.
- **`.milk2` and q33–q64 are out of scope for now** and stay documented as
  unsupported in `docs/authoring/08-shipping.md`. Revisit after Phase 3.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Make equations visible: Inspect tab (live variables, pins, sparklines) | **Shipped.** Inspect tab; parameter knobs (`preset-knobs.ts`); reactivity meter (each variable tagged with the audio band it follows, and a one-line "follows the audio" summary — `variable-history.ts`); Freeze and Step to hold the stage and advance one frame at a time (`milkdrop-reactivity-meter.test.ts`, `toy-runtime-preview-loop.test.ts`) |
| 2 | Structured editing: per-section outline, shape/wave solo, shader translation view | **Shipped.** Outline tab, shader translation view (`shader-translation.ts`), and Solo/Mute per custom wave and shape on the Outline (`render-isolation.ts`: hides the element as `enabled=0` would, without touching the source; `milkdrop-render-isolation.test.ts`) |
| 3 | Formats: Format round-trip guarantee, packs, unknown-key preservation, MilkDrop 2 export | **Shipped.** Format is lossless (`lab:format-roundtrip` fingerprints shader text as written, equation comments and fields Stims ignores; `milkdrop-lossless-format.test.ts`). Export writes the file MilkDrop 2 saves — `[preset00]`, its key names, backtick shader lines — and every corpus preset comes back unchanged (`milkdrop2-export.test.ts`). Packs import from `.zip` (`preset-archive.test.ts`) |
| 4 | Named versions, arbitrary diff, fork tree | **Named versions shipped**, with compare against the buffer or another saved version; fork tree next |
| 5 | Live compatibility checklist | **Shipped.** Compat tab (`compat-checklist.ts`): what will not run as written on Stims. "Beyond Stims" (`portability.ts`): what will not carry over to MilkDrop 2 — Stims-only functions with a rewrite, Stims-only signals, Stims settings, textures to ship, GLSL in shaders. projectM and Butterchurn are assumed to follow MilkDrop 2 and are not checked separately. 1,484 of the 1,750 bundled presets translated from Butterchurn are flagged (GLSL shaders, `mod()`, `randint()`); 6 of the 936 MilkDrop 2/projectM presets are, mostly for texture files. Next: have Export rewrite the fixable ones |
| 6 | Publish-from-editor, gallery browse + remix, short share links, archive rescue | planned; confirm the client is wired to `/api/presets` first |
| 7 | Searchable in-app function reference and technique cookbook | **Shipped.** Reference tab (`reference-search.ts`); the Insert tab is now a cookbook (`cookbook.ts`): ten techniques, each explained and added to the block it belongs in with the next line number. The old Insert snippets pasted bare lines, which are base values evaluated once — every one compiled and did nothing. Each recipe is tested to compile, stay MilkDrop 2-portable and change the picture (`milkdrop-cookbook.test.ts`) |

## Inspect tab

`src/js/milkdrop/variable-probe.ts` is an opt-in feed: the frame loop
publishes `frameState.variables` only while the tab is showing.
`variable-history.ts` keeps the rolling history, min/max and pins.
