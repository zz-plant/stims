---
version: 1
slug: "src-js-frontend-app-tsx"
primary_target: "src/js/frontend/App.tsx"
related_targets: ["src/js/frontend/NewHomePage.tsx","src/js/frontend/StageControls.tsx"]
---

# Stims app chrome

Scope: the whole app chrome (landing, dock, title card, Browse, side panels, settings, editor), one replacement visual world. Mode: Experience for the player (the stage leads), Persuade for the landing's first viewport, Operate for the editor and settings, which inherit the world through tokens.

Audience and job: listeners at night with music on, editors who open a preset to read and change it, performers on a second display. The stage stays the brightest thing on screen.

Constraints: no three-hue gradients, no glass except controls that float on the stage, no overshoot motion or View Transitions (user feedback). Both backends; 390x844 portrait is a measured context. Catalog numbers come from the catalog's `order` field; a preset with no catalog entry prints no number.

## Direction contract

THESIS: Every preset is a numbered filter on a riveted strip of black card, and the stage is the light it colours. Refuses the category's frosted pill floating over a black void with neon accents.

OWN-WORLD: Matte black cover stock (#0f0f0e) for every chrome surface, printed in one off-white (#ecece7) and a spec grey (#8f8e88). Safelight amber (#ffb21a) is the only emitted colour and marks lit state only: the bands a preset reads, the active control, focus. One white page tab per view for the primary action. Pathway Extreme condensed for numbers, names and legends, full width for text; Atkinson Hyperlegible Mono for code. 6px die-cut corners, a punched rivet hole that shows what is behind it, one 1px rule weight, tabular figures everywhere.

STORY: A visitor sees the stage running and the playing preset printed on its strip (number, name, maker, the sounds it reads lit live). They start the sound, pull strips from the book to change presets, and open one to read the equation each sound drives.

FIRST VIEWPORT: The attract preset fills the screen. A black cover sheet stands at the top left, about 30rem wide, riveted at its top corner: the nameplate small, the promise in condensed display at about 3.5rem, the tagline, then the white "Start visualizer" tab with Browse and Edit as outlined tabs beside it, the demo note under them. The stage to its right stays clear. In the player, the dock is one horizontal strip with a rivet at its left end, the catalog number printed before the title, and a three-band graph along its top edge lit by bass, mid and treble.

FORM: Gel swatchbook, third on the ordered grounded list, assigned by the roll; seed key 809ffbd3. Signature interaction: pulling a strip. A strip slides up out of its row on hover or focus, and on a preset change the title strip swings into place about its rivet (a 3 degree swing, exponential ease-out, no swing under reduced motion).

Raises: safelight budget (darkroom), one marked line per view (zine), one hardware line weight (pastel), lineage ticket keeping the parent number on an edited preset (bazaar), tabular truth (daylight section).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Browse may show the band graph only for the playing preset; the catalog stores no per-preset band data.
