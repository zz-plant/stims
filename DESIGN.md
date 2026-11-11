---
name: Stims
description: A browser MilkDrop visualizer and live preset editor, printed as a gel swatchbook of riveted black card strips.
colors:
  cover-stock: "#0f0f0e"
  cover-stock-raised: "#151514"
  card: "#171716"
  control-fill: "#1b1b19"
  control-fill-hover: "#252522"
  stage-floor: "#0a0a09"
  print-white: "#ecece7"
  print-white-strong: "#f6f6f2"
  spec-grey: "#8f8e88"
  muted-grey: "#a3a29c"
  rule-line: "rgba(236, 236, 231, 0.12)"
  rule-line-strong: "rgba(236, 236, 231, 0.3)"
  safelight-amber: "#ffb21a"
  on-amber: "#141210"
  signal-good: "#8fd694"
  signal-bad: "#ff6a5c"
  page-white: "#f2f2ee"
  page-card: "#fbfbf8"
  page-ink: "#161615"
  page-muted: "#55544f"
  page-rule-line: "rgba(22, 22, 21, 0.2)"
  safelight-amber-ink: "#8a4e00"
  page-good: "#176b37"
  page-bad: "#b42318"
typography:
  display:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 4vw, 3.5rem)"
    fontWeight: 760
    lineHeight: 0.96
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.875rem, 4.6vw, 4rem)"
    fontWeight: 760
    lineHeight: 0.98
    letterSpacing: "-0.01em"
  nameplate:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 820
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 75"
  body:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-lead:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.45
  button:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 88"
  legend:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 78"
  catalog-number:
    fontFamily: "Pathway Extreme, Segoe UI, system-ui, -apple-system, sans-serif"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 75"
  code:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  hairline: "1px"
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
  2xl: "10px"
  round: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "2.5rem"
  3xl: "3rem"
  4xl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.print-white-strong}"
    textColor: "{colors.cover-stock}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "48px"
  button-primary-light:
    backgroundColor: "{colors.page-ink}"
    textColor: "{colors.page-white}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.print-white-strong}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0.8rem 1.1rem"
    height: "46px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-grey}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.9rem"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.control-fill}"
    textColor: "{colors.print-white-strong}"
  switch-off:
    backgroundColor: "rgba(0, 0, 0, 0.3)"
    rounded: "{rounded.md}"
    width: "40px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.safelight-amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.md}"
    width: "40px"
    height: "24px"
  cover-sheet:
    backgroundColor: "{colors.cover-stock}"
    textColor: "{colors.print-white-strong}"
    rounded: "{rounded.lg}"
    padding: "36px 32px 24px"
    width: "34rem"
  legend-tab:
    backgroundColor: "{colors.cover-stock}"
    textColor: "{colors.print-white}"
    typography: "{typography.legend}"
    rounded: "{rounded.md}"
    padding: "6px 10px 5px"
  dock-strip:
    backgroundColor: "{colors.cover-stock}"
    textColor: "{colors.print-white}"
    rounded: "{rounded.lg}"
    padding: "5px 5px 4px 32px"
  preset-card:
    backgroundColor: "{colors.cover-stock-raised}"
    textColor: "{colors.print-white}"
    rounded: "{rounded.lg}"
  code-well:
    backgroundColor: "{colors.stage-floor}"
    textColor: "#e4e4df"
    typography: "{typography.code}"
---

# Design System: Stims

## Overview

**Creative North Star: "The Gel Swatchbook"**

Every preset is a numbered lighting-gel filter on a strip of matte black card, riveted at one end, and the stage is the light it colours. The chrome is the swatchbook held up in front of that light: opaque card, printed in one off-white and one spec grey, die-cut at small corners, with a hole punched through each strip that shows whatever is playing behind it. Nothing in the chrome emits light except one safelight amber, and amber means one thing: this is lit.

The stage is always the brightest thing on screen and stays dark in every theme. Chrome that sits on it is a card, not a frosted pill: the landing's cover sheet, the starter strips under it, the title card that swings in on a preset change, and the dock strip along the bottom. Off the stage (editor, settings, Browse page, Read pages) the same stock becomes the page; the light theme is the swatchbook's inner pages, white card printed in near-black with the amber darkened to ink.

Density is a printed spec sheet's: numbers, names and legends in a condensed technical grotesque, running text at full width, code in a mono drawn for low-vision readers, tabular figures wherever a number appears. The owner has rejected multi-hue gradients, glassmorphism and springy, overshooting motion; the system carries all three as hard prohibitions.

