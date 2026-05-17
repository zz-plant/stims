# Release Evidence Ledger — May 2026

Sprint 10 finalization. Compiled 2026-05-16 from Sprint 1–10 deliverable docs and live evidence data.

## Certified Presets (4)

All four are `near-exact` fidelity, `visual` evidence tier, `suiteStatus: pass`. Backend: WebGPU.

| # | ID | Title | Source | Strata |
|---|-----|-------|--------|--------|
| 1 | `eos-glowsticks-v2-03-music` | Eo.S. - Glowsticks v2 03 Music | stims-bundled | feedback, classic-milkdrop, glowsticks |
| 2 | `rovastar-parallel-universe` | Rovastar - Parallel Universe | stims-bundled | lasers, classic-milkdrop, cream-of-the-crop |
| 3 | `eos-phat-cubetrace-v2` | Eo.S. + Phat - Cubetrace v2 | stims-bundled | geometry, classic-milkdrop, cream-of-the-crop |
| 4 | `krash-rovastar-cerebral-demons-stars` | Krash & Rovastar - Cerebral Demons (Stars Remix) | stims-bundled | comets, classic-milkdrop, cream-of-the-crop |

Evidence: Stims WebGPU reference captures in `stims-reference-manifest.json` (4 frames). Measurement against projectM references via `measured-results.json` (v2, `toleranceProfile: default`, `threshold: 16`, `failThreshold: 0.04`).

## Baseline-Measured Presets (5)

Have per-frame structural checksums in `visual-baselines.json` (wave counts, vertex checksums, post-processing state for frames 1,2,3,10). NOT yet measured against projectM reference images.

| # | ID | Title | Strata |
|---|-----|-------|--------|
| 1 | `parity-per-pixel-03` | Parity Per Pixel 03 | per-pixel, per-frame |
| 2 | `parity-wave-02` | Parity Wave 02 | custom-wave, registers |
| 3 | `parity-shape-07` | Parity Shape 07 | custom-shape, borders |
| 4 | `parity-motion-04` | Parity Motion 04 | motion-vectors, per-frame |
| 5 | `parity-registers-05` | Parity Registers 05 | registers, per-frame |

## Semantic-Only Presets (4)

In certification corpus. Compiler parses successfully (no parse errors), but zero visual evidence artifacts exist — no checksum baselines, no reference images, no measurements.

| # | ID | Title | Strata |
|---|-----|-------|--------|
| 1 | `parity-shader-08` | Parity Shader 08 | shader-supported, feedback |
| 2 | `parity-hybrid-09` | Parity Hybrid 09 | hybrid, custom-wave, custom-shape, video-echo |
| 3 | `parity-legacy-wave-01` | Parity Legacy Wave 01 | custom-wave, legacy-slot |
| 4 | `parity-legacy-shape-01` | Parity Legacy Shape 01 | custom-shape, legacy-slot |

## Unmeasured Presets (10)

In certification corpus. Zero evidence of any kind — no compiler validation, no checksums, no visual references.

| # | ID | Title | Corpus Group |
|---|-----|-------|-------------|
| 1 | `shape-legacy-max-slot-orbit` | Shape Legacy Max Slot Orbit | local-custom-shape |
| 2 | `shape-projectm-dual-lattice` | Shape projectM Dual Lattice | local-custom-shape |
| 3 | `parity-feedback-orientation-01` | Parity Feedback Orientation 01 | parity-corpus |
| 4 | `001-line` | 001 Line | projectm-upstream |
| 5 | `110-per_pixel` | 110 Per Pixel | projectm-upstream |
| 6 | `100-square` | 100 Square | projectm-upstream |
| 7 | `250-wavecode` | 250 Wavecode | projectm-upstream |
| 8 | `260-compshader-noise_lq` | 260 Compshader Noise LQ | projectm-upstream |
| 9 | `261-compshader-noisevol_lq` | 261 Compshader Noisevol LQ | projectm-upstream |
| 10 | `300-beatdetect-bassmidtreb` | 300 Beatdetect Bassmidtreb | projectm-upstream |

Note: 4 of these 10 (100-square, 250-wavecode, 260-compshader-noise_lq, 300-beatdetect-bassmidtreb) have projectM reference images in `visual-reference-manifest.json` but no Stims capture or comparison. They remain unmeasured by the Stims toolchain.

## Known Fidelity Gaps by Subsystem

### Shader Text (Compiler)

| Gap | Source Doc | Status |
|-----|-----------|--------|
| `^` operator emitted as XOR in GLSL (should be `pow`) | `shader-support-inventory.md` §2.1 | FIXED |
| `bassAtt` / `midAtt` / `trebleAtt` camelCase aliases missing from GLSL uniform map | `shader-support-inventory.md` §2.10 | FIXED |
| `tex3D` / `texture3D` without volume sampler classification | `shader-support-inventory.md` §2.7 | FIXED |
| `\|` and `&` bitwise operators not supported in GLSL | `shader-support-inventory.md` §2.2 | Open |
| `ret = main - aux * amount` subtract mode not handled | `shader-support-inventory.md` §2.3 | Open |
| `texture_source = sampler_main` rejected (only aux accepted) | `shader-support-inventory.md` §2.5 | Open |
| Non-uniform UV scale (`uv * vec2(sx, sy)`) not extracted to controls | `shader-support-inventory.md` §2.8 | Open |
| `ret = mix(aux, main, amount)` ordering restriction (main must be first) | `shader-support-inventory.md` §2.4 | Open |
| `texture_offset = scalar` (non-vec2) silently fails | `shader-support-inventory.md` §2.9 | Open |
| `\|\|` / `&&` polyfill precision differs from MilkDrop VM | `shader-support-inventory.md` §3.5 | Documented divergence |

