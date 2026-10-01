# Lineage and credits

This document defines the attribution posture for Stims when we talk about the MilkDrop visualizer lineage in public copy, docs, presets, tests, and code comments.

## Baseline wording

Use language like:

- "Play and live-edit MilkDrop presets in your browser." This is the public pitch: the README tagline, the page title, and link previews all use it. It names what Stims does with the presets rather than claiming to be MilkDrop, and it is more accurate than "MilkDrop-inspired", because the presets are the original `.milk` files.
- "Independent browser-native visualizer built in the lineage of Ryan Geiss's MilkDrop."
- "Able to load and render presets from the MilkDrop/projectM ecosystem. Visual fidelity is measured one preset at a time against native projectM; only a few presets have been measured, and most of those still differ visibly." Quote counts only from the current scoreboard in [the parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md#current-state-2026-08-27), never from memory.

Avoid language like:

- "Official MilkDrop for the web."
- "Winamp MilkDrop in the browser."
- "Full projectM replacement" unless the implementation and test harness actually prove that claim.
- "MilkDrop-inspired." The presets are the original files, so the word undersells what Stims runs and contradicts the pitch.
- "The first MilkDrop in the browser," or anything that implies it. Butterchurn was first.
- "High-performance," "fast," or any speed claim without a benchmark against Butterchurn behind it (`bun run bench:butterchurn`).
- Leading with the model-backed routes (generate, refine, blend, visual search). They are optional Worker routes whose availability depends on deployment; see [technical foundations §7](./TECHNICAL_ACHIEVEMENTS.md#7-optional-edge-services--implemented-routes-deployment-dependent-product-behavior).

## What Stims contributes

Product copy (the home page, page titles, link previews) says what Stims does and needs no novelty claim. Any surface that says what is new, such as the README, `llms.txt`, the technical docs or a launch post, uses these three, in this order:

1. **Per-pixel equations run on the GPU, held to the CPU's answer.** Preset equations compile to one IR that runs on an interpreter or a JavaScript JIT. On WebGPU, per-pixel and custom-wave point equations that read only their own inputs are also lowered into the shader and evaluated for every vertex in parallel ([`gpu-field-planner.ts`](../src/js/milkdrop/compiler/gpu-field-planner.ts)); on 2026-10-01 that covered 1,094 of the 1,102 catalog presets with per-pixel code. That is the new part: Butterchurn and projectM run per-pixel equations on the CPU, one grid point at a time. Seeded differential fuzz tests ([`eel-tier-differential`](../tests/unit/eel-tier-differential.test.ts), [`gpu-field-tier-differential`](../tests/unit/gpu-field-tier-differential.test.ts)) hold the tiers to the same results. Their first runs found 18 shipped preset blocks the JIT could not compile and divergent results in 32% of GPU-lowered programs.
2. **Fidelity is measured, not asserted.** Stims is compared with frames from native projectM, both stepped on a fixed clock, and a difference counts only when it exceeds that preset's own run-to-run noise (`bun run parity:noise`). Results are published per preset, failures included ([scoreboard](./MILKDROP_PROJECTM_PARITY_PLAN.md#current-state-2026-08-27)), and `parity:promote-reference` refuses to certify a reference that a blank frame would pass.
3. **The preset corpus is read as a set of programs.** `bun run lab:dataflow` works out, from the equations alone, which audio signals reach each control and each drawn program, and the editor shows the same reading beside each slider an equation drives (`eq · bass`). It sorts all 2,679 presets in the lab corpus in seconds, and in 73 of them the audio reaches nothing on screen. Used as training data, the corpus shows that presets behave as threshold programs: gradient-boosted trees beat every network tried, and 41% of memoryless audio-driven controls can be recovered as exact equations from their behaviour ([findings](./guides/training-models.md)).

Present these as what is not new:

- **Running MilkDrop presets in a browser.** Butterchurn did it first.
- **Editing a preset while it plays.** MilkDrop 2 had a built-in editor. Stims brings it back, adding completions, compiler diagnostics, sliders, and a link that carries the edit. Compare it only with Butterchurn and projectM, which have no editor, and say "brings back".
- **Playing `.milk` files without converting them.** projectM does too; the contrast holds only against Butterchurn.

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
- The `/discover/` and `/learn/` pages should acknowledge the lineage and the broader preset ecosystem.
