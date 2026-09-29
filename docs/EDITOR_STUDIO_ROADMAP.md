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
| 1 | Make equations visible: Inspect tab (live variables, pins, sparklines) | **Inspect tab shipped**; q-var knobs, reactivity meter, frame stepping next |
| 2 | Structured editing: per-section outline, shape/wave solo, shader translation view | planned |
| 3 | Formats: Format round-trip guarantee (**shipped**, `milkdrop-formatter-roundtrip.test.ts`), packs, unknown-key preservation | in progress |
| 4 | Named versions, arbitrary diff, fork tree | planned |
| 5 | Live compatibility checklist | **Compat tab shipped** (`compat-checklist.ts`): what will not run as written on Stims, worst first, jump to line. A per-engine (MilkDrop 2 / projectM / Butterchurn) view is still planned |
| 6 | Publish-from-editor, gallery browse + remix, short share links, archive rescue | planned; confirm the client is wired to `/api/presets` first |
| 7 | Searchable in-app function reference and technique cookbook | **Reference tab shipped** (`reference-search.ts`); cookbook next |

## Inspect tab

`src/js/milkdrop/variable-probe.ts` is an opt-in feed: the frame loop
publishes `frameState.variables` only while the tab is showing.
`variable-history.ts` keeps the rolling history, min/max and pins.
