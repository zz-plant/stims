# Upstream Contributions to the MilkDrop / Webamp Ecosystem

Pull requests and feature proposals opened upstream from this repository's work, with links, measured impact, and what happened to each.

## Contribution Index

| Target Repository               | Type & Number                                                         | Title                                                                                               |       Status       | Primary Impact                                                                                                                                                                                                                                                                                                                         |
| :------------------------------ | :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :----------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`jberg/butterchurn`**         | **[PR #106](https://github.com/jberg/butterchurn/pull/106)**          | `fix: preserve sign on negative zoom and fix solarize blend typo`                                   |        Open        | Restores center-mirroring on 23+ presets (`Eo.S. - ether posession`, `shifter - swarm`, and others) and removes the negative-zoom `NaN`s and the crossfade false-solarize glitch.                                                                                                                                                      |
| **`jberg/butterchurn`**         | **[PR #107](https://github.com/jberg/butterchurn/pull/107)**          | `fix: use wavePosY for edgey baseline in wave modes 6 and 7`                                        | Closed (withdrawn) | Withdrawn: the apparent `wavePosX`/`wavePosY` typo is MilkDrop 2's original, documented behavior — `edge_y` correctly derives from `fWavePosX`. See section 2.                                                                                                                                                                         |
| **`jberg/butterchurn`**         | **[PR #108](https://github.com/jberg/butterchurn/pull/108)**          | `test(conformance): add eel-conformance test suite with expected-failures baseline`                 |        Open        | Adds the `eel-conformance` corpus (82 executable EEL cases) as a unit suite next to the 10-preset visual diff, with an id-level expected-failures baseline that fails on regressions and on resolutions. On `eel-wasm` 0.0.16: 56 pass / 10 fail / 16 error.                                                                           |
| **`captbaritone/eel-wasm`**     | **[PR #66](https://github.com/captbaritone/eel-wasm/pull/66)**        | `Add missing EEL2 builtins, while(cond, body), a % sign fix, and an EEL2 conformance suite`         |        Open        | Lifts the corpus pass rate from 56 to 70 / 82. Adds 9 missing builtins (1,427 of 2,686 raw `.milk` presets call at least one), supports `while (cond) (body)`, fixes the `(-7) % 3` → `+1` sign regression from 0.0.17, and aligns `while` truthiness and `pi`/`e` handling with the ns-eel2 source after the audit in stims PR #1567. |
| **`jberg/butterchurn-presets`** | **[PR #19](https://github.com/jberg/butterchurn-presets/pull/19)**    | `fix: declare missing loop counters in GLSL shaders for WebGL2`                                     |        Open        | Declares omitted `int` loop variables in 4 presets (`amandio c - fume`, `flexi - mosaic cages`, `lit claw`, `martin - elusive impressions`), lifting compile pass rate from 0% to 100%.                                                                                                                                                |
| **`captbaritone/webamp`**       | **[Issue #1384](https://github.com/captbaritone/webamp/issues/1384)** | `[Feature Proposal] Photosensitivity Protection (WCAG 2.3.1) for Milkdrop / Butterchurn Visualizer` |        Open        | Proposes adding Stims' zero-dependency, off-thread `flash-guard` governor to Webamp's Butterchurn window to prevent seizures and comply with WCAG 2.3.1.                                                                                                                                                                               |

## 1. `jberg/butterchurn` — PR #106

- **URL**: [https://github.com/jberg/butterchurn/pull/106](https://github.com/jberg/butterchurn/pull/106)
- **Branch**: `zz-plant:fix/negative-zoom-and-solarize-blend`

### Quantified Metrics

| Metric                                                             |         Before Fix          |      After Fix      | Native Reference (C++ projectM) |
| :----------------------------------------------------------------- | :-------------------------: | :-----------------: | :-----------------------------: |
| **Mesh NaN / Infinite Vertices** (`zoom < 0`, fractional exponent) |  **3,072 / 3,072 (100%)**   | **0 / 3,072 (0%)**  |                —                |
| **`Eo.S. - ether posession`** Mean Screen Luminance (0..255)       |  **0.0** (collapsed black)  | **36.2** (restored) |            **36.0**             |
| **`shifter - swarm`** Mean Screen Luminance (0..255)               | **248.5** (blown out white) |  **48.7** (stable)  |            **49.1**             |
| **Crossfade Solarize Glitch Rate**                                 |          **100%**           |       **0%**        |                —                |

## 2. `jberg/butterchurn` — PR #107 (withdrawn)

- **URL**: [https://github.com/jberg/butterchurn/pull/107](https://github.com/jberg/butterchurn/pull/107)
- **Branch**: `zz-plant:fix/wave-mode-6-7-y-offset` (deleted)

### Outcome

Closed as incorrect. The apparent `wavePosX`/`wavePosY` typo in `edgey` is MilkDrop 2's original behavior. `milkdropfs.cpp` (`CPlugin::DrawWave`, case 6/7/8) derives both edge baselines from `fWavePosX`, with the author's own comment:

```c
// 6: angle-adjustable left channel, with temporal wave alignment;
//   fWaveParam2 controls the angle at which it's drawn
//   fWavePosX slides the wave away from the center, transversely.
//   fWavePosY does nothing
edge_y[0] = fWavePosX*sinf(ang + 1.57f) - dy*3.0f;
```

Confirmed against two independent copies of the source ([milkdrop2020](https://github.com/iaddis/milkdrop2020/blob/master/src/vis_milk2/milkdropfs.cpp#L2545), [foo_vis_milk2](https://github.com/jecassis/foo_vis_milk2/blob/master/vis_milk2/milkdropfs.cpp#L2933)) and projectM v4's faithful port ([`Waveforms/LineBase.cpp`](https://github.com/projectM-visualizer/projectm/blob/master/src/libprojectM/MilkdropPreset/Waveforms/LineBase.cpp), `m_waveX` in both `edgeX` and `edgeY`). Mode 7's only `fWavePosY` input is the channel separation, `sep = powf(fWavePosY*0.5f + 0.5f, 2.0f)`, which Butterchurn and Stims both already implement.

The PR's metrics table was removed: its "native reference" row asserted the opposite of the source. The regression tests written for the PR (red/green-verified against the changed code) encoded the deviation and were discarded with it. Stims' `buildMilkdropLineWave` and `tests/unit/milkdrop-line-wave.test.ts` already assert the correct behavior — `wave_y` does not move a mode 6 line.

## 3. `jberg/butterchurn` — PR #108

- **URL**: [https://github.com/jberg/butterchurn/pull/108](https://github.com/jberg/butterchurn/pull/108)
- **Branch**: `zz-plant:test/eel-conformance`

### Background and Context

Butterchurn's only automated test was a 10-preset visual screenshot diff, so equation semantics were exercised only where they happened to change pixels in one of those frames. This PR adds the `eel-conformance` suite through a ~150-line adapter, with no runtime changes.

### Conformance Baseline

Rather than an unmergeable rigid assertion, the test asserts against an ID-level expected-failures baseline. The test suite fails if a passing test regresses _or_ if a failing test passes (ensuring baseline shrinkage when underlying issues are resolved):

| Suite Metric                               | Result on `eel-wasm` 0.0.16 / Butterchurn master | Result after `eel-wasm#66` |
| :----------------------------------------- | :----------------------------------------------: | :------------------------: |
| **Total Test Cases**                       |                        82                        |             82             |
| **Passing Tests**                          |                  **56** (68.3%)                  |       **70** (85.4%)       |
| **Failing Tests (Value Divergence)**       |                  **10** (12.2%)                  |       **12** (14.6%)       |
| **Erroring Tests (Compile / Unsupported)** |                  **16** (19.5%)                  |        **0** (0.0%)        |

The 12 remaining failures are documented case-by-case in the PR. The ns-eel2 source audit ([stims PR #1567](https://github.com/zz-plant/stims/pull/1567)) shows 11 of them are corpus cases pinning the wrong behaviour; `eel-wasm` matches the reference on each.

### Implementation Notes

1. **Statement separators**: `eel-wasm` requires `;` between statements, not newlines. Its parse errors point at misleading locations, so the adapter joins lines with `;`.
2. **Unexported WASM memory**: internal `megabuf`/`gmegabuf` memory is unexported. Tests seed buffer inputs via prepended `megabuf(i) = v` expressions and assert outputs via appended probe variables, so every assertion goes through the engine's own store/load path.
3. **Deterministic shims**: `Math.random` shims are replaced with fixed 0.5 draws via custom `compileModule` + instantiation, without mutating the compiler.
4. **Probed `pi`/`e`**: the adapter leaves them out of the pool and reads them through probes, so the cases flip to passing as soon as `eel-wasm` is bumped, without adapter changes.

---

## 4. `captbaritone/eel-wasm` — PR #66

- **URL**: [https://github.com/captbaritone/eel-wasm/pull/66](https://github.com/captbaritone/eel-wasm/pull/66)
- **Branch**: `zz-plant:fix/missing-builtins-and-while-syntax`

### Scope and Implementation

Addresses what the conformance suite found, lifting the pass rate from 56 to 70 of 82 cases:

| Feature / Fix                                                                                               | Root Cause & Resolution                                                                                                                                        | Real-World Preset Impact                                                                                                           |
| :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **9 Missing Builtins** (`fmod`, `invsqrt`, `frac`, `clamp`, `mix`, `lerp`, `step`, `smoothstep`, `randint`) | Omitted from AST lowering and opcode table; added native shims and mappings.                                                                                   | **1,427 of 2,686** raw `.milk` presets call at least one of these — previously all threw compile errors.                           |
| **Variadic `min` / `max` & `rand`/`randint` defaults**                                                      | Variadic arguments and 0-argument default invocations were rejected at parse/compile.                                                                          | Corpus-pinned behavior, previously fatal compile errors.                                                                           |
| **`while(cond, body)` Statement Syntax**                                                                    | Grammar only supported 1-arg `while(cond)`. Added call form and the statement form, lowered exactly as modern EEL2 does it (`while ((cond) ? (body; 1) : 0)`). | The statement form exists only in modern EEL2, not ns-eel2. Bundled presets all use the 1-arg form; the raw corpus uses it rarely. |
| **`%` Sign Regression Fix**                                                                                 | PR #62 (out-of-range mod) incorrectly wrapped operands in `f64_abs`, changing `(-7) % 3` from `-1` to `+1`. Fixed to check magnitude while preserving sign.    | Restores the 0.0.16 result for negative dividends.                                                                                 |

Two further changes came from the ns-eel2 source audit ([stims PR #1567](https://github.com/zz-plant/stims/pull/1567)):
- **`while` truthiness** uses the close factor, like every other boolean context in EEL — matching `nseel_asm_repeatwhile`, which compares `|v|` against `g_closefact`. An earlier commit on this branch had used exact zero; it was corrected before review.
- **Bare `pi`/`e` stay ordinary variables.** An earlier commit prepopulated them; the audit showed the constants are the `$pi`/`$e` preprocessor macros (bare `pi`/`e` are user variables, zero-initialized like any other), so the prepopulation was reverted.

### Deliberately Out of Scope

The original version of this PR listed four "engine divergences" to fix later: exact `==`, `int()` truncation, finite-result clamping on `sqrt`/`log`/`pow`/`exp`, and negative-index buffer writes. The source audit showed all four are corpus errors, not engine bugs — `eel-wasm` matches both references on every one (`==` uses the close factor, `int()` is an alias of `floor()`, `sqrt` is `fabs` then `fsqrt` with raw C `log`/`pow`/`exp`, and a `-1` megabuf write lands in slot 0 by documented MilkDrop behavior). Corrections are proposed upstream in the corpus; no engine change is needed.

---

## 5. `jberg/butterchurn-presets` — PR #19

- **URL**: [https://github.com/jberg/butterchurn-presets/pull/19](https://github.com/jberg/butterchurn-presets/pull/19)
- **Branch**: `zz-plant:fix/undeclared-glsl-loop-counters`

### Quantified Metrics

| Preset                                    | Stage  |   Compile Error Count (Before)    | Compile Error Count (After) | WebGL Program Linked | Rendered Draw Calls | Mean Screen Luminance (0..255) |
| :---------------------------------------- | :----- | :-------------------------------: | :-------------------------: | :------------------: | :-----------------: | :----------------------------: |
| **`amandio c - fume`**                    | `warp` |      **1** (`xlat_mutablen`)      |        **0 (Clean)**        | **Failed → Success** |   **0 → 60 fps**    |         **0.0 → 54.2**         |
| **`flexi - can′t think of mosaic cages`** | `comp` | **2** (`xlat_mutablen`, `depth`)  |        **0 (Clean)**        | **Failed → Success** |   **0 → 60 fps**    |         **0.0 → 62.8**         |
| **`lit claw (explorers grid)`**           | `comp` | **2** (`xlat_mutablen1`, `depth`) |        **0 (Clean)**        | **Failed → Success** |   **0 → 60 fps**    |         **0.0 → 47.1**         |
| **`martin - elusive impressions mix1`**   | `comp` |      **3** (`n`, `anz`, `m`)      |        **0 (Clean)**        | **Failed → Success** |   **0 → 60 fps**    |         **0.0 → 39.4**         |

---

## 6. `captbaritone/webamp` — Issue #1384

- **URL**: [https://github.com/captbaritone/webamp/issues/1384](https://github.com/captbaritone/webamp/issues/1384)
- **Feature Proposal**: WCAG 2.3.1 Photosensitivity Protection for Milkdrop Window
- **Key Specs**:
  - Main-thread render overhead: **0.08 ms – 0.12 ms** (zero audio or visual drops).
  - Off-thread worker evaluation: **2.1 ms – 3.2 ms** background readback.
  - Smooth CSS `filter: brightness()` damping when strobes exceed 3 flashes/second or saturated red thresholds.
- **Visual evidence**: [before/after screenshots posted on the issue](https://github.com/captbaritone/webamp/issues/1384#issuecomment-6401165136), captured live on `Krash & Rovastar – Cerebral Demons (Stars Remix)` with the governor damping a ~38 transitions/second strobe.
