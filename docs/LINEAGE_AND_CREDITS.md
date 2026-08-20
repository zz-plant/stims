# Lineage and credits

This document defines the attribution posture for Stims when we talk about the MilkDrop visualizer lineage in public copy, docs, presets, tests, and code comments.

## Baseline wording

Use language like:

- "Independent browser-native visualizer built in the lineage of Ryan Geiss's MilkDrop."
- "Inspired by MilkDrop-era preset workflows."
- "Able to load and render presets from the MilkDrop/projectM ecosystem. Visual fidelity varies: 4 of 23 certification-corpus presets have measured near-exact results; the remaining presets are at the compiler/runtime compatibility stage and have not yet been measured against projectM references."

Avoid language like:

- "Official MilkDrop for the web."
- "Winamp MilkDrop in the browser."
- "Full projectM replacement" unless the implementation and test harness actually prove that claim.

## Credits Stims owes

- **Ryan Geiss / MilkDrop**: Credit the original creative and technical lineage of the flagship MilkDrop visualizer, per-pixel warp equations, and Winamp plugin.
- **Jordan Berg (`jberg`) & Butterchurn Contributors**: Credit the pioneering web implementation of MilkDrop in WebGL that made web-based visualization accessible to millions. Butterchurn's home is butterchurnviz.com; milkdrop.org is a separate, later community site that *uses* Butterchurn for its browser previews, so do not credit Butterchurn to it.
- **Carmelo Piccione, Mischa Spiegelmock & projectM Contributors**: Credit them whenever projectM materially informs the work through code, tests, behavior diffing, compatibility research, reference captures, or preset collections.
- **Preset Authors**: Credit the artists who created the shipped presets, import fixtures, screenshots, and compatibility corpora. The most-credited handles in the catalog are *Geiss, Flexi, Martin, Rovastar, Eo.S., Stahlregen, Unchained, fiShbRaiN, Phat, Aderrasi, Shifter, Zylot, ORB, suksma, Cope, Goody, and Krash*, with roughly 120 more behind them. Any name added to this list must appear in the shipped catalog — see [Verifying a credit](#verifying-a-credit).
- **Curators**: Credit pack compilers as curators, distinctly from authors. Curation decided which presets anyone ever saw: *djdafreund* (Better Living Through Chemicals, which ships inside projectM as `bltc201`) and *Jason Fletcher / ISOSCELES* (Cream of the Crop, the default projectM pack since 2022) are the two whose selections Stims inherits.
- **Winamp / Nullsoft**: Credit the original public product context when discussing MilkDrop history.

## How to credit a preset author

Preset authors published under handles. Those handles are the names the work
entered the world under, the names the community uses, and the names embedded
in the filenames — so they are what Stims credits, and the correct spelling is
the published one, not a tidied-up one.

- **Spell the handle as published.** `fiShbRaiN`, not `Fishbrain`. `Eo.S.`, not
  `EoS`. `shifter` and `suksma` stay lowercase because that is how they signed
  their work. The canonical spelling for every handle Stims knows lives in
  [`src/js/milkdrop/preset-handles.ts`](../src/js/milkdrop/preset-handles.ts);
  add to that registry rather than hand-casing a name in a component.
- **Never truncate a credit chain.** MilkDrop bylines are accretive: a remixer
  joins the chain rather than replacing the people already in it. "Stahlregen &
  Geiss + Rovastar + Illusion + Krash + Rozzor — Cyclopean Shift (Eyeless Mix)"
  names six hands, and all six get printed. "and others" is not an acceptable
  abbreviation.
- **Carry inline component credits through.** `(+Krash's beat code)` is a real
  attribution — the scene's own way of citing a borrowed routine, and the
  earliest component-library convention it has. `parsePresetCredit` extracts
  these into `componentCredits`; surfaces that show a byline should show them
  too.
- **Keep compatibility work visible.** `(ATI fix)`, `(geiss flicker fix)`,
  `[fixed]`, `-ps2`/`-ps3` record the unglamorous labour of making a preset run
  on someone else's hardware. That is authorship, and it is preserved in
  `compatibilityNotes` and `shaderModel`.
- **Credit curators as curators.** A pack compiler is not an author of the
  presets in the pack, and an author is not the curator of a pack their work
  appears in. Conflating the two has already produced one wrong credit on our
  own about page.
- **Use a legal name only where the person publishes under one.** Ryan Geiss;
  Jason Fletcher, who credits himself as both Fletcher and ISOSCELES; Bill
  Melgren, whose name appears in Geiss's own credits and in filenames as
  *Bmelgren*. Everyone else is their handle and nothing else. Do not add an
  author's employer, location, or personal accounts to this repo.
- **Link a byline only to a page the author publishes under.** Pointing a name
  at a pack that redistributes their work implies it is their site and quietly
  credits the distributor instead. Most authors have no live page; leave those
  unlinked.

### Verifying a credit

Every name in public copy must be checkable against something in this repo.
Before adding one:

1. **Confirm it is in the shipped catalog.** A name that appears in no preset
   cannot be described as powering the catalog. This is not hypothetical — the
   README previously credited *FSP*, *Unbalanced*, and *Yad* for the catalog's
   presets, and none of the three appear in any of them.
2. **Confirm the role.** Author, curator, or engine contributor are different
   claims. We previously labelled Eo.S. the curator of Cream of the Crop (that
   is Jason Fletcher / ISOSCELES) and credited Rovastar with projectM
   development (his documented engine contribution is the cross-vendor
   texel-alignment research credited in Geiss's own MilkDrop changelog).
3. **Prefer a primary source**: a preset file, a changelog entry, repository
   metadata, a dated forum post, or the person saying it on the record.
   Secondary summaries of MilkDrop history are reliable on structure and
   unreliable on names, dates, and etymologies — treat a confident unsourced
   proper noun as a probable error rather than a probable find. A fabricated
   attribution of Butterchurn to a "Jari Jokinen" circulates widely enough that
   it is worth naming; Butterchurn is Jordan Berg's.

To check a name against the catalog:

```bash
bun run catalog:authors -- --dry-run
```

That reports every catalog preset whose author could not be confirmed against
the handle registry, which is also the list of handles worth researching next.

## Contributor rules

- If you import presets, fixture packs, or screenshots, record provenance and license details in the same change.
- Vendored upstream preset fixtures should carry a local README beside the corpus with source repo, commit, and license notes.
- If you reuse projectM code, assets, or corpora, keep license obligations and acknowledgments explicit.
- If a public page or README calls Stims a "successor," pair that claim with explicit lineage language and avoid implying official affiliation.
- Prefer precise compatibility claims over broad parity claims.
- If you organize successor workstreams, keep the current evidence and ownership map in [`MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./MILKDROP_SUCCESSOR_WORKSTREAMS.md) so claims stay synchronized with proof.
- If you add a preset author to any public surface, follow [Verifying a credit](#verifying-a-credit) first.
- Do not quote a raw preset-pack size as a count of distinct works. The circulating 52k, 73k, and 97k figures are **file** counts; a checksum pass over the 52k corpus yields roughly 44k unique presets, with many near-duplicates beyond that. If you ever dedupe a pack, normalize `fRating=` across the files first — otherwise rating differences defeat checksum matching.

## Public-facing copy guidance

- The homepage and MilkDrop pages should surface lineage explicitly, not only in buried docs.
- The repo README should state that Stims is an independent implementation.
- Generated toy pages for `milkdrop` should acknowledge the lineage and the broader preset ecosystem.
