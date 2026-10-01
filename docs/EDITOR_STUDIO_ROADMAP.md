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
| 1 | Make equations visible: Inspect tab (live variables, pins, sparklines) | **Shipped.** Inspect tab; parameter knobs (`preset-knobs.ts`); reactivity meter (each variable tagged with the audio band it follows, and a one-line "follows the audio" summary — `variable-history.ts`); Freeze and Step to hold the stage and advance one frame at a time (`milkdrop-reactivity-meter.test.ts`, `toy-runtime-preview-loop.test.ts`). From the equations alone (`preset-dataflow.ts`): Tune chips and Outline rows name the audio that reaches each control and drawn part, and a fader the per-frame code drives shows the value the frame used (`editor-panel-controls.test.ts`, `editor-panel-outline.test.ts`) |
| 2 | Structured editing: per-section outline, shape/wave solo, shader translation view | **Shipped.** Outline tab, shader translation view (`shader-translation.ts`), and Solo/Mute on the Outline for each custom wave and shape and for the main waveform, borders and motion vectors (`render-isolation.ts`: hides the element as `enabled=0` would, without touching the source; `milkdrop-render-isolation.test.ts`). Each custom wave and shape has its own controls in Tune, picked there or from its Outline row (`slot-controls.ts`; `editor-panel-controls.test.ts`) |
| 3 | Formats: Format round-trip guarantee, packs, unknown-key preservation, MilkDrop 2 export | **Shipped.** Format is lossless (`lab:format-roundtrip` fingerprints shader text as written, equation comments and fields Stims ignores; `milkdrop-lossless-format.test.ts`). Export writes the file MilkDrop 2 saves — `[preset00]`, its key names, backtick shader lines — and every corpus preset comes back unchanged (`milkdrop2-export.test.ts`). Packs import from `.zip` (`preset-archive.test.ts`), and Browse exports the presets you made or imported as a `.zip` of MilkDrop 2 files, drafts included — their only backup, since they live in this browser (`preset-pack-export.test.ts`) |
| 4 | Named versions, arbitrary diff, fork tree | **Shipped.** Named versions with compare against the buffer or another saved version; the Browse family section is a fork tree (`buildForkTree` in `preset-lineage.ts`): a remix made here nests under the preset it came from (recorded at Remix time), published variants hang under the original by title (`preset-fork-tree.test.tsx`) |
| 5 | Live compatibility checklist | **Shipped.** Compat tab (`compat-checklist.ts`): what will not run as written on Stims. "Beyond Stims" (`portability.ts`): what will not carry over to MilkDrop 2 — Stims-only functions with a rewrite, Stims-only signals, Stims settings, textures to ship, GLSL in shaders. projectM and Butterchurn are assumed to follow MilkDrop 2 and are not checked separately. 1,484 of the 1,750 bundled presets translated from Butterchurn are flagged (GLSL shaders, `mod()`, `randint()`); 6 of the 936 MilkDrop 2/projectM presets are, mostly for texture files. Next: have Export rewrite the fixable ones |
| 6 | Publish-from-editor, gallery browse + remix, short share links, archive rescue | **Blocked on moderation.** The old `/api/presets` endpoint was deleted on 2026-09-30, months after the browse sheet stopped calling it. Its `POST` took any body (no size cap, no check it was a preset, no rate limit, CORS `*`) and served it publicly with no review step. A replacement needs, at minimum: a size cap and a parse check, a per-IP rate limit, and uploads held for review (or reportable and hideable) before a Publish button points people at it |
| 7 | Searchable in-app function reference and technique cookbook | **Shipped.** Reference tab (`reference-search.ts`); the Insert tab is now a cookbook (`cookbook.ts`): ten techniques, each explained and added to the block it belongs in with the next line number. The old Insert snippets pasted bare lines, which are base values evaluated once — every one compiled and did nothing. Each recipe is tested to compile, stay MilkDrop 2-portable and change the picture (`milkdrop-cookbook.test.ts`) |

## Inspect tab

`src/js/milkdrop/variable-probe.ts` is an opt-in feed: the frame loop
publishes `frameState.variables` only while the tab is showing.
`variable-history.ts` keeps the rolling history, min/max and pins.