**Key Characteristics:**
- Matte black card stock for every chrome surface; the stage keeps the colour.
- Safelight amber as the only emitted colour, reserved for lit state.
- One white page tab per view for the primary action (black in the light theme).
- A punched rivet hole with a 1px eyelet on every strip that prints a preset.
- One typeface at several widths: Pathway Extreme from 75% to 100% wdth.
- One 1px rule weight for every rule, outline and eyelet.
- Corners die-cut on a short guarded ladder (6px strips, 4px controls).
- Motion is a pull and a swing: strips slide up out of the book, the title card rotates into place about its rivet.

## Colors

A neutral, faintly warm black-and-off-white print with a single safelight amber, inverted for the light theme while the stage and everything on it stays dark.

### Primary
- **Safelight Amber** (dark theme) and **Safelight Amber Ink** (light theme, 5.0:1 on page card): the only colour the chrome emits. It marks the bands a preset reads in the transmission graph, controls that are on or selected (switch on, active Browse card, open-panel menu items), focus outlines, the editor caret and selection, and live indicators. Ink on an amber fill is On Amber.

### Neutral
- **Cover Stock**: every chrome surface in the dark theme, and every on-stage card in both themes (cover sheet, dock strip, title card, legend tabs).
- **Cover Stock Raised** and **Card**: panels and Browse cards one step lifted from the page.
- **Control Fill** / **Control Fill Hover**: the sunk face of buttons and fields; hover lifts one step.
- **Stage Floor**: the code well and the Browse book's ground; the darkest neutral in the system.
- **Print White** / **Print White Strong**: all text and the primary page tab. Strong is reserved for display type, nameplate and the tab.
- **Spec Grey**: legends, catalog-number prefixes, unlit graph labels, gutter numbers. Kept at a value that holds AA on cover stock.
- **Muted Grey**: secondary copy and ghost-button labels.
- **Rule Line** / **Rule Line Strong**: 1px rules, outlines, eyelets and unlit graph columns.
- **Page White**, **Page Card**, **Page Ink**, **Page Muted**, **Page Rule Line**: the light theme's inner pages, the same roles inverted.

### Signal
- **Signal Good** / **Signal Bad** (and their light-theme Page Good / Page Bad): success and error only, never decoration. A warning is not amber; it carries its own words.

### Named Rules
**The Safelight Rule.** Amber is spent only on lit state: bands a preset reads, on or selected controls, focus, live dots. Never on hints, warnings, decorative rules, badges or prose. If an amber element is not reporting that something is on, lit or focused, it is the wrong colour.

**The Stage Pins Its Own Ink Rule.** Anything that sits on the stage pins the on-stage tokens for fill, ink, accent and lines (`--stims-on-stage-*`, or by overriding `--stock-fill`, `--stims-accent`, `--stims-line`, `--stims-ink` on the element). The stage is dark in the light theme, and a surface that follows the page palette there draws a light card under white ink. A surface and the ink on it come from the same palette.

