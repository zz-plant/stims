# Product

<!-- impeccable:product-schema 1 -->

The product record design work starts from: who Stims is for, what it claims, and what must not be invented. What each visitor moment proves, and how it is measured, lives in [docs/PRODUCT_MOMENTS.md](docs/PRODUCT_MOMENTS.md); priorities live in [docs/ROADMAP.md](docs/ROADMAP.md). Confirmed with the maintainer on 2026-10-27.

## Platform

web

## Users

In order of priority, confirmed 2026-10-27:
1. **Listeners.** People who put music on and want something to watch with it, or to regulate with. Stimmers are named in the README as much as MilkDrop fans, and roadmap principle 6 says listening and sensory regulation are why people open Stims. They arrive on a phone or a desktop, often from a link or a search, and may never open a menu.
2. **Editors.** MilkDrop fans and preset authors who open a running preset, see which sounds drive it, change its code and watch the change run.
3. **Performers.** VJs and live sets: MIDI controllers, the cue monitor, hand-driven crossfades and a projector window on a second display.

## Product Purpose

Stims plays the original MilkDrop `.milk` presets in a browser, against any audio, and lets a visitor change their equations while they run. Success for the listener is a lit, moving stage that answers the music within the first visit, with control over how much happens on screen. Success for the editor is an edit that shows on stage without losing the music or the session, and a link that carries it.

## Positioning

"A music visualizer you can open up." The editor reads each preset's equations to show which sounds drive each control (`eq · bass, mid, treb`), and runs an edit while the preset plays, with sensory control built in. Butterchurn and projectM have no editor; MilkDrop 2 had one, so product copy says Stims "brings back" editing rather than introducing it. Technical surfaces (README, `llms.txt`, launch posts) carry the three contributions in [What Stims contributes](docs/LINEAGE_AND_CREDITS.md#what-stims-contributes), in that order; product copy says what Stims does and makes no novelty claim.

## Operating Context

- **Where it runs.** At toil.fyi, in any WebGL2 browser, with no account and no install. Both renderers carry real traffic, WebGL and WebGPU ([current split](docs/ARCHITECTURE.md#rendering-backends)).
- **How visitors arrive.** The landing with its attract preview; a shared `?preset=` link; a search result that lands on a preset page; an iframe embed that talks over `toil:` messages.
- **Audio.** A browser tab, a YouTube link, the microphone, a local file, or the built-in demo loop. Browsers hold sound until the first click, tap or key press.
- **The session is the link.** The address bar carries the preset, its edited source and remix lineage; settings and the last session persist on the device.
- **Live use.** Fullscreen and projector windows on a second display, MIDI hardware, stream capture through OBS.

## Capabilities and Constraints

- **Catalog.** The original `.milk` files by their authors, curated picks first, played without conversion and exported as `.milk`. Counts drift; the catalog manifest is the source.
- **Editor.** Completions, compiler diagnostics, Tune sliders for `zoom`, `warp`, `rot`, `decay` and the rest, with the driving audio named beside each slider an equation drives.
- **Sensory control.** Stage brightness cap, motion scaling, freeze, Reduce flashing (on unless the visitor saved an opt-out), a live flash governor, cut or blend transitions, one action that stops everything ([accessibility guide](docs/guides/accessibility.md)).
- **Performance.** WebMIDI learn, cue monitor crossfades, projector window.
- **Settled measurement policies.** [docs/PRODUCT_MOMENTS.md](docs/PRODUCT_MOMENTS.md#policies) settles six: the renderer follows MilkDrop's maths; a phone held upright (390x844) is a measured context; both backends count; audio reactivity is gated on dataflow; default surfaces do not flash; telemetry counts visitors only.
- **Undecided.** Whether "no account, no install", "calm by default", the measured contexts and any visual restriction bind all future work as product rules was put to the maintainer on 2026-10-27 and left open. They describe the product as shipped; changing one is a product decision to raise, not a default to assume.

## Brand Commitments

- **Name and home.** Stims, at toil.fyi. stims.app is an unrelated site.
- **Credit.** The presets are their authors' work; the dock and Browse show each preset with its authors. [Lineage and credits](docs/LINEAGE_AND_CREDITS.md) records what Stims owes Butterchurn, projectM and MilkDrop.
- **Voice.** Plain statements of what a control does and what was measured. Claims stay inside the evidence: a preset "without the Flashing label may simply be unmeasured", and parity is reported per preset, failures included.

## Evidence on Hand

- **Clips.** Silent animated previews of the workflow and of single presets under [docs/assets/clips/](docs/assets/clips/), behind a WCAG flash gate.
- **Fidelity.** Per-preset parity results against native projectM, failures included ([scoreboard](docs/MILKDROP_PROJECTM_PARITY_PLAN.md#current-scoreboard)), and a CI test that compiles the bundled Butterchurn pack on both backends.
- **Telemetry.** Anonymous events in Cloudflare Analytics Engine, read with `bun run telemetry:report`; the funnel from audible start to first edit is in [Measuring Open one up](docs/PRODUCT_MOMENTS.md#measuring-open-one-up). Editor opens are rare so far and no clean month of first-edit data exists yet.
- **Absent, not to be invented.** No testimonials, user quotes, customer logos, press, user counts or pricing. Most presets have not been measured for flashing, so no surface may imply the catalog is flash-safe.

## Product Principles

1. **The stage comes first.** A listener sees a lit, moving stage that answers the music before anything asks them to choose, read or sign in; every other surface keeps the stage in view or gives it back in one action.
2. **The code stays open.** Presets remain `.milk` source a visitor can read, edit, export and send; nothing hides the program behind a converted format or a closed preset.
3. **Control over intensity is part of the product.** Brightness, motion, flashing and stopping are reachable from where the visitor is, not buried in setup.
4. **Measured before claimed.** Fidelity, flashing and reactivity are stated only as far as a named instrument has measured them, in the context a visitor is actually in.
5. **One session.** Discovery, playback, editing and sharing are one running session, and the link carries it.

## Accessibility & Inclusion

- Photosensitivity: WCAG 2.3.1 is the flash reference; the audit reads at 60 fps and at the 30 fps power-saving cap, and the governor applies the same rule live.
- Reduced motion: the system setting starts Motion at 40% and the landing still; a saved setting overrides it.
- Sensory regulation: autistic and ADHD visitors are among the people the sensory controls serve, without claims about outcomes ([who this is for](docs/guides/accessibility.md#who-this-is-for)).
- Keyboard: the main actions have shortcuts and a command palette ([keyboard shortcuts](docs/USER_GUIDE.md#keyboard-shortcuts)).
- Phones: anything a visitor sees first is measured at 390x844 upright as well as 1280x720.
