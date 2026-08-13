# Sensory accessibility & control research

This is the home for Stims' sensory-accessibility research program: the product claim it's grounded in, the open research questions, the literature backing them, the flash-safety specification, and the repo/product roadmap that follows from it. It complements two existing docs rather than replacing them:

- [`LITERATURE.md`](./LITERATURE.md) holds the citation list itself (grouped by theme, meant for UI-copy footnotes and general grounding). This doc holds the *argument* — what the citations are for, what's confirmed vs. still open, and what changes in the product as a result.
- [`ROADMAP.md`](./ROADMAP.md) / [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) track what's actually shipped. This doc is the research/rationale layer underneath specific roadmap entries in that area.

**No therapeutic claims.** Nothing here is evidence that Stims treats, manages, or improves any clinical condition. Every claim below is either "the published literature says X" (cited) or "this is an open question we could test" (marked as such). Product copy sourced from this doc must keep that distinction — see [`PUBLIC_DOCS_SITE_MAP.md`](./PUBLIC_DOCS_SITE_MAP.md#L15) for the planned public `guides/accessibility` page and its wording constraints.

## The distinctive claim

The wide version of this claim — "Stims gives users control over source, initiation, intensity, transition, and termination" — mostly describes competent media-player design (see any video player) and isn't distinctive or research-novel on its own. The narrow version is the one worth defending:

> Stims exposes unusually fine control over the relationship between an audio stream and a continuously generated visual field.

Three specific properties do the real work, and are the actual scope of this doc:

1. **Transformation control.** The live preset editor (`src/js/milkdrop/overlay/editor-panel.ts`) changes the generating function itself while it's running — not just which preset plays, but the equations that produce it. This is categorically different from volume or preset selection.
2. **Audiovisual contingency.** Visual parameters are driven by measured audio features (frequency bands, transients, beat detection — `src/js/core/audio-handler.ts`, `frequency-analyser-processor.ts`), not merely co-occurring with sound.
3. **Transition control.** Cut/Blend mode plus blend duration (0.5–8s) manipulate *discontinuity* independent of the underlying preset's intensity — a dial the literature review below doesn't have an established analogue for.

## What Stims already has

Confirmed in the current codebase, not aspirational:

- Explicit source and preset selection; nothing autoplays without a user action.
- Quality/performance settings and a motion-reduction path (`prefersReducedMotion` is respected — see `src/js/core/accessibility-preferences.ts`).
- Cut/Blend transition mode with an adjustable duration.
- Immediate stop (`handleAudioStop`).
- Session-state persistence (`src/js/core/state/last-session-store.ts`) so a preferred setup is easy to return to.
- The live editor (see above) — the most distinctive piece.
- A virtual-MIDI-device control surface (`src/js/core/services/webmidi-controller.ts`, `scripts/mcp-server.ts`'s `session_midi_set`/`session_midi_cc`) that lets an agent or a physical controller drive any field in real time — useful as *instrumentation* for the research questions below, not just a performance feature.

## Research program

Organized in two layers, per the sequencing argument below: characterize the corpus and the renderer first (no human subjects, cheap, immediately actionable), then characterize human preference over those now-measurable properties.

### Layer 0 — Safety (in progress, two tools mid-flight)

**Is flash-rate/luminance-volatility risk present in this preset corpus, and at what prevalence?** Pure measurement, no human subjects, and the highest-priority item — a genuine safety gap (a corpus imported from the community without vetting) that gates everything else. Two tools exist right now, at different maturity:

- `scripts/preset-lab-flash-risk.ts` (`bun run lab:flash-risk -- --preset <id>`) — the earlier, single-preset lab tool. Its own file header is explicit that its threshold (a 30/255 frame-to-frame luminance delta) is a placeholder, not sourced from a named standard.
- `scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts` (`bun scripts/analyze-preset-flash.ts`, no package.json alias yet) — a newer, corpus-scale tool that implements the *real* WCAG 2.3.1 general-flash definition directly: `FLASH_LUMINANCE_DELTA = 0.1`, `FLASH_DARKER_CEILING = 0.8`, `FLASHES_PER_SECOND_LIMIT = 3`, and a sliding-window area test at `VISUAL_FIELD_FRACTION = 1/3` — matching the [specification below](#flash-safety-specification) exactly, and unit-tested against synthetic timelines (`tests/unit/flash-analysis.test.ts`) independent of a live GPU. It already supports the stratified-sampling approach this doc recommends (`--count=N`, `--ids=a,b,c`, `--all`).

The corpus-scale run itself (deciding what counts as "high risk" across the ~1,800-preset catalog, and wiring a threshold check into `tests/corpus/`) is still open — `tests/corpus/preset-flash-risk.test.ts` today is a regression test on the *tool* (one known preset, sanity-checking report shape), explicitly not a corpus-wide audit per its own docstring. Running `analyze-preset-flash.ts` at scale and promoting a result into a continuously-enforced corpus test is the concrete next step.

### Layer 1 — Characterize the machine (no human subjects)

The renderer's determinism makes this layer unusually cheap: `renderFrames({frames, deltaMs, beatPulse})` steps the VM at an exact, wall-clock-independent `dt` (`toy-runtime.ts`), and the existing capture path already reads raw RGBA pixels (`generate-thumbnails.ts`). Flash-risk measurement is one reducer over that stream; the following extend the same pattern:

- **Basic dynamic sensory properties per preset**: mean luminance, luminance variance, frame-to-frame luminance change, motion/change energy, spatial contrast — all extractable from frames already being read for flash-risk, at near-zero additional capture cost.
- **Audio→visual transfer characterization**: drive each preset with controlled synthetic audio perturbations (no beat → regular pulse, amplitude ramps, isolated transients, frequency sweeps) and measure *responsiveness* (magnitude of visual change per audio change), *latency* (time from audio event to visual peak), *selectivity* (does bass vs. treble stimulation produce different responses), *persistence* (how long a response continues after the audio event ends), and *autonomy* (how much the visual evolves with audio held constant). This is a more rigorous, decomposed replacement for the vague "audiovisual coherence" framing below — see the [literature caveat](#audiovisual-coherence--a-caveat-not-yet-confirmed) on why "coupling strength" alone isn't well-supported as a single construct.

Neither of these needs consent design, recruitment, or telemetry — they're the same kind of work as the existing corpus/fidelity test suite (`tests/corpus/`), just measuring different properties.

### Layer 2 — Characterize human preference (needs participants)

Only pursue this once Layer 1 shows the underlying properties actually vary — no point studying preference over an axis that turns out to be flat across the corpus. In rough priority order, reflecting the literature calibration below (control/transformation questions are weighted above coupling-strength questions, because the one directly relevant experiment on the latter returned a null — see below):

1. **Does control increase tolerance for intensity?** Not "does control improve comfort" (weaker, already well-supported in general stress psychology) but whether giving users control changes the *maximum* intensity they'll voluntarily sustain — the direct test of the transformation-control thesis, and per the literature review, a genuinely untested combination (control-over-*sensory*-input specifically, in this population, has no direct prior study).
2. **What predicts abrupt disengagement?** Model the moments people stop, switch, or reduce intensity — against flash bursts, motion discontinuities, hard cuts, or accumulated exposure — using the Layer 1 features as predictors.
3. **Is overstimulation better predicted by volatility than by mean intensity?** A preset can be bright-but-stable or moderate-but-erratic; test which predicts disengagement.
4. **Does transition predictability (Cut vs. Blend, and blend duration) affect comfort or behavioral proxies?** The existing setting is already the manipulation needed.
5. **Is immediate reversibility itself regulating?** Vary how easily a change can be undone, holding the sensory content constant.
6. **Does self-tuning (live-editor use) correlate with engagement, and who uses it?** Usage-telemetry question — does editing zoom/warp/decay mid-session predict longer sessions, gated on opt-in only (see [Consent](#consent-and-ethics)).
7. **Does audiovisual coupling strength (from the Layer 1 transfer characterization) independently predict preference, beyond raw intensity?** Kept on the list because it's the central open question the literature explicitly hasn't isolated — but see the caveat immediately below before weighting it highly.

#### Audiovisual coherence — a caveat, not yet confirmed

This was the most-discussed hypothesis in earlier framing and it needs a correction: the two most directly relevant controlled experiments found so far both returned **null results** for "tighter coupling → more preference/engagement":

- Fink, Fiehn & Wald-Fuhrmann (2024, *Scientific Reports*, n=201) — matched vs. randomly-paired audiovisual art was rated more *congruent* but not more *liked*; participants spent more time with audio-only stimuli.
- Krzyzaniak, Erdem & Glette (2022, *Frontiers in Computer Science*) — manipulating interactive-art response *timescale* had no effect on engagement duration; controllable parameters and ascribed agency did.

Neither is a perfect match (static art pairing; general interactive art, not a music visualizer), but they're the closest controlled precedent, and both point toward *control* mattering more than *coupling tightness*. Treat question 7 as a real gap worth testing, not a hypothesis with existing support — a null result there would be consistent with, not contrary to, the literature.

## Literature grounding

Full citations live in [`LITERATURE.md`](./LITERATURE.md). Status summary, since "cited" isn't the same as "verified" or "confirmed":

| Claim | Status | Key source(s) |
| --- | --- | --- |
| Self-controlled vs. passive/automatic sensory-environment change reduces repetitive/stereotyped behavior in autistic children | **Confirmed**, N=41 RCT-style design | Unwin, Powell & Jones (2021/2022, *Autism*) — note: the actual comparison is self-control vs. *automatic cycling*, not "child vs. adult controlled" as sometimes paraphrased |
| Autistic adults describe sensory experience as individualized, context-dependent, organized around predictability and control | **Confirmed**, two independent qualitative studies | MacLennan et al. (2023, *Autism in Adulthood*, N=24); MacLennan, O'Brien & Tavassoli (2021, *JADD*, N=49) |
| Fixed trait model of sensory seeking/avoiding (Dunn's 2×2) is incomplete; preference varies by context | **Emerging, not settled** (~3 years of evidence, EMA-methodology-driven) | Metz et al. (2019, *Brain Sciences*); Williams et al. (2023, *Molecular Autism*, N=3,868) |
| Perceived control reduces distress/increases tolerance for aversive stimulation, even with merely *believed* (nonveridical) control | **Well-established**, general psychology, not sensory- or autism-specific | Glass & Singer (1972); Geer, Davison & Gatchel (1970); Mineka & Kihlstrom (1978) on separating predictability from control |
| Control specifically over *sensory* input increases tolerance, in neurodivergent populations specifically | **Not directly tested anywhere found** — a real, nameable gap between two established literatures | — |
| Tighter audiovisual coupling increases preference/engagement, independent of raw intensity | **Not supported by the closest available evidence** (see caveat above) | Fink et al. (2024); Krzyzaniak et al. (2022) |
| Existing flash-hazard risk methods are unreliable for interactive/generative content specifically | **Confirmed**, directly on-point | South & Borkin (2023, *IEEE TVCG*) — tested 1,132 interactive visualizations |
| Audio-reactive/generative music visualizers and seizure risk | **No literature found** — this appears to be a genuine, unaddressed gap, not a search failure | — |

## Flash-safety specification

For calibrating `scripts/preset-lab-flash-risk.ts`'s placeholder threshold against real, named standards. Primary sources, read directly (not secondhand):

**WCAG 2.3.1 (Three Flashes or Below Threshold, Level A).** Pass if no more than 3 general flashes and no more than 3 red flashes occur within any one-second period, OR the flashing area is small enough to be exempt.
- **General flash**: a pair of opposing relative-luminance transitions where each transition is ≥10% of maximum relative luminance, and the darker of the two frames has relative luminance <0.80 (0–1 scale).
- **Red flash**: a transition where R/(R+G+B) ≥ 0.8 and the change in (R−G−B)×320 is >20, for both the up- and down-transition.
- **Relative luminance**: L = 0.2126R + 0.7152G + 0.0722B on linearized (gamma-corrected) sRGB values. (Note: the WCAG spec text has a known typo in its sRGB piecewise breakpoint — 0.03928 where the mathematically correct value is 0.04045 — a documented spec bug, not a disagreement between sources.)
- **Area exemption**: flashing content is exempt if the combined flashing area is ≤0.006 steradians within any 10° of visual field — operationalized as a 341×256px rectangle at 1024×768, viewed at 22–26 inches.
- **2.3.2 (AAA)** removes the area exemption entirely: 3 flashes/second, full stop, any area.

**ITU-R BT.1702-3 (2023)**, the broadcast-originated standard behind the above, in absolute photometric terms: a flash is a pair of opposing luminance transitions; threshold is a **20 cd/m² difference** when the darker frame is <160 cd/m², or Michelson contrast >1/17 above that (HDR only). Any transition to/from saturated red counts regardless of luminance. Disallowed only when *both* combined flash area >25% of screen *and* more than 3 flashes (6 transitions) occur within any 1-second window — leading edges must be ≥360ms apart (50Hz) or ≥334ms apart (60Hz). Traces to Harding & Jeavons, *Photosensitive Epilepsy* (MacKeith Press, 1994) and Harding & Harding (2010, *Applied Ergonomics*).

**Implementation note**: use the WCAG relative-luminance formula above, not the luminance weighting in third-party reimplementations found during this research (e.g. the arXiv "Flikcer" tool) — several use display-specific curve fits that shouldn't be assumed portable. `scripts/flash-analysis.ts` already implements the real two-part general-flash test this way — `relativeLuminance()` uses the correct linearized-sRGB/REC 709 weights, `isFlashTransition()` checks both the 10%-delta condition and the <0.80 darker-frame condition, and area is handled via a sliding 1/3-visual-field-width tile window rather than a whole-frame average. The still-placeholder tool is `preset-lab-flash-risk.ts` (single delta-magnitude number, no darker-frame or area condition) — prefer `flash-analysis.ts`'s definitions for anything citing WCAG compliance. Neither tool yet implements the WCAG red-flash test (the R/(R+G+B) and (R−G−B)×320 condition) — that's the remaining gap.

No published literature was found on generative/procedural or audio-reactive visual content and seizure risk specifically (see table above) — South & Borkin (2023) is the closest, and it's about interactive data visualizations generally, not this content type. Treat this repo's eventual flash-risk work as addressing a real, undocumented gap, not applying an established method to new content.

## Roadmap

Cheapest to most involved. Items already built are marked.

1. **Flash-risk measurement on the corpus.** ✅ Real WCAG-threshold implementation exists (`scripts/flash-analysis.ts`, unit-tested) plus a corpus-scale runner with sampling built in (`scripts/analyze-preset-flash.ts --count=N` / `--ids=` / `--all`). Next step: actually run it at corpus scale and look at the resulting distribution — the tool exists, the audit itself doesn't have a result yet.
2. **Extend the flash-risk reducer to the other Layer 1 features.** ✅ Largely already covered — `flash-analysis.ts`'s `FlashAnalysis` output already includes `motionEnergy`, `luminanceVolatility`, and `meanLuminance` alongside the flash count, from the same capture pass. Remaining gap: spatial contrast isn't in that output yet.
3. **A corpus test wired into `tests/corpus/`** that flags presets over the real WCAG/ITU-R thresholds, the same way existing corpus tests flag compatibility failures — continuous enforcement, not a one-time audit. Not yet built: today's `tests/corpus/preset-flash-risk.test.ts` is a regression test on the tool itself (one known preset), not a corpus-wide threshold check.
4. **Audio→visual transfer characterization** (responsiveness/latency/selectivity/persistence/autonomy, Layer 1) — the biggest new subsystem in this list, needed before question 7 in Layer 2 can be tested rigorously.
5. **Sensory filters in `BrowseSheetPanel`**, extending the existing collection/author filter UI with the new metadata — only once step 1–2 show the metadata is meaningful (not flat across the corpus).
6. **A locked-vs-user-controlled experimental condition** — genuinely new subsystem, needed specifically for Layer 2 question 1.
7. **Opt-in, consent-gated research telemetry**, entirely separate from the existing `?agent=true` debug-snapshot machinery (that's dev tooling, not built for human-subjects data collection) — needs real privacy design before it exists at all, not a bolted-on analytics SDK.
8. **The public `/accessibility/` page** (already slotted as `guides/accessibility` in `PUBLIC_DOCS_SITE_MAP.md`) — plain-language, sourced from this doc, no clinical framing, no efficacy claims.

On the product surface specifically: a visible flash-rate/seizure-safety indicator with a default-**on** "cap flash rate" toggle (opt-out, not opt-in, for a safety feature) should ship alongside step 3, not wait for the rest of the program.

## Consent and ethics

Restated because it's load-bearing, not a footnote: none of the Layer 2 (human-subjects) work is worth doing without real consent design — explicit opt-in copy, a way to withdraw, no framing that implies clinical benefit. A repo that ships telemetry and calls it "helping neurodivergent users" without IRB-quality consent UX is worse than not doing the work. The existing `?agent=true` debug/telemetry machinery is not that design and must not be reused as if it were.

Recruitment is a separate, upstream constraint worth stating plainly: `toil.fyi` traffic is currently modest, so an in-the-wild observational study risks landing at an underpowered n≈40 with none of the environmental control a lab study would have — not obviously better than the small lab studies this program's literature review is trying to move past. The better fit, given that constraint, is a small recruited sample with *dense within-subject* measurement (many controlled trials per participant) rather than treating "large website" as implying "large dataset."

## Maintenance

Update this doc's status table and roadmap checkmarks as Layer 0/1 work actually lands — don't let it drift into an aspirational document disconnected from `IMPLEMENTATION_STATUS.md`. When a new literature search changes a "confirmed/gap" status above, update both this table and the corresponding section in `LITERATURE.md`.
