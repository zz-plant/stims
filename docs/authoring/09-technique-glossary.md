# 9 · The technique glossary

By the mid-2000s MilkDrop authors had invented something nobody planned: a
citation system inside a filename field. Techniques circulated as **named
modules**, attributed in the title of every preset that used them.

```
Aderrasi + Geiss - Airhandler (Painterly Relief Mix)
Eo.S. - glowsticks v2 03 music shifter edit b (Jelly V2)
Stahlregen & Eo.S + Geiss + ORB + Phat - Fruitsticks (Flexi-Tex Shader)
martin - the forge of isengard [flexi's moebius transformation vs. logarithmic spiral mix]
martin - lightning [Goody tunnel artifact tweak]
```

That last pair is the sharpest version of it: the bracket credits a *named
mathematical technique* attributed to another author, not a preset. Citation
practice, invented independently, inside a text field meant for names.

This page is the working glossary of that vocabulary, built from the 1,787
presets Stims ships.

## How to read the numbers

Each entry gives the count of shipped presets whose title carries the marker,
and the handles most often credited on those presets.

**A byline is evidence of who applied a technique, not proof of who invented
it.** These counts tell you where a technique shows up and in whose company. To
establish origin you need the *earliest datable* appearance, which needs forum
timestamps and pack release dates the catalog does not carry. Entries below are
marked accordingly:

- **[A]** — attribution is in the marker's own name (`Flexi-Tex`, `Stahl's
  Mirror Crossfire`, `Krash's beat code`). The convention names the author.
- **[C]** — a handle dominates the co-credit data strongly enough to be worth
  recording, without being asserted as the originator.
- **[?]** — open. The technique is real and the vocabulary is stable; who
  introduced it is not established here.

## The glossary

| Technique | Shipped | Most-credited | | What the marker signals |
|---|---:|---|---|---|
| **Jelly** (`Jelly`, `Jelly V2/V3/V4`, `Reverse Jelly V3`, `bccn Jelly V4`, `[jelly5.5]`) | 59 | Flexi (27), Geiss (21), Stahlregen (15) | [C] | The single largest named family in the catalog, and the only one with real version discipline — V2 through V5.5, plus a `Reverse` variant. A wobbling, viscous displacement of the feedback frame. |
| **Painterly** | 29 | Geiss (22), Aderrasi (5) | [C] | Softened, brush-like accumulation. Appears both alone and compounded (`Painterly Relief Mix`, `Painterly Tendrils Colorfast`). |
| **Kaleidoscope** | 20 | Geiss (15), Rovastar (6) | [?] | Angular mirroring, from the plain `Kaleidoscope Mix` through `Flexi's kaleidoscope`. |
| **Relief** (`Relief Mix`, `Bas Relief`, `Beetle Relief`) | 18 | Geiss (17), Flexi (4) | [C] | Edge-lit embossing that reads as raised surface. Almost never appears without Geiss in the chain. |
| **Emboss** (`Emboss`, `Color Emboss Mix`, `Geiss Emboss Mix`) | 11 | Geiss (10), Flexi (3) | [C] | Directional-difference shading. `Geiss Emboss Mix` is [A]. |
| **Saturation** (`Saturation Remix`, `Color Saturation Boosted`) | 10 | Geiss (10) | [C] | Chroma push on the composite pass. Every shipped instance credits Geiss. |
| **Ripple** (`Ripples`, `Ripple Mix`, `Martin's ripple on water insertion`) | 10 | Flexi (4), shifter (3) | [?] | Concentric radial displacement. The `Martin's …` variant is [A]. |
| **Composite** (`Geiss composite mix`, `Flexi composite`) | 9 | Geiss (3), Flexi (2), ORB (2) | [A] | Names whose composite-pass treatment was grafted on. |
| **Grow Mix** (`Grow Mix`, `2`, `3`, `3c - finally mirrored`) | 9 | Geiss (7), fiShbRaiN (5) | [C] | Outward-scaling accumulation. The numbered series is a single lineage — see the *witchcraft* family. |
| **Crossfire** (`Stahl's Mirror Crossfire Mix`) | 7 | Geiss (6), Mstress (2) | [A] | Mirrored cross-blend. The marker names Stahlregen. |
| **Kali Mix** | 6 | Aderrasi (6), Geiss (3) | [?] | An *Airhandler* branch specifically — the root of a three-deep derivation chain, and the deepest documented lineage in the catalog. |
| **Filament Mix** | 6 | Geiss (4), Stahlregen (1) | [?] | Thin, threadlike trails through the warp field. |
| **Glow Mix** (also `Everglow`, `Blur and Glow Remix`) | 5 | Geiss (4), shifter (3) | [?] | Bloom on the composite. |
| **LSB Mix** | 3 | Geiss (3) | [?] | Low-bit manipulation for banding/noise texture. Rare and worth a dissection. |
| **HPF** | 2 | Eo.S. (1), Geiss (1) | [?] | High-pass filtering on the feedback frame. |
| **Flexi-Tex Shader** | 1 | Stahlregen, Eo.S., Geiss | [A] | Flexi's texture-shader technique, credited by name on a preset he is not a byline author of. |