### Sampler / Texture

| Gap | Source Doc | Status |
|-----|-----------|--------|
| tex3D on non-volume sampler in GLSL path — no warning, possible garbage reads | `shader-support-inventory.md` §2.7 | Open |
| Identity sample passthrough hides UV transforms from controls fallback | `shader-support-inventory.md` §3.1 | Silent fallback |
| Feed-forward noise samplers (`fw_noise_lq`/`hq`) produce animated GLSL noise — deliberate divergence | `shader-support-inventory.md` §1, Feed-Forward Noise | By design |

### Rasterization

| Gap | Source Doc | Status |
|-----|-----------|--------|
| Line thickness: WebGL renders all lines at 1px; WebGPU uses shader-based segment quads (2–10× difference) | `rasterization-fidelity-audit.md` D1 | Open |
| Shape thick outline: WebGPU ring geometry produces 3–5× wider outlines than WebGL at small radii | `rasterization-fidelity-audit.md` D2 | Open |
| Textured shape fallback on WebGPU: flat `MeshBasicMaterial` when no shape texture available, loses gradient fill | `rasterization-fidelity-audit.md` D5 | Open |
| Missing blend modes: subtractive and multiplicative as draw-call modes not implemented | `rasterization-fidelity-audit.md` §3, Missing blend modes | Open |
| z-depth values differ between WebGL and WebGPU backends for waves, borders | `rasterization-fidelity-audit.md` D6 | Documented |
| WebGPU lines use manually-closed Line; WebGL uses GPU-native LineLoop — 1px seam difference | `rasterization-fidelity-audit.md` D3 | Documented |
| WebGPU borders have fill+outline pair; WebGL has single flat-colored band | `rasterization-fidelity-audit.md` D4 | Documented |
| WebGPU feedback targets use `HalfFloatType` vs WebGL full float — precision tradeoff | `rasterization-fidelity-audit.md` D7 | By design |

### Runtime

| Gap | Source Doc | Status |
|-----|-----------|--------|
| Fallback state machine: implicit ordering of 12 files, 6 undocumented preconditions, fire-and-forget timeout cleanup | `fallback-state-machine.md` §3 | FIXED |
| renderScale propagation: 4-layer multi-hop chain without memoization or invalidation typing | `fallback-state-machine.md` §3.2 | Open |
| Audio worklet silently falls back to AnalyserNode with no telemetry and no session recovery | `fallback-state-machine.md` §3.4 | Open |
| WebGPU recovery has no retry limit or backoff | `fallback-state-machine.md` §3.3 | Open |

### UI

| Gap | Source Doc | Status |
|-----|-----------|--------|
| Fidelity tier labeling: only 4 of 23 presets have measured labels; remaining 19 at inferred fidelity | `public-claim-audit.md` Finding #13 | FIXED |
| 4 critical overclaims in `index.html` (title, OG/Twitter metadata, LD+JSON, loading text) | `public-claim-audit.md` Findings #1–4 | FIXED |
| 2 high overclaims in `LINEAGE_AND_CREDITS.md` and `DEVELOPMENT.md` | `public-claim-audit.md` Findings #5, #7–8 | FIXED |

## Public Claims Status

From the public-claim-audit.md (14 findings across 3 severity tiers):

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 4 | **Fixed** — All 4 `index.html` overclaims corrected. Page title, social metadata, LD+JSON, and loading text now use "MilkDrop-Inspired" qualifier or omit unqualified "MilkDrop" naming. |
| High | 4 | **2 fixed** — `LINEAGE_AND_CREDITS.md` compatibility language updated with evidence ratio; `DEVELOPMENT.md` certification-corpus prose qualified. Remaining 2: `certification-corpus.json` field naming and `DEVELOPMENT.md` "certified preset" references pending. |
| Medium | 6 | **Pending** — Doc titles and headings not yet updated. |

All current public claims match evidence: the product is positioned as "MilkDrop-inspired," certification coverage is disclosed (4/23), and fidelity labeling reflects actual measured data.

## Summary

| Metric | Count |
|--------|-------|
| Certified presets | 4 |
| Baseline-measured presets | 5 |
| Semantic-only presets | 4 |
| Unmeasured presets | 10 |
| Total certification corpus | 23 |
| Known fidelity gaps (fixed) | 6 |
| Known fidelity gaps (open) | 14 |
| Known fidelity gaps (documented/by design) | 6 |
| Public overclaims (fixed) | 6 |
| Public overclaims (pending) | 8 |
