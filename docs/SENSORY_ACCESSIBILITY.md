# Sensory accessibility & control research

This is the home for Stims' sensory-accessibility research program: the product claim it's grounded in, the open research questions, the literature backing them, the flash-safety specification, and the repo/product roadmap that follows from it. It complements two existing docs rather than replacing them:

- [`LITERATURE.md`](./LITERATURE.md) holds the citation list itself (grouped by theme, meant for UI-copy footnotes and general grounding). This doc holds the *argument* — what the citations are for, what's confirmed vs. still open, and what changes in the product as a result.
- [`ROADMAP.md`](./ROADMAP.md) / [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) track what's actually shipped. This doc is the research/rationale layer underneath specific roadmap entries in that area.

**No therapeutic claims.** Nothing here is evidence that Stims treats, manages, or improves any clinical condition. Every claim below is either "the published literature says X" (cited) or "this is an open question we could test" (marked as such). Product copy sourced from this doc must keep that distinction — see [Regulatory posture](#regulatory-posture) for why, and [`PUBLIC_DOCS_SITE_MAP.md`](./PUBLIC_DOCS_SITE_MAP.md#L15) for the planned public `guides/accessibility` page.

## The distinctive claim

The wide version of this claim — "Stims gives users control over source, initiation, intensity, transition, and termination" — mostly describes competent media-player design (see any video player) and isn't distinctive or research-novel on its own. The narrow version is the one worth defending:

> Stims exposes unusually fine control over the relationship between an audio stream and a continuously generated visual field.

Three specific properties do the real work, and are the actual scope of this doc:

1. **Transformation control.** The live preset editor (`src/js/milkdrop/overlay/editor-panel.ts`) changes the generating function itself while it's running — not just which preset plays, but the equations that produce it.
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

### Layer 0 — Safety (first sample run complete)

**First real result** (50-preset stratified-ish sample, `--beat-pulse`, `bun scripts/analyze-preset-flash.ts`, `scratch/flash-audit-sample50.json`): 34 of 50 presets actually completed measurement — 16 timed out, heavily clustered in the back half of the run, which reads as resource exhaustion in the audit tool over a long sequential session rather than anything about those specific presets. Of the 34 measured, **zero exceeded the WCAG flash threshold** (`peakFlashesPerSecond` median/p90/p99/max all 0). Motion energy and luminance volatility showed real but narrow spread (0 to ~0.009), nowhere near flash territory.

**What this does and doesn't establish**: it's real evidence against widespread flash risk in this corpus, not proof of corpus-wide safety — a third of the sample is unmeasured, and "the 16 that failed happened to cluster at the end" is consistent with a tool bug, not with those being unusually demanding presets, but that's an inference, not a verified cause. Don't cite this as "the corpus has been audited" — cite it as "the first sample found nothing, with a known reliability gap to close before that generalizes." The tool's timeout-clustering pattern (likely a memory/context leak across a long sequential Playwright session) is worth fixing — e.g., periodic browser restart every N presets — before running at larger scale.

**Is flash-rate/luminance-volatility risk present in this preset corpus, and at what prevalence?** Pure measurement, no human subjects, and the highest-priority item — a genuine safety gap (a corpus imported from the community without vetting) that gates everything else. Two tools exist right now, at different maturity:

- `scripts/preset-lab-flash-risk.ts` (`bun run lab:flash-risk -- --preset <id>`) — the earlier, single-preset lab tool. **Not a WCAG instrument, and cannot become one by retuning its threshold.** It reduces each frame to a single whole-frame mean luminance, and measurement on real presets showed ~14% of a 10-degree field brightening while ~13% darkens in the same frame — so that mean barely moves while a quarter of the field changes hard. A one-scalar-per-frame reducer also has no spatial extent, so the "25% of any 10 degree visual field" criterion cannot be evaluated from it at all, and its luminance is luma (REC709 on gamma-encoded bytes) rather than WCAG's linearized relative luminance. Useful for eyeballing one preset's *relative* flash activity, which is what its own header says it is.
- `scripts/flash-analysis.ts` + `scripts/analyze-preset-flash.ts` (`bun run lab:flash-audit`) — **the tool to use for any WCAG question**, corpus-scale that implements the *real* WCAG 2.3.1 general-flash definition directly: `FLASH_LUMINANCE_DELTA = 0.1`, `FLASH_DARKER_CEILING = 0.8`, `FLASHES_PER_SECOND_LIMIT = 3`, and a sliding-window area test at `VISUAL_FIELD_FRACTION = 1/3` — matching the [specification below](#flash-safety-specification) exactly, and unit-tested against synthetic timelines (`tests/unit/flash-analysis.test.ts`) independent of a live GPU. It already supports the stratified-sampling approach this doc recommends (`--count=N`, `--ids=a,b,c`, `--all`).

  **Validated by decomposition, and its zeros are explained.** Corpus runs report no flashes. Rather than accept that, each stage was measured separately on real rendered output (`rovastar-geiss-hyperspace-kaleidoscope`, `stahlregen-geiss-old-school-baby-flower-v2-1`, `martin-crystal-alley`, and two others), which rules out the failure modes a bare zero is compatible with:

  | Stage | Measured | Conclusion |
  | --- | --- | --- |
  | Capture (`renderFrames` → `readPixels`) | `maxPerPixelDelta = 1.0000` | Full-amplitude change *is* observed; capture is not blind. |
  | Darker-end ceiling (<0.80) | 15.59% → 15.29% of pixels | Filters ~nothing; not the blocker. |
  | Area reached, either direction | 26.8% / 29.7% of a 10° window | The 25% area floor *is* crossed. |
  | Area reached, per direction | 14.1% up / 13.6% down (same frame) | **This is why nothing fires.** |

  The corpus genuinely does not produce WCAG general-flash events under this stimulus, and the mechanism is specific: preset motion is *directionally incoherent* — roughly half a changing region brightens while the other half darkens in the same frame. WCAG's general flash threshold targets coherent field-wide oscillation (bright→dark→bright), which MilkDrop's texture-in-motion aesthetic does not produce, even when a quarter of the visual field is changing.

  **Two caveats before this is treated as a safety result.** The margin is moderate, not comfortable — 14–16% per direction against a 25% threshold — so a higher-energy stimulus could plausibly push a directional component over; every measurement above used the synthetic preview waveform with 2 Hz beat pulses, not real bass-heavy music. And only the general flash threshold is implemented; the **red flash** criterion (saturated-red transitions, a separate formula) is not, and red-dominant presets are therefore unmeasured. Re-run against real audio, and implement the red-flash test, before publishing a prevalence figure or shipping a safety claim.

The corpus-scale run itself (deciding what counts as "high risk" across the ~1,800-preset catalog, and wiring a threshold check into `tests/corpus/`) is still open — `tests/corpus/preset-flash-risk.test.ts` today is a regression test on the *tool* (one known preset, sanity-checking report shape), explicitly not a corpus-wide audit per its own docstring. Running `analyze-preset-flash.ts` at scale and promoting a result into a continuously-enforced corpus test is the concrete next step.

### Layer 1 — Characterize the machine (no human subjects)

The renderer's determinism makes this layer unusually cheap: `renderFrames({frames, deltaMs, beatPulse})` steps the VM at an exact, wall-clock-independent `dt` (`toy-runtime.ts`), and the existing capture path already reads raw RGBA pixels (`generate-thumbnails.ts`). Flash-risk measurement is one reducer over that stream; the following extend the same pattern:

- **Basic dynamic sensory properties per preset**: mean luminance, luminance variance, frame-to-frame luminance change, motion/change energy, spatial contrast — all extractable from frames already being read for flash-risk, at near-zero additional capture cost.
- **Audio→visual transfer characterization**. ✅ Built. `renderFrames` now accepts a `stimulus` option (`src/js/core/testing/synthetic-stimulus.ts`) that replaces the decorative idle wave with a controlled, known signal — flat, linear ramp, an isolated raised-cosine transient, or a ramp confined to one third of the spectrum (bass/mid/treble) — addressed by an explicit `frameOffset`/`totalFrames` pair so a harness can drive it one frame at a time (needed to read pixels back between frames) without the timeline collapsing to a single value. `scripts/audio-visual-transfer.ts` holds the pure analysis math (Pearson correlation, cross-correlation lag, decay persistence, response variance), unit-tested against synthetic ground-truth arrays independent of a live GPU — the same split as `flash-analysis.ts`/`analyze-preset-flash.ts`. `scripts/analyze-preset-audio-response.ts` is the Playwright harness: five trials per preset (full-spectrum ramp, isolated transient, held-constant flat, bass-only ramp, treble-only ramp), each against a freshly reloaded preset so one trial's feedback-accumulated state can't bleed into the next, producing five numbers per preset:
  - **responsiveness** — correlation between the ramp's known energy and the measured visual-response series;
  - **latency** — frames between the transient and the visual response peak (cross-correlation lag);
  - **persistence** — frames for the response to decay back toward its pre-transient baseline;
  - **autonomy** — variance in the response series under a *held-constant* stimulus, i.e. how much the preset moves on its own (feedback accumulation, internal timers) with nothing driving it;
  - **selectivity** — the difference in responsiveness between the bass-only and treble-only trials.

  This is a more rigorous, decomposed replacement for the vague "audiovisual coherence" framing below — see the [literature caveat](#audiovisual-coherence--a-caveat-not-yet-confirmed) on why "coupling strength" alone isn't well-supported as a single construct.

  **First real output** (`eos-glowsticks-v2-03-music`, run twice independently): responsiveness ≈ 0.42–0.43 (a real, moderate positive correlation — visual-change magnitude does track a ramping stimulus, it isn't noise), latency = 0 frames at r ≈ 0.65 (fast, no measurable lag at this frame rate), persistence ≈ 2 frames (decays almost immediately), autonomy ≈ 0.00002 (essentially none — this preset does not move on its own under a held-constant stimulus). Selectivity was the interesting one: **bass responsiveness was negative (−0.61) and treble responsiveness positive (+0.59)** in the detailed run — as bass energy ramps up, this preset's frame-to-frame visual change *decreases*, while ramping treble increases it. Same sign both runs, but the magnitude of the bass/treble gap varied a lot between them (−0.29 vs. −1.21) — a real methodological finding, not just a data point: a single 180-frame trial per condition is noisy enough that selectivity specifically needs averaging across repeated trials before it's a number worth trusting, even though responsiveness/latency/persistence/autonomy were consistent run to run.

  **Reliability gap, worse here than in the flash tool**: broader sample coverage is currently blocked by the same class of Playwright/browser resource exhaustion `analyze-preset-flash.ts` has, more acute here because this harness reloads each preset *five times* (once per trial) instead of once — two presets in a row hit a 90s `waitForFunction` timeout and a full browser crash in testing. Fix before running at any real scale: cache the five trials' worth of work behind fewer reloads (e.g. reuse one warm page per preset across all five stimulus conditions, resetting via a lighter in-page hook instead of a full preset reload), and/or recycle the browser context between presets the way `analyze-preset-flash.ts` already does every 20.

- **Relationship lock (the Layer 2 Q1 manipulation, machine-measurable).** ✅ Built. `renderFrames({ relationshipLock: true })` pins the preset-facing `time` and `frame` signals at their first-locked values (`src/js/milkdrop/runtime-signals.ts`) while the internal audio-analysis clock keeps running — so the audio→visual mapping (time/frame-driven terms) stays put while audio still drives output. The VM's env-sync cache is bypassed while locked (`MilkdropPresetVM.prepareSignalEnv` in `src/js/milkdrop/vm.ts`), because a naive pin would trip the frame/time cache key and freeze the audio signals too. Unit-tested (`tests/unit/relationship-lock.test.ts`). This is the "predictable relationship, novel output" condition — the thing Layer 2 Q1 will compare against the unlocked (drifting-mapping) condition. The measurement harness (`analyze-preset-audio-response.ts --lock`) already adds locked ramp and locked flat trials, reporting `responsivenessLocked` (does audio still drive when the clock stops) and `autonomyLocked` (how much residual motion is left when only the clock is suppressed). Not yet run at scale: the same reliability wall as the trials above applies to `--lock` (it doubles the per-preset reload count).

Neither of these needs consent design, recruitment, or telemetry — they're the same kind of work as the existing corpus/fidelity test suite (`tests/corpus/`), just measuring different properties.

### Layer 2 — Characterize human preference (needs participants)

Only pursue this once Layer 1 shows the underlying properties actually vary — no point studying preference over an axis that turns out to be flat across the corpus. In rough priority order, reflecting the literature calibration below (control/transformation questions are weighted above coupling-strength questions, because the one directly relevant experiment on the latter returned a null — see below):

1. **Does control increase tolerance for intensity?** Not "does control improve comfort" (weaker, already well-supported in general stress psychology) but whether giving users control changes the *maximum* intensity they'll voluntarily sustain — the direct test of the transformation-control thesis, and per the literature review, a genuinely untested combination (control-over-*sensory*-input specifically, in this population, has no direct prior study). The machine-level precondition — the relationship-lock manipulation and its measurement — is built (below).
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

1. **Flash-risk measurement on the corpus.** ✅ Real WCAG-threshold implementation exists and has a first result: 0/34 measured presets exceeded threshold in a 50-preset sample (16 timed out — see Layer 0 above). Next step: fix the tool's apparent resource-exhaustion pattern (periodic browser restart across a long run is the likely fix), then run at full corpus scale (`--all`) before treating "no risk found" as a corpus-wide claim.
2. **Extend the flash-risk reducer to the other Layer 1 features.** ✅ Largely already covered — `flash-analysis.ts`'s `FlashAnalysis` output already includes `motionEnergy`, `luminanceVolatility`, and `meanLuminance` alongside the flash count, from the same capture pass. Remaining gap: spatial contrast isn't in that output yet.
3. **A corpus test wired into `tests/corpus/`** that flags presets over the real WCAG/ITU-R thresholds, the same way existing corpus tests flag compatibility failures — continuous enforcement, not a one-time audit. Not yet built: today's `tests/corpus/preset-flash-risk.test.ts` is a regression test on the tool itself (one known preset), not a corpus-wide threshold check.
4. **Audio→visual transfer characterization** (responsiveness/latency/selectivity/persistence/autonomy, Layer 1). ✅ Built and produced a real result on one preset (see Layer 1 above) — the pure math is unit-tested, the stimulus-injection plumbing in `renderFrames` is typechecked and exercised end-to-end. Not yet run at any real sample size: the harness's per-preset reload cost (5x a normal preset load) hits the same resource-reliability wall as the flash-risk tool, sooner. Needed before question 7 in Layer 2 can be tested rigorously.
5. **Sensory filters in `BrowseSheetPanel`.** Deliberately not built yet — the first sample run found flash risk flat at zero and only narrow spread in motion/volatility (see Layer 0), which isn't yet enough signal to justify a filter UI. Revisit once a full, reliable corpus run either shows real clustering or confirms the axis stays flat at scale — a flat axis at scale is itself a valid, useful finding (it means this specific corpus doesn't need this filter), not a reason to build one anyway.
6. **A locked-vs-user-controlled experimental condition** — the relationship lock is built at the machine level (`renderFrames({ relationshipLock })`, harness `--lock`), but the *user-facing* condition (a control that locks the mapping during normal playback, plus the study that recruits participants to run the comparison) is still open. See Layer 1 above for the built piece.
7. **Opt-in, consent-gated research telemetry**, entirely separate from the existing `?agent=true` debug-snapshot machinery (that's dev tooling, not built for human-subjects data collection) — needs real privacy design before it exists at all, not a bolted-on analytics SDK.
8. **The public `/accessibility/` page.** ✅ Draft exists — [`docs/guides/accessibility.md`](./guides/accessibility.md): plain-language, no clinical framing, no efficacy claims, limited to the controls that are actually shipped (deliberately excludes the flash-rate cap in item 3 above until it exists).

On the product surface specifically: a visible flash-rate/seizure-safety indicator with a default-**on** "cap flash rate" toggle (opt-out, not opt-in, for a safety feature) should ship alongside step 3, not wait for the rest of the program.

## Consent and ethics

Restated because it's load-bearing, not a footnote: none of the Layer 2 (human-subjects) work is worth doing without real consent design — explicit opt-in copy, a way to withdraw, no framing that implies clinical benefit. A repo that ships telemetry and calls it "helping neurodivergent users" without IRB-quality consent UX is worse than not doing the work. The existing `?agent=true` debug/telemetry machinery is not that design and must not be reused as if it were.

Recruitment is a separate, upstream constraint worth stating plainly: `toil.fyi` traffic is currently modest, so an in-the-wild observational study risks landing at an underpowered n≈40 with none of the environmental control a lab study would have — not obviously better than the small lab studies this program's literature review is trying to move past. The better fit, given that constraint, is a small recruited sample with *dense within-subject* measurement (many controlled trials per participant) rather than treating "large website" as implying "large dataset."

## Regulatory posture

This section exists so nobody has to re-derive it before writing public copy or a new feature description. Not legal advice — the actual line is fact-specific and FDA doesn't publish a bright-line word list; get real regulatory counsel before shipping anything that leans on this. What follows is the research map, not a clearance opinion.

**The trigger is claims, not mechanism.** FDA's "intended use" doctrine (21 CFR 801.4) looks at "labeling claims, advertising matter, or oral or written statements" — the *totality* of what a product's responsible parties say about it — not what the software technically does. This cuts both ways: a careful disclaimer on one page doesn't control if other public copy (blog posts, this doc, social copy) implies a treatment outcome. Practically, that means **this doc itself is labeling-adjacent if it stays prominently linked from public surfaces** — framing research questions as "does X help autistic/ADHD users" (exploratory, honest) reads differently under §801.4 than "we're building this to treat X" would. Keep the framing exploratory, because it is.

**The safe harbor**: FDA's "General Wellness: Policy for Low Risk Devices" guidance exempts products that are (1) intended only for general wellness and (2) low risk. Qualifying claims: relaxation, stress management, sleep, mental acuity — generic healthy-lifestyle territory, no disease reference required. Importantly, **a specific condition can be named** without crossing into device territory, if the claim ties it to an established healthy behavior rather than a treatment outcome. FDA's own template: *"[Product]... tracks and records your sleep and exercise routines which, as part of a healthy lifestyle, may help living well with anxiety."* That pattern — name the condition, tie it to a general behavior (control, pacing, predictability), stop short of a treatment/symptom-reduction verb — is the one to reuse if public copy ever names autism or ADHD directly.

**The clearest contrast case**: Akili's EndeavorRx (a video game) needed FDA De Novo clearance as a Class II device specifically because it claimed a clinically-measured outcome (attention improvement via the TOVA test) tied to a named diagnosis (ADHD), backed by a 348-child RCT, framed as part of a treatment regimen. Akili's own sister product, EndeavorOTC — same underlying tech — stays unregulated by marketing itself purely as general attention/focus wellness training. Same mechanism, same company, same audience; the only difference is the label. That pair is the calibration reference: Stims can be as substantive as it wants about *what the controls do*, as long as it never claims a specific measured clinical outcome tied to a named diagnosis.

**Non-issues, confirmed by this research**: the flash-safety cap has no FDA device angle — it lives entirely in accessibility/content-safety standards territory (WCAG, broadcast standards), the same place `preset-lab-flash-risk.ts`/`flash-analysis.ts` already sit conceptually. EU MDR uses the same "intended purpose" trigger as FDA and exempts general-wellness/lifestyle software with no disease claim entirely — not even Class I, just out of scope. Neither needs separate handling from the FDA analysis above.

## Maintenance

Update this doc's status table and roadmap checkmarks as Layer 0/1 work actually lands — don't let it drift into an aspirational document disconnected from `IMPLEMENTATION_STATUS.md`. When a new literature search changes a "confirmed/gap" status above, update both this table and the corresponding section in `LITERATURE.md`.
