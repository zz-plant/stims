# Product moments

Stims work is judged by what a visitor sees in a particular moment. This file names those moments. For each it records the claim the moment proves, what counts as correct there, the instruments that measure it, and what production telemetry says about it. A task names the moment it serves, and its fix is verified in that moment's context.

Last reconciled with telemetry and the code on 2026-10-07. [`ROADMAP.md`](./ROADMAP.md) orders the work; this file says what each piece of it is for.

## Why this exists

The first-run preset has been replaced four times. Each pick passed a measurement that did not match what a visitor sees: curated sort order, a count of audio-reading variables, the opening seconds of playback, and a landscape-only capture. The last one rendered black on every phone held upright. The bug report blamed the WebGPU renderer, which turned out to be faithful to MilkDrop (#1376). In every case the instrument measured a context no visitor was in.

## Policies

These are settled. Apply them without asking; change them here, with a reason, when they stop fitting.

1. **The renderer follows MilkDrop's maths.** butterchurn's per-vertex loop is the reference for warp semantics, and native projectM captures are the reference for pixels (see the [parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md)). When a faithful preset looks wrong in some context, such as a preset written for 16:9 shown on a phone, the fix goes in curation and selection, not in the renderer's maths.
2. **A phone held upright is a measured context.** Anything a visitor sees first (the first-run preset, the attract preview, the landing) is measured at 390x844 as well as 1280x720.
3. **Both backends count.** Over the 30 days to 2026-10-07, renderer-tagged events split 640 WebGPU to 632 WebGL. Evidence for anything visitors see by default covers both backends.
4. **Audio reactivity is gated on dataflow, not pixels.** A preset answers the music when audio drives a variable the whole frame moves with (`lab:reactivity`, `lab:dataflow`). The pixel luminance delta between two separate runs mostly measures where a colour-cycling preset is in its cycle: identical runs of `shifter-curlique` read −21 and −0.7.
5. **Default surfaces do not flash.** The WCAG audit (`scripts/analyze-preset-flash.ts`) must read 0 flashes/s, and the live flash governor must leave the surface undimmed. The second half is not met today; see [Open questions](#open-questions).
6. **Telemetry counts visitors only.** Automated browsers do not post (#1377).

## The moments

### 1. First look

- **Context.** No deep link: the attract preview behind the landing, then Play demo, through the first 30 seconds. Phone or desktop.
- **Claim.** The landing's headline, "A music visualizer you can open up". Before anything can be opened, the stage has to be lit, moving and answering the music.
- **Correct.** What the visitor sees at 1280x720 and 390x844, on both backends, in silence (the attract preview) and after 30 s of demo audio.
- **Instruments.**
  - `src/data/first-run-preset-evidence.json`, gated by `tests/unit/bundled-first-run-preset.test.ts`.
  - `tests/e2e/first-run-portrait.test.ts` (local, WebGPU).
  - `scripts/analyze-preset-flash.ts` on the first-run preset.
- **Telemetry, 30 days.** 14 demo starts and 254 audible starts from any source. Both counts include our own automated runs from before #1377.
- **Gap.** With Reduce flashing on, the governor dims the first-run preset about half the time.

### 2. My music

- **Context.** A desktop visitor plays their own audio: tab or system audio, a file, or the microphone.
- **Claim.** "Reacting to whatever you play."
- **Correct.** Audio reaches the visualizer within two clicks of the first visit (the roadmap's [audio exit criterion](./ROADMAP.md#zero-friction-audio-routing-closing-the-capture-gap)), and the visuals respond to it.
- **Instruments.** Per preset, `lab:reactivity` and `lab:visual`. Nothing measures the path end to end, from choosing a source to the first frame that reacts to it.
- **Telemetry.** From #1377 on, every beacon records the live audio source, and `telemetry:report` breaks audible starts down by source and screen.

### 3. Open one up

- **Context.** From a running preset, the visitor opens the editor, sees which sounds drive each control, changes the code and watches the change run.
- **Claim.** The landing's distinctive promise: "Open one to see which sounds drive it, then change its code while it runs." It rests on the corpus being analysed as programs, the third contribution in [Lineage & Credits](./LINEAGE_AND_CREDITS.md#what-stims-contributes).
- **Correct.** The audio sources the editor shows for each control match the static dataflow (`src/js/milkdrop/preset-dataflow.ts`). For `shifter-curlique`, `lab:dataflow` reports zoom driven by bass, mid and treble with history. An edit shows on stage without losing the audio or the session.
- **Instruments.** `tests/e2e/open-one-up.test.ts` walks the moment end to end on WebGL, in CI. Unit tests cover the editor panel (`editor-panel-controls`, `editor-panel-inspect`, `editor-panel-knobs`, `editor-panel-compare-safety`). See [Measuring Open one up](#measuring-open-one-up).
- **Telemetry, 30 days.** 6 editor opens and no applied first edit, against 254 audible starts. The first-edit event counts one button, not edits; see [Open questions](#open-questions).
- **Gap.** The path works but is hard to find; see [What makes it hard to find](#what-makes-it-hard-to-find).

### 4. Perform

- **Context.** MIDI controllers, the cue monitor, hand-driven crossfades, a second display.
- **Claim.** Live performance; see the roadmap's [Live performance](./ROADMAP.md#live-performance-vjing--hardware-control) section.
- **Correct.** A control acts within a frame, a knob move does not recompile the preset (#1372), and a crossfade keeps both presets running through the fade.
- **Instruments.** `tests/e2e/preset-crossfade.test.ts` and `tests/unit/webmidi-controller.test.ts`.
- **Telemetry.** None specific to this moment.

### 5. Arrive by link or embed

- **Context.** A shared `?preset=` link or an iframe embed.
- **Claim.** Portable state: [roadmap principle 5](./ROADMAP.md#product-principles).
- **Correct.** The visitor lands on the sender's preset and settings, and an embedding page gets a `toil:status` reply to every message.
- **Instruments.** `tests/e2e/embed-bridge.test.ts` and `bun run ctl -- --embed`.
- **Telemetry, 30 days.** 613 embed landings and 35 discovery landings. All 613 embed landings came from one country between 09-09 and 09-16 and stopped: that is our own capture run, not an audience. #1377 keeps such runs out.
- **Search arrivals.** Most arrivals from search land here too, on one of the sitemap's `?preset=` pages, with no sender and the demo audio held until a tap. Every beacon now records the visit's `arrival` class (search, assistant, social, internal, other or none, from the referrer's host only), and each page load sends one `landing` event. The "Arrivals and how far they get" report in `telemetry:report` splits landings, audible starts and preset views by that class.

## Measuring Open one up

There are two parts.

- **The funnel.** Audible start, then editor opened, then first edit applied, then shared or saved, by device: the "Open one up funnel" report in `bun run telemetry:report` (#1377). No target until a month of clean data exists.
- **The end-to-end check.** `tests/e2e/open-one-up.test.ts`, in CI's integration matrix on WebGL.
  1. From the first-run state, with no deep link, it plays the demo, moves the pointer over the stage to bring the dock back, and opens the editor with the dock's Edit button.
  2. It reads the chip on every Tune control: whether the draft or the equations own the value, and the full list of sounds from the chip's accessible name.
  3. It derives the same readings without the editor, from `analyzePresetDataflow` on the preset file and the control definitions in `preset-controls.ts`, and requires them to match. Zoom is pinned to bass, mid and treble, as `lab:dataflow` reports.
  4. It types one line at the end of the code: a red border half the screen deep, with `decay = 0`. The preset cannot produce that frame on its own, and neither can a black or washed-out stage.
  5. The stage must show it within 150 engine frames. It took 33 on a laptop GPU and 2 on SwiftShader, whose frames are slow enough to cover the same debounce and compile. Afterwards the preset, the demo audio and the open editor must be unchanged, and the audio level must keep moving.

  Making the chips skip per-pixel outputs fails step 3 (Shift X and Shift Y lose their sounds). Disconnecting the editor from the engine fails step 5, and so does freezing the audio level the runtime reports.

### What makes it hard to find

Measured on 2026-10-07 against the dev server on WebGL, walking the same path. These are candidate explanations for the funnel, not measured causes of it.

- **The landing promises the editor and offers no way in.** The promise sits above Play demo and Browse presets, and no control on the landing opens the editor. The `E` shortcut does, and the page does not mention it.
- **Edit hides while the visitor watches.** After a few seconds without pointer movement the dock folds into a "Controls" pill and Edit leaves the accessibility tree. The hint shown then names → and ?, not E.
- **On a phone the editor covers the stage.** Below 480 px wide, Edit moves into ≡ More actions. At 390x844 the editor sheet then covers all but the top 70 px of the stage, so the change cannot be watched while it runs.
- **The code barely shows.** The editor stacks the "Try one edit" guide, a toolbar, the Problems strip and a fixed-height Tune dock around the code, and the code gets what is left: 0 px at 1366x657 (roughly what a 1366x768 screen leaves after browser chrome), 13 px at 1280x720, 4 lines at 1440x789, 12 lines at 1920x960, and part of one line at 390x844.
- **The sounds sit below the fold.** Tune opens on a paragraph and a wave-or-shape picker, so at 1280x720 its first control starts at the bottom edge of the window. A chip reads `eq · bass +2`; mid and treble appear only in its tooltip and accessible name.

## Open questions

- **The governor and the audit disagree on `shifter-curlique`.** The WCAG audit reads 0 flashes/s over 30 s with beat transients. With Reduce flashing on, the live governor dims the stage to a mean brightness of about 0.5, for 65% of samples, in silence as well as with demo audio, and it did the same before #1375. On `geiss-casino` and `eos-glowsticks-v2-03-music` it does not dim at all. Reduce flashing already defaults on for visitors whose OS asks for reduced motion, so they see the first-run preset dimmed. One of the two instruments is wrong, and which one decides roadmap item 1.
- **The funnel's first-edit step counts one button.** `growth-first-edit-applied` is sent only by "Add a slow spin" in the editor's "Try one edit" guide (`src/js/frontend/FirstEditGuide.tsx`). Typing in the code or moving a Tune control sends nothing, so the 0 in 30 days says no one clicked that button. Counting every applied edit would change the event's meaning partway through the first clean month after #1377.
- **No page says what telemetry records.** Nothing user-facing describes the beacons, before or after #1377.
- **WebGL's warp centre ignores the aspect.** The CPU mesh places cx/cy without MilkDrop's aspect squeeze, so the backends disagree on presets that write them per pixel. Making WebGL faithful also makes some landscape-only presets dark on phones, which policy 1 accepts.

## Decision log

| Date | Decision | Where |
| --- | --- | --- |
| 2026-10-06 | The renderer stays faithful to MilkDrop. Phones are handled by choosing a first-run preset that works there. | #1376 |
| 2026-10-06 | First-run audio reactivity is gated on dataflow; pixel deltas are recorded but not enforced. | #1376 |
| 2026-10-07 | Beacons carry orientation, device class and audio source. Automated browsers do not post. | #1377 |
| 2026-10-07 | Nothing plays a preset on arrival except attract mode. `/discover/` and `/author/` pages keep Browse open on their collection, `/` keeps its URL, and low-power or reduced-motion visitors get the static landing the attract gate always promised. | #1380 |
| 2026-10-07 | Beacons carry an arrival class taken from the referrer's host, never the URL or the host itself, and each page load sends one `landing` event. | #1381 |
| 2026-10-07 | The editor's per-control sounds are gated on static dataflow end to end, in CI on WebGL. | `tests/e2e/open-one-up.test.ts` |

## Working with this file

- A brief names its moment and its reference, and labels a guess about the cause as a guess.
- Before building, run the cheapest test that could prove that guess wrong. On 2026-10-06, loading with and without `?preset=` and reading back the render targets would have pointed away from the renderer within minutes.
- A change that moves a moment's premise, such as a default preset or a default setting, updates this file and names what depended on it.