**The Neutral Field Rule.** Gradients are single-hue neutrals or functional masks (the stage floor's lift, the ruled grid, the rivet punch). Never a gradient of three or more hues; the only colour on a page is the preset's.

## Typography

**Display Font:** Pathway Extreme (variable, wdth 75–100%, opsz 8–12, wght 100–900), with Segoe UI, system-ui fallback
**Body Font:** Pathway Extreme at full width
**Label/Mono Font:** Atkinson Hyperlegible Mono (wght 200–800) for code and engine-reported numbers

**Character:** One technical grotesque printed at several widths, the way a gel swatchbook prints filter numbers and names narrow and heavy, spec lines narrow and small, and text at full width. The mono keeps 0/O and 1/l/I apart in an equation.

**Rasterised cards:** resvg cannot set variation axes, so the social cards, the edge share card and the PWA screenshots use static instances in `public/og/fonts/`, cut from the same variable faces: Pathway Extreme Regular and Medium, Pathway Extreme Condensed Bold (wdth 78, wght 760) and Atkinson Hyperlegible Mono Bold. Recut them from the variable sources when the faces change, and keep a new card's text within those four styles.

### Hierarchy
- **Display** (760, clamp 2.25–3.5rem, 0.96, wdth 78%, balanced): the promise on the landing cover, max 14ch.
- **Headline** (760, clamp 1.875–4rem, 0.98): the preset name on the title card. The name's width axis is fitted per name so it sets on one line; a name too long even condensed drops to clamp(1.5rem, 3.8vw, 3.25rem) and wraps to two balanced lines.
- **Nameplate** (820, 1.25rem, wdth 75%): the Stims wordmark, printed like a maker's name; the boot cover in index.html repeats its metrics.
- **Body Lead** (400, 1.125rem, 1.45, max 30rem): the cover tagline and similar single lead paragraphs.
- **Body** (400, 1rem, 1.5): running text. Read pages set 1.0625rem at 1.7.
- **Button** (700, 1rem, wdth 88%, 0.01em): every tab and button label.
- **Legend** (600, 0.6875rem, wdth 78%, 0.06em, uppercase): graph band names, the graph's "Driven by" row header, spec lines. Legend tabs over a landing section set 0.8125rem bold at 0.12em.
- **Catalog Number** (700, wdth 75%, tabular): the digits; a "No." prefix at 0.62em in spec grey precedes them.
- **Code** (Atkinson Hyperlegible Mono, 0.875rem, 1.6): the editor and inline code.

### Named Rules
**The Width Axis Rule.** Hierarchy comes from width and weight within one family, not from a second display face. Condense to fit a name; never shrink a name below the scale to fit it.

**The Tabular Truth Rule.** Every number the chrome prints (catalog numbers, readouts, BPM, counts) sets in tabular figures.

**The Scale Floor Rule.** Sizes come from the `--text-*` ladder (0.6875rem floor) and weights from 400/500/600/700/760/820; `bun run check:css-scale` fails on anything else.

## Layout

The stage fills the viewport and the chrome sits on it at the edges, leaving the frame clear. On the landing, one cover sheet about 34rem wide stands at the top left inside a 52rem column, with the source buttons, privacy note and starter strips below it as their own tabs and strips; the right of a 16:9 frame belongs to the preset. In the player the title card sits top left (clamp 16–56px inset, safe-area aware) and the dock strip runs along the bottom; the bottom edge is the dock's.

Spacing runs on an 8px base (`--space-*`), with a 10px internal rhythm on the cover and between tabs in an action row (a joint that keeps them separate objects). Starter strips auto-fit at minmax(136px, 1fr) with an 8px gap; Browse cards auto-fill at minmax(132px, 1fr). Touch targets are 44px minimum; tabs are 46–48px tall.

Breakpoints: 480px (action tabs stack full width), 640px (title card spans the viewport less 16px each side, the dock drops its number and rivet, menus go single-column), 1024px, 1280px (launch collapses to one column), 1440px. 390x844 portrait is a measured context.

## Elevation & Depth

Depth is physical: opaque black card throwing a real, neutral shadow onto the light behind it. No coloured halos, no tonal glow; the stage is the only thing in the room that emits light. Off the stage, panels use the softer shadow set and the light theme swaps in low-alpha ink shadows.

### Shadow Vocabulary
- **On-stage strip** (`box-shadow: 0 12px 28px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.45)`): every `.stims-stock` card placed on the stage.
- **Strong** (`0 18px 44px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)`): sheets and dialogs over the stage.
- **Panel** (`0 14px 34px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)`): side panels.
- **Soft** (`0 8px 22px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.35)`): popovers and small floating controls.

### Named Rules
**The Shadow Through the Hole Rule.** The rivet hole is a mask on the strip's `::before` fill, never on the element, so the element keeps an ordinary `box-shadow`, drawn outside its border box and never inside the hole. Do not shadow a strip with `filter: drop-shadow`: the dock's edge graph repaints every audio frame, and a filter over it is recomputed every frame, which starved a GPU-less browser's frames.

**The Opaque Card Rule.** Chrome is opaque card. Glass (`backdrop-filter`) is allowed only on a small control floating directly on the stage, and low and mid device tiers strip it.

## Shapes

Die-cut card. Strips, panels, cards and sheets turn their corners at 6px; buttons, tabs, fields and switches at 4px; thumbnails and small tags at 2px. Capsules (999px) are reserved for things that really are round. The full ladder is 1, 2, 3, 4, 6, 8, 10, 999px, and `scripts/check-css-scale.ts` rejects any other literal radius. Legend tabs round only their top corners (4px 4px 0 0), so they read as tabs cut from the sheet below.

The rivet hole is the recurring silhouette: a circle punched through the card's fill layer by a radial mask (6px radius on the cover and title card, 5px on the dock, 3.5px centred atop a starter strip), ringed by a 1px eyelet in the rule line so it still reads where the stage behind it is as dark as the card.

### Named Rules
**The One Line Weight Rule.** Every rule, outline, eyelet, divider and graph baseline is 1px. Emphasis comes from colour (rule line to rule line strong to amber), never from a heavier stroke. Focus outlines (2px) are the only exception.

## Components

### Buttons
Printed tabs, not pills: compact width, bold condensed labels, square-ish corners.
- **Shape:** gently die-cut (4px).
- **Primary (page tab):** print white strong fill, cover-stock ink; in the light theme, page ink fill with page-white ink. The brightest thing the chrome prints, so there is exactly one per view (the cover's Start, a dialog's confirm, the editor's Apply). Hover lifts 2px and goes to pure white.
- **Outline:** transparent with a 1px rule-line-strong border and strong ink (Browse, Edit beside Start; source buttons). Hover lifts 2px and the border goes to print white.
- **Ghost:** smaller (40px), rule-line border, muted label; hover fills with control fill.
- **Focus:** 2px amber outline, 3px offset; on the white tab the outline stands off the fill rather than touching it.
- **Disabled:** 50–55% opacity, no lift.

### Switches
- **Style:** 40x24 die-cut track (4px) with a 16px square thumb (3px), sunk fill and a 1px rule-line-strong border when off.
- **State:** on fills amber with on-amber thumb, slid 16px. The border keeps the fill's colour so forced-colors still draws it.

### Cards / Containers
- **Cover sheet:** cover stock, 6px corners, rivet at 20px/20px, padding 36px 32px 24px, holding nameplate, promise, transmission graph, tagline, action row and demo note. Pinned to on-stage tokens.
- **Starter strip:** rivet centred at the top, catalog number and look on the spec line, the preview as a die-cut window (92px, 2px corners), then name and maker. Hover pulls it up 6px; a play glyph fades in over the window.
- **Browse card:** the book opened flat, always dark stock in both themes; 1px rule-line border, 6px corners, full-bleed 4:3 art over a two-line caption. Hover pulls up 4px and strengthens the border; the playing preset gets an amber border plus a 1px inset amber ring.
- **Internal padding:** 8–12px on strips and cards, 18–36px on sheets.

### Inputs / Fields
- **Style:** control fill on stock, 1px rule-line border, 4px corners; on the stage they pin on-stage card and ink.
- **Focus:** amber outline.

### Navigation (Dock Strip)
One horizontal strip of cover stock riveted at its left end (rivet 15px in, 5px radius), padded 32px on the left to clear the eyelet. Controls inside are 36px outline or bare icon buttons in print white; the catalog number prints before the preset title. Along the top edge runs the edge graph: three 2px horizontal meters (bass, mid, treble) filling from the left, amber where the preset reads that band. Below 640px the number and rivet drop and the edge graph stays.

### Transmission Graph (signature)
Three live columns, bass, mid and treble, each a 1px-based block scaled on the compositor (scaleY, never a resized box) from the audio store, written to the element every frame without React state or CSS transitions. Columns the preset's equations actually read (preset-band-reads.ts, from the compile's dataflow) are lit amber; unread bands keep moving in rule-line-strong. Where there is room a "Driven by" legend heads the row, and the accessible name spells the reading out, so lit versus grey is never colour alone.

### Title Card (signature)
On every preset change a cover-stock card swings into place top left about its rivet: a 3 degree rotation from -3deg, 0.48s, exponential ease-out (cubic-bezier(0.16, 1, 0.3, 1)), and leaves the same way with an ease-in. Number at the top beside the rivet, headline name, byline in on-stage muted, a 20px transmission graph. Under reduced motion it fades with no swing.

### Code Well
The editor's well is stage floor in both themes, with a low-saturation token palette: keywords and headings in print white strong, atoms and built-ins in parchment (#d9c4a0), numbers and strings in sage (#b5c9a8), comments and gutter in spec grey. Caret is amber; selection is amber at 28%. Every token clears 4.5:1 on the well.

### Catalog Number
"No." in spec grey at 0.62em, then the digits in condensed bold tabular figures. A preset with no catalog entry prints no number.

## Do's and Don'ts

### Do:
- **Do** spend amber only on lit state: read bands, on/selected controls, focus, live dots.
- **Do** give each view exactly one white page tab (black in the light theme) for its primary action; everything else is an outline or ghost tab.
- **Do** pin on-stage fill, ink, accent and line tokens on anything that sits on the stage and uses `.stims-stock`.
- **Do** shadow punched strips with `box-shadow` on the element and keep the mask on its `::before`; never `filter: drop-shadow`.
- **Do** draw every rule, outline and eyelet at 1px.
- **Do** take radii from the ladder (6px strips, 4px controls, 2px windows); `bun run check:css-scale` enforces it.
- **Do** set every number in tabular figures and condense a long name with the width axis before wrapping it.
- **Do** move strips with a pull (translateY up 4–6px) and settle with an exponential ease-out; give every motion a reduced-motion fade or nothing.
- **Do** carry the lit/unlit meaning in words or accessible names as well as colour.

### Don't:
- **Don't** use amber for hints, warnings, decorative rules, badges or prose.
- **Don't** put two white page tabs in one view.
- **Don't** use a gradient of three or more hues anywhere in the chrome.
- **Don't** use glass (`backdrop-filter`) except on a small control floating directly on the stage.
- **Don't** use overshoot or spring easing (any cubic-bezier control value above 1 or below 0), and don't use View Transitions.
- **Don't** throw coloured glows or halos; shadows are neutral black.
- **Don't** let a light-theme surface sit on the stage; the stage is dark in every theme.
- **Don't** introduce a second display family or a radius, size or weight off the scale.
