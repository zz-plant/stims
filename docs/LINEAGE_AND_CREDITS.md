# Lineage and credits

This document defines the attribution posture for Stims when we talk about the MilkDrop visualizer lineage in public copy, docs, presets, tests, and code comments.

## Baseline wording

Use language like:

- "Independent browser-native visualizer built in the lineage of Ryan Geiss's MilkDrop."
- "Inspired by MilkDrop-era preset workflows."
- "Compatible with parts of the broader MilkDrop/projectM preset ecosystem."

Avoid language like:

- "Official MilkDrop for the web."
- "Winamp MilkDrop in the browser."
- "Full projectM replacement" unless the implementation and test harness actually prove that claim.

## Credits Stims owes

- **Ryan Geiss / MilkDrop**: credit the original creative and technical lineage of the flagship visualizer.
- **Winamp / Nullsoft**: credit the original public product context when discussing MilkDrop history.
- **Preset authors and curators**: credit the people who created or assembled shipped preset packs, import fixtures, screenshots, and compatibility corpora.
- **projectM contributors**: credit them whenever projectM materially informs the work through code, tests, behavior diffing, compatibility research, or preset collections.

## Contributor rules

- If you import presets, fixture packs, or screenshots, record provenance and license details in the same change.
- Vendored upstream preset fixtures should carry a local README beside the corpus with source repo, commit, and license notes.
- If you reuse projectM code, assets, or corpora, keep license obligations and acknowledgments explicit.
- If a public page or README calls Stims a "successor," pair that claim with explicit lineage language and avoid implying official affiliation.
- Prefer precise compatibility claims over broad parity claims.
- If you organize successor workstreams, keep the current evidence and ownership map in [`MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./MILKDROP_SUCCESSOR_WORKSTREAMS.md) so claims stay synchronized with proof.

## Public-facing copy guidance

- The homepage and MilkDrop pages should surface lineage explicitly, not only in buried docs.
- The repo README should state that Stims is an independent implementation.
- Generated toy pages for `milkdrop` should acknowledge the lineage and the broader preset ecosystem.