Component credits are tracked separately from the mix vocabulary because they
cite *code*, not a look. `parsePresetCredit` lifts them out of the title into
`componentCredits` — see
[`preset-credit.ts`](../../src/js/milkdrop/preset-credit.ts).

| Component | Shipped | | Notes |
|---|---:|---|---|
| **Krash's beat code** (`(+Krash's beat code)`, `(Krash's beat detection)`, `+ krash beatdetect`) | 8 | [A] | A beat-detection routine that propagated by being copied into other authors' presets and credited inline. The scene's earliest component-library convention, and the clearest evidence that remixing here was open circulation with attribution — not, as is sometimes claimed, reverse engineering. |

Two more component credits sit in the *author* field rather than the title, so
they are handled by the handle registry instead:
`martin [shadow harlequins shape code]` and `shadow harlequin - babylon warp
drive resurrection call [Flexi's insertion of Martin's ripple on water
shader]`. Same practice, different field.

## Compatibility markers

Not techniques, but part of the same filename grammar, and part of the
authorship record:

| Marker | Shipped | Meaning |
|---|---:|---|
| `(ATI fix)` (6), `(geiss flicker fix)` (3), `[fixed]` (1) | 10 | The preset was modified to run correctly on another vendor's hardware. Unglamorous, uncredited-elsewhere labour. |
| `-ps2` / `-ps3` / `(ps2.0)` | 9 | Shader-model variants of the same work, from the MilkDrop 2 transition. Stims strips the suffix for family grouping, so `rogue wave -ps2` and `-ps3` sit together. |

## Open questions

The glossary is deliberately incomplete, and these are the gaps worth closing:

1. **First datable appearance of each technique.** This is the question that
   turns [C] and [?] into [A]. It needs forum post timestamps and pack release
   dates, not filenames.
2. **Who named these?** The vocabulary is stable enough that authors used it
   without explanation by the mid-2000s, which means it was established
   somewhere — most likely the Winamp MilkDrop forum. Nobody appears to have
   written that down.
3. **Are the version numbers chronological?** `Jelly V2` → `V3` → `bccn Jelly
   V4` → `[jelly5.5]` looks like a series, and `V2i2` suggests internal
   versioning discipline nobody documented. Testable by diffing the shipped
   sources.
4. **What did each one actually do?** Every entry above is described from its
   visual effect. The presets are on disk; a dissection of the shipped source
   for Jelly, Relief, and Painterly would replace description with mechanism —
   and would fit as a sixth entry in [Track 7 · Taste](07-taste.md).

## Regenerating these counts

The table is derived, not hand-maintained. To recount after a catalog change:

```bash
bun run catalog:techniques
```
