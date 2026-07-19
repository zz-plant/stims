# Release Evidence Ledger — Current parity snapshot

Updated 2026-07-18 from the checked-in certification artifacts. The historical filename is retained because it is linked from the existing release documentation.

## Certification summary

The current corpus contains 23 targets. The comparator requires the requested backend and does not count a WebGL fallback as a WebGPU capture.

| Result | Count |
|---|---:|
| Certified on WebGL and WebGPU | 2 |
| Certified on WebGPU only | 0 |
| Certified on WebGL only | 1 |
| Uncertified with reference/capture activity | 6 |
| Unmeasured | 14 |
| Missing native WebGPU captures | 0 |

The two both-certified projectM fixtures are `250-wavecode` (WebGPU mismatch ratio `0.002297`) and `300-beatdetect-bassmidtreb` (WebGPU mismatch ratio `0`). `eos-glowsticks-v2-03-music` passes the compatibility WebGL comparison at `0.015776` but its required WebGPU capture currently fails, so it is WebGL-only. The volume fixtures now have native WebGPU captures and use generated RGBA noise/atlas sources, but still fail the strict pixel tolerance because native projectM noise is randomized: `260-compshader-noise_lq` at `0.906076` and `261-compshader-noisevol_lq` at `0.947834`.

## Bundled shipped lane

All four shipped anchors now have provenance-checked native projectM 3.1.12 references and browser capture artifacts:

| ID | WebGL comparison | WebGPU comparison | Current status |
|---|---|---|---|
| `eos-glowsticks-v2-03-music` | pass, `0.015776` | fail, `0.537115` | WebGL-only |
| `rovastar-parallel-universe` | fail, `0.982264` | fail, `0.864784` | Uncertified |
| `eos-phat-cubetrace-v2` | fail, `0.230698` | fail, `0.471127` | Uncertified |
| `krash-rovastar-cerebral-demons-stars` | fail, `0.198688` | fail, `0.590088` | Uncertified |

These numbers are evidence of remaining renderer and feedback drift, not reasons to weaken certification thresholds.

## Shader-text status

The compiler contracts previously listed as open are now covered by focused tests:

- GLSL `^` lowers to `pow`; `|` and `&` use float-to-int bitwise lowering.
- `bassAtt`, `midAtt`, and `trebleAtt` map to the shared signal uniforms.
- Add, multiply, subtract, swapped-argument mix, `sampler_main` reset, scalar vector splats, and scaled-main mixes are extracted or lowered in the supported subset.
- Complex UV expressions remain direct-program payloads and keep an explicit controls-fallback boundary.

Volume samplers are semantically routed on both backends. WebGPU uses native 3D textures; WebGL uses a bounded atlas approximation. Exact visual claims remain gated by measured native captures.

## Remaining release blockers

- Distribution-aware certification for randomized volume-shader fixtures; their native sampler semantics are implemented, but strict pixel comparison is not a valid exactness test across independent noise seeds.
- Feedback/video-echo pass ordering and rasterization drift for the shipped anchors.
- Native WebGPU direct feedback remains disabled for live sessions and is enabled only in the explicit `renderer=webgpu&corpus=certification` lane, where ShaderMaterial/TSL composite parity is measured.
- Broader shader-heavy, sampler-heavy, wave, and shape corpus coverage.

Source artifacts:

- `assets/data/milkdrop-parity/webgpu-certification-report.json`
- `assets/data/milkdrop-parity/visual-reference-manifest.json`
- `assets/data/milkdrop-parity/measured-results.json`
- `tests/fixtures/milkdrop/projectm-reference/`
