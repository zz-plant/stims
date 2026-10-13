# MilkDrop projectM parity plan

> Evidence status: the inventories are `src/data/milkdrop-parity/certification-corpus.json` (targets), `visual-reference-manifest.json` (references), `measured-results.json` (promoted results) and `parity-noise-bands.json` (run-to-run spread). Scoreboards below keep their dates and inputs. Counts of targets or references are not counts of passing presets.

Stims does not claim broad projectM parity. The work is a repeatable visual oracle, compatibility labels that follow it, and rendering fixes ordered by impact. The first requirement comes before any of that: Stims compiles and runs `.milk` presets from the projectM ecosystem in the browser. Native projectM captures are proof inputs, not a runtime dependency.

The milestone backlog this plan absorbed on 2026-10-13 is [archived](./archive/MILKDROP_PROJECTM_PARITY_BACKLOG.md) with its file targets and acceptance criteria. Priorities across the project live in the [roadmap](./ROADMAP.md).

## Scope

- **WebGPU is the judged backend.** Every certified reference sets `requiredBackend: "webgpu"`, and a capture that fell back to WebGL counts as a failure. WebGL has no parity coverage: the 35 manifest entries with `renderer: "stims"` are placeholders whose image files do not exist. WebGL output is therefore not a comparator for WebGPU. See [Rendering backends](./ARCHITECTURE.md#rendering-backends).
- **Certification is proof of method on a bounded sample.** The 71-preset corpus in `certification-corpus.json` is chosen by stratum: representatives per known divergence class (feedback, shader text, samplers, rasterization, motion) plus every shipped bundled preset. Each certified preset stands in for a class. The standing claim outside the corpus is "compiles and runs"; unmeasured presets stay labelled `runtime` or `partial`, and the corpus grows only to cover a new divergence stratum, never to chase the 1,787-entry catalog.
- **The proof loop is the certified reference set.** 13 presets carry a native projectM image under `tests/fixtures/milkdrop/projectm-reference/`, rendered by projectM 3.1.12 against per-preset audio (`silence`, or the tone signal in `src/js/core/testing/reference-audio.ts` that the C++ harness mirrors through a generated header). The original nine stop at frame 300; four added on 2026-08-26 stop at frame 900. An earlier four-preset "bundled shipped" lane (glowsticks, parallel-universe, cubetrace, krash) is retired.

### The reference set

- **Two references certify nothing and should be retired.** krash and glowsticks were promoted with `--allow-weak-reference`. Native re-captures at 300 to 3,000 frames (krash to 7,200) leave a solid-black frame scoring 0.17–0.35% at most sample points; the frames with signal are isolated spikes (krash 16.56% on frame 1,200, with 4.28% and 0.28% at 1,050 and 1,350; glowsticks 13.07% on 2,250, with 1.51% and 3.19% either side). A reference that narrow measures frame alignment, not rendering. Use the vendored butterchurn as the oracle for krash.
- **Three weak references cannot be strengthened by re-capture.** 250-wavecode scores 7.14–7.19% across 300–3,000 frames, 300-beatdetect 5.57–5.81%, and cubetrace is bit-identical at every frame count tried. They are line-art and bar-chart presets whose coverage the preset fixes; the 4× headroom rule is the wrong shape for them.
- **The 2026-08-26 additions were picked by sweep.** All 39 uncertified manifest entries ran through native projectM at 900 and 1,200 frames, and the bright, frame-stable ones (headroom drift under 15%) were kept: dark-heart (11.1×), orb-acid-in-my-eyes (20.0×), mosaics-of-ages (19.5×), magnetosphere-13-pulsar (6.9×).
- **Next candidate.** `eos-matrix-cube-c` has the highest entropy left (6.45, 8.7×), but Stims renders it blank on WebGPU, so `parity:noise` refuses the capture. Certify it once it renders.

## Method

1. **Native reference (macOS).** `bun run parity:capture:projectm-native -- --preset <id> --output <review-dir>` compiles the checked-in harness against Homebrew `libprojectM` and SDL2, calls `projectM::renderFrame` for the configured frame count in a hidden OpenGL context, and writes a hash-bound provenance sidecar. It checks that the preset id and fixture root stay inside the repository and publishes nothing when render or teardown fails. Review and repeat the output before promoting it; browser screenshots and legacy checked-in Playwright "projectM" captures are not native evidence.
2. **Promote the reference.** `bun run parity:promote-reference -- --output <dir> --preset <id> --strata <list>` copies the image into the fixture directory and updates `visual-reference-manifest.json`, recomputing the fixture and harness hashes. It refuses a reference a blank frame would pass unless `--allow-weak-reference` is given.
3. **Capture Stims.** `bun run parity:capture` walks the certified manifest on one reused browser. For a single preset, `bun scripts/play-toy.ts milkdrop --preset <id> --debug-snapshot --no-vibe-mode --output ./screenshots/parity` writes a screenshot, an agent debug snapshot and a `parity-artifacts.manifest.json` entry. `bun scripts/import-projectm-reference.ts` adds an external reference to the same directory, and `bun run parity:diff -- --output <dir> --preset <id>` diffs one pair.
4. **Calibrate noise.** `bun run parity:noise -- --all --repeats 10 --write` records each preset's run-to-run band in `parity-noise-bands.json`.
5. **Run the suite.** `bun run parity:suite -- --output ./screenshots/parity --write-diff-images` diffs the latest capture of every certified preset against its reference, ranks the worst first, and judges each delta against the preset's band and the previous summary. A delta inside the band reads `no-measurable-change`; a preset without a band reads `noise-band-unmeasured`; a reference a blank render would pass reads `reference-no-signal`.
6. **Promote results.** `bun run parity:promote-result -- --output <dir> --preset <id>` writes `measured-results.json` once the reference is checked in under the same id and the report points at it. `bun run parity:sync-catalog` then rewrites `public/milkdrop-presets/catalog.json`: certified presets keep their measured labels, and unmeasured bundled presets drop to `partial` or `runtime`.

`bun run parity:check-references` scores every certified reference against a solid-black frame with the preset's own threshold and reports the headroom.

## Measurement rules

Each was learned by producing a wrong number first.

1. **Never trust a single capture on a preset whose band is wide.** Check `parity-noise-bands.json` first. To attribute a delta to a change, capture with it, revert, and capture again; if reverting does not restore the old number, the delta was noise. On 2026-09-01 the bands ran from 0.02 percentage points (300-beatdetect) to 14.85 (cubetrace), so a five-point move is a result on one preset and noise on another.
2. **A better score on one preset is not evidence.** Two errors cancelling produce beautiful numbers: defaulting `gammaadj` to 1 put 260's mean at exactly the reference's 127.7 while taking 100-square from 1.43% to 85.74%. Re-measure 100-square (band 0.17 percentage points on 2026-09-01) alongside any tonal change.
3. **Measure transfers, don't derive them.** The present path applies `out = in^(1/gammaAdj)` with gammaAdj defaulting to 2, established by rendering a constant-output comp shader through `__STIMS_AGENT_BRIDGE__.applyEditorSource` and reading the canvas back, after three source-reading attempts got it wrong. projectM's `fGammaAdj = 1.0` init line is overwritten by its parser; do not "fix" our default to match it.
4. **Reference implementations tell you what to try, not what to ship.** The shape `a2 = 0` semantics are butterchurn's, and applying them alone took krash from 47% to about 90%; they are correct only together with the textured-shape multiply.
5. **Captures must not supersample.** The suite passes `--native-resolution` so frames render at capture size like the reference. Locking the `full` quality step to get native resolution also drops mesh density and took 100-square to 15.85%.
6. **Captures run one at a time.** `parity:capture` is serial by default and warns if `--concurrency` is raised. Parallel Chromium instances contend for the GPU and lose their device, and the pre-capture settle loop burns a variable number of frames. Over three passes of the nine presets certified at the time, `100-square` scored 1.30/1.31/1.81% serially and 1.30/17.24/34.97% at concurrency 4; serial captures settled in 0 extra frames against up to 180 at concurrency 4.
7. **The capture must be the pumped frame.** Before 2026-08-27, rendering resumed after the deterministic pump and ran live frames on the decorative audio signal before the screenshot. `renderFrames({ holdAfterPump })` and `freezeRendering()` fix it, and `play-toy` warns when the pumped and captured clocks differ.

## Current scoreboard

<a id="current-state-2026-08-27"></a>

Unmeasured since 2026-09-01. Later renderer changes, including the #1223 feedback clamp (2026-09-23), have not been captured, and re-measuring needs a WebGPU device that headless Chromium does not expose.

The 2026-09-01 suite graded the 13 references: 1 pass, 10 fail, 2 `reference-no-signal`. The medians below come from `parity-noise-bands.json` (WebGPU, 7 repeats, measured the same day; glowsticks 3 repeats on 2026-08-26). Earlier columns are the 2026-08-26 three-repeat medians and the 2026-08-27 single run after the harness and echo fixes.

| Preset | Fail threshold | 2026-08-26 | 2026-08-27 | 2026-09-01 median (band) | Verdict |
| --- | --- | --- | --- | --- | --- |
| 100-square | 2% | 1.20% | 1.50% | 1.39% (0.17) | pass |
| 300-beatdetect-bassmidtreb | 2% | 5.79% | 5.79% | 5.79% (0.02) | fail |
| 250-wavecode | 2% | 7.36% | 7.30% | 7.37% (0.64) | fail |
| 260-compshader-noise_lq | 2% | 33.72% | 33.72% | 91.64% (0.21) | fail |
| 261-compshader-noisevol_lq | 2% | 75.55% | 76.24% | 77.33% (3.66) | fail |
| eos-glowsticks-v2-03-music | 5% | 1.08% | 1.08% | 1.08% (0.02) | no signal |
| krash-rovastar-cerebral-demons-stars | 5% | 86.29% | 95.26% | 95.28% (0.03) | no signal |
| eos-phat-cubetrace-v2 | 5% | 64.59% | 29.25% | 24.28% (14.85) | fail |
| eos-phat-magnetosphere-13-pulsar | 5% | 100.00% | — | 24.90% (11.51) | fail |
| rovastar-parallel-universe | 5% | 82.21% | 67.99% | 68.15% (3.24) | fail |
| eos-phat-dark-heart | 5% | 93.37% | — | 90.84% (0.59) | fail |
| orb-acid-in-my-eyes | 5% | 97.73% | — | 91.74% (3.44) | fail |
| rovastar-mosaics-of-ages | 5% | 99.71% | 100.00% | 100.00% (0.00) | fail |

`measured-results.json` (last written 2026-07-29) still marks 250-wavecode, 300-beatdetect and glowsticks as passing, and the catalog fidelity check trusts it.

## Open work

In order. Each item is judged on WebGPU against projectM unless it says otherwise.

1. **Re-measure and demote.** Re-run capture, noise and suite on the 13 references, then demote every promoted result the suite contradicts.
2. **Retire the no-signal references.** Remove krash and glowsticks from the certified set and judge krash against butterchurn. Its remaining defect there is the textured-shape multiply (`texture(prev, uv) * vertexColor`), with a secondary resolution-dependent feedback attractor.
3. **Seed the capture.** mosaics swung 66.3–99.7% and cubetrace 29.3–38.3% across repeats after the harness fix. The prime suspect is the per-preset `Math.random` constants drawn at load: `play-toy` has a `randomSeed` option that `lab:backend-diff` passes and the parity capture does not.
4. **Feedback accumulation on `fDecay=1.0` presets.** On 2026-08-27 the four worst presets rendered 3.2–3.6× brighter than projectM (magnetosphere 24.7 → 76.9 mean luminance, dark-heart 22.1 → 74.5 with red 62 → 196, mosaics 38.2 → 137.3), and mosaics grew with frame count (77.3 / 121.9 / 142.0 at 150 / 300 / 900 frames). Three of the four have `fDecay=1.000000` and none has a warp shader. The leading hypothesis was additive geometry leaving `current.a` near zero, so the blend degenerates to `previous + current`. #1223 has since clamped the internal frame to [0,1] on both backends, as MilkDrop's 8-bit buffer does; whether that moved these presets is unmeasured. To test what remains, sample the scene target's alpha on one of them.
5. **Feedback and post-effect order.** Match projectM's pass order for feedback, video echo, warp, comp, brighten/darken/solarize/invert and gamma, and remove heuristic visual adjustments the data does not justify.
6. **Shader text.** Expand direct warp/comp execution so fewer presets run on extracted scalar controls (168 on WebGPU; see the [roadmap](./ROADMAP.md#close-the-168-preset-webgpu-shader-translation-gap)), and keep unsupported constructs visible as explicit failures in diagnostics and labels. Certify one shader-heavy preset after each expansion.
7. **Textures and samplers.** Keep explicit downgrades for any sampler path not shown equivalent, check overlay, warp and shape textures on both feedback managers, and add measured coverage for sampler-heavy presets before relaxing fallbacks. 260 and 261 are magnified white noise: correct data still mismatches heavily under a sub-texel offset, and native projectM seeds its noise textures per process, so they need a statistical tolerance rather than a per-pixel one.
8. **Waves, shapes and mesh.** Decide whether shape radius needs the 0..1 → −1..1 rescaling that shape `x`/`y` receive; tighten outline, border and wave thickness against references; and treat visible draw-order or smoothing drift as a certification blocker even when the VM output is right. `bun run lab:backend-diff` locates backend disagreement on wave- and shape-heavy presets; the fix is judged against projectM.
9. **WebGL coverage.** Capture WebGL against the same references before any WebGL fidelity claim.
10. **Say what is measured in the product.** The "projectM verified" and drift badges lived in a row renderer that was never mounted and was deleted in #1454, so no visitor surface shows a measured result. Expose a per-preset link to the diff and reference artifacts, and carry the measured-versus-inferred distinction into catalog rollups and exported diagnostics.
11. **Certify `eos-matrix-cube-c`** once it renders on WebGPU.

A preset is `exact` only when it passes its projectM reference within tolerance and outside its noise band, and nothing is marketed as `exact` without that.

## Done

- **Milestones 0–3** of the archived backlog: deterministic parity artifacts, checked-in certification manifests, native projectM reference promotion, measured-result promotion, the ranked diff suite, and fidelity labels derived from measured results rather than compiler support.
- **Corpus integrity.** The bundled Butterchurn import used to drop every equation block: 1,739 of 1,791 catalogued presets shipped with base values and shader text only. `scripts/butterchurn-eel-transpiler.ts` converts the upstream JavaScript back to EEL, recovering 157,950 statements, and the runtime executes `loop()` and `while()` with a shared per-block guard of 2,097,152 iterations.
- **Capture harness (2026-08-27).** Captures now show the pumped frame (rule 7). Measured on 260, the pump had left the engine at t=4.913 s with bass 0.00 while the screenshot showed t=5.598 s with bass 2.47, 28–162 frames late. 261's run-to-run spread fell from 14.7 to 0.52 percentage points.
- **Video echo (2026-08-27).** Both backends flipped the history sample instead of applying echo at display, so `fVideoEchoZoom` never reached a shader. Echo is now a display-stage second draw (`MILKDROP_VIDEO_ECHO_HELPER` in `feedback-shader-library.ts`, mirrored in the WebGPU TSL composite). At alpha 0.5 and orientation 3 the output must equal its own 180° rotation: projectM scores 0.9994 self-correlation on parallel-universe; Stims went from 0.665 to 0.973, and krash from about 0.5 to 0.992.
- **Lowered-descriptor semantics (2026-08-18).** `tests/unit/gpu-field-tier-differential.test.ts` holds WebGPU field programs equal to the CPU JIT after six divergence classes covering 32% of lowered programs were fixed; what remains is f32 precision and constructs that are not lowered.
- **Shapes.** Instancing (`shapecode_N_num_inst`) runs the per-frame shape program once per instance with `instance` and `num_inst`, capped at MilkDrop's 1,024; the radius floor is 0.002; the `time * 0.08` rotation and `beatPulse` radius flourishes were removed (`6b43d58e`).
- **Partial slices of feedback, sampler and rasterization work:** blur and boost alignment, unsupported `tex3D` paths downgraded rather than claimed, overlay replace distinct from mix, wrapped textured-shape sampling, warp textures sampled in warp-stage UV space, two-colour shape gradients and world-space outline thickness on the WebGPU batcher, and preset `thick` values kept on WebGL line waves.
