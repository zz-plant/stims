# Public Claim Audit — Sprint 9 Prep

> **Evidence baseline (Sprint 1):** 4 of 23 certification-corpus presets have measured visual results (`measured-results.json`). 12 have checksum baselines only (`visual-baselines.json`). 10 have zero evidence artifacts (7 parity-corpus + 2 local-shape + 1 upstream fixture never captured). No preset has been measured against an external `projectM` reference image in the checked-in suite.

---

## Summary Table

| # | File | Line(s) | Claim | Evidence Mismatch | Severity |
|---|------|---------|-------|-------------------|----------|
| 1 | `index.html` | 23 | `<title>MilkDrop Visualizer \| Stims</title>` | Presents product as a MilkDrop implementation without qualifier. Description meta on line 8 correctly uses "MilkDrop-inspired" but the title does not. | **Critical** |
| 2 | `index.html` | 24,39 | `og:title` and `twitter:title` both read "MilkDrop Visualizer \| Stims" | Same unqualified naming in social-share metadata. | **Critical** |
| 3 | `index.html` | 84–91 | LD+JSON schema `"name": "MilkDrop Visualizer"` | Structured-data markup claims "MilkDrop Visualizer" as the application name. Schema consumers (search engines, assistants) will treat this as the canonical product name. | **Critical** |
| 4 | `index.html` | 99 | `"Loading MilkDrop visualizer"` (loading-screen text) | Same unqualified naming in user-facing loading copy. | **Critical** |
| 5 | `docs/LINEAGE_AND_CREDITS.md` | 11 | "Compatible with parts of the broader MilkDrop/projectM preset ecosystem." | "Compatible" implies functional equivalence. Only 4 of 23 corpus presets have measured visual evidence against any reference. 19 have no measured comparison — including 7 projectM-upstream fixtures and all 10 parity-corpus presets. "Parts of" softens the claim but does not quantify which parts or how many. | **High** |
| 6 | `assets/data/milkdrop-parity/certification-corpus.json` | 3,5 | `"parityTarget": "projectm-webgpu-certification-v1"`, `"presetCount": 23` | The file name (`certification-corpus`) and its top-level fields present all 23 presets as part of a "certification" target. Only 4 have certified results in `measured-results.json`. The other 19 are uncertified with no measured visual evidence. | **High** |
| 7 | `docs/DEVELOPMENT.md` | 111–114 | "To capture the certification corpus directly from `assets/data/milkdrop-parity/certification-corpus.json` … use: `bun run parity:capture:corpus -- --group bundled-shipped`" | Refers to the full 23-preset file as a "certification corpus" without distinguishing which presets are certified (4) from which are targets for future certification (19). The command scopes correctly to `bundled-shipped` but the surrounding prose does not. | **High** |
| 8 | `docs/DEVELOPMENT.md` | 155,161 | "To run the certified parity suite … each certified preset" | Calls presets in the corpus "certified" when only 4 have certification evidence. A reader scanning this section would assume all suite presets have been through the full measurement pipeline. | **High** |
| 9 | `docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md` | 1 | `# MilkDrop projectM parity backlog` | Title implies Stims is tracking toward "MilkDrop projectM parity" — a framing that suggests parity is an achievable next step rather than an open research question. The body correctly qualifies this but the title is absolute. | **Medium** |
| 10 | `docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md` | 1 | `# MilkDrop successor workstreams` | Title uses "successor" without qualification. The body on line 5 adds aspirational language ("to become the strongest credible successor candidate"), but the unqualified title reads as a claim of successor status. | **Medium** |
| 11 | `docs/MILKDROP_PRESET_RUNTIME.md` | 1,3 | `# MilkDrop Preset Runtime`, "the shipped MilkDrop visualizer" | Names the runtime as a "MilkDrop Preset Runtime" rather than a "MilkDrop-inspired preset runtime." Implies technical continuity with MilkDrop's actual runtime. | **Medium** |
| 12 | `docs/toys.md` | 6–7 | `## MilkDrop Visualizer (milkdrop)` heading with "MilkDrop-inspired browser visualizer" body | Auto-generated heading uses unqualified "MilkDrop Visualizer." Body text partially corrects with "MilkDrop-inspired," but the heading dominates first impression. | **Medium** |
| 13 | `docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md` | 23 | "honest fidelity labeling are all wired" | The infrastructure to promote measured results into fidelity labels exists, but only 4 of 23 presets have measured labels. The phrase "all wired" implies the labeling problem is solved rather than the pipeline merely existing. | **Medium** |
| 14 | `README.md` | 52 | "one flagship MilkDrop-led visualizer experience" | "MilkDrop-led" could be read as the product being driven by or closely tracking MilkDrop, rather than simply inspired by it. Mildly imprecise given the 4/23 evidence ratio. | **Medium** |

---

## Severity Classification

### Critical (4 findings)
Claims that present Stims as a MilkDrop product without qualification. These contradict the project's own `LINEAGE_AND_CREDITS.md` guidance to avoid "Official MilkDrop for the web" language and the contributor rule to "pair successor claims with explicit lineage language."

- **Findings #1–4** (all `index.html`): Title, social metadata, LD+JSON, and loading text all use "MilkDrop Visualizer" without "inspired by," "style," or equivalent qualifier.

### High (4 findings)
Claims that imply measured evidence where none exists, or use "certified" / "compatible" language that collapses the 4-measured / 19-unmeasured distinction.

- **Finding #5** (`LINEAGE_AND_CREDITS.md`): "Compatible with parts of" without measured evidence for 19/23 presets.
- **Finding #6** (`certification-corpus.json`): 23 presets presented under a "certification" target with only 4 certified.
- **Findings #7–8** (`DEVELOPMENT.md`): "Certification corpus" and "certified preset" language without disclaiming the 4/23 ratio.

### Medium (6 findings)
Imprecise language that a skeptical reader would challenge, or titles/headings that imply status the body text partially corrects.

- **Findings #9–10**: "Parity backlog" and "successor workstreams" titles imply near-term achievability.
- **Findings #11–12**: Unqualified "MilkDrop" naming in docs headings and auto-generated content.
- **Finding #13**: "All wired" implies completeness that doesn't exist.
- **Finding #14**: "MilkDrop-led" phrasing in README.

---

## Recommended Fixes

### Critical fixes

**Finding #1 — `index.html:23` (page title)**
```
- <title>MilkDrop Visualizer | Stims</title>
+ <title>MilkDrop-Inspired Music Visualizer | Stims</title>
```

**Findings #2 — `index.html:24,39` (OG + Twitter titles)**
```
- <meta property="og:title" content="MilkDrop Visualizer | Stims" />
+ <meta property="og:title" content="MilkDrop-Inspired Music Visualizer | Stims" />

- <meta name="twitter:title" content="MilkDrop Visualizer | Stims" />
+ <meta name="twitter:title" content="MilkDrop-Inspired Music Visualizer | Stims" />
```

**Finding #3 — `index.html:84` (LD+JSON name)**
```
- "name": "MilkDrop Visualizer",
+ "name": "MilkDrop-Inspired Visualizer",
```

**Finding #4 — `index.html:99` (loading text)**
```
- Loading MilkDrop visualizer
+ Loading visualizer
```

### High fixes

**Finding #5 — `docs/LINEAGE_AND_CREDITS.md:11`**
```
- "Compatible with parts of the broader MilkDrop/projectM preset ecosystem."
+ "Able to load and render presets from the MilkDrop/projectM ecosystem. Visual fidelity varies: 4 of 23 certification-corpus presets have measured near-exact results; the remaining presets are at the compiler/runtime compatibility stage and have not yet been measured against projectM references."
```

**Finding #6 — `assets/data/milkdrop-parity/certification-corpus.json:3`**
This is a data file, not prose. Add a top-level note field:
```json
"parityTarget": "projectm-webgpu-certification-v1",
"certificationNote": "4 of 23 presets in this corpus are currently certified (see measured-results.json). The remaining 19 are targets for future certification.",
"presetCount": 23,
```

**Finding #7 — `docs/DEVELOPMENT.md:111–114`**
```
  To capture the certification corpus directly from `assets/data/milkdrop-parity/certification-corpus.json`
  instead of the checked-in visual-reference manifest, use:
+ (Note: only 4 of the 23 corpus presets have measured results. The corpus represents certification targets,
+ not completed certifications.)
```

**Finding #8 — `docs/DEVELOPMENT.md:155`**
```
- To run the certified parity suite against the checked-in visual reference manifest:
+ To run the parity suite against the checked-in visual reference manifest (currently 4 presets with
+ projectM reference images):
```
And line 161:
```
- This reads … resolves the latest Stims captures for each certified preset,
+ This reads … resolves the latest Stims captures for each preset in the visual reference manifest,
```

### Medium fixes

**Finding #9 — `docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md:1`**
```
- # MilkDrop projectM parity backlog
+ # MilkDrop projectM fidelity backlog (toward measured parity)
```

**Finding #10 — `docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md:1`**
```
- # MilkDrop successor workstreams
+ # MilkDrop-inspired successor workstreams
```

**Finding #11 — `docs/MILKDROP_PRESET_RUNTIME.md:1`**
```
- # MilkDrop Preset Runtime
+ # MilkDrop-Inspired Preset Runtime
```
And line 3:
```
- This document covers the shared runtime used by the shipped MilkDrop visualizer.
+ This document covers the shared runtime used by the shipped MilkDrop-inspired visualizer.
```

**Finding #12 — `docs/toys.md:6–7`** (auto-generated, fix generation source `scripts/generate-toy-manifest.ts`)
```
- ## MilkDrop Visualizer (`milkdrop`)
+ ## MilkDrop-Inspired Visualizer (`milkdrop`)
```

**Finding #13 — `docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md:23`**
```
- honest fidelity labeling are all wired.
+ the honest fidelity labeling pipeline is wired (4 presets have measured labels; 19 remain at inferred
+ fidelity until measured).
```

**Finding #14 — `README.md:52`**
```
- one flagship MilkDrop-led visualizer experience
+ one flagship MilkDrop-inspired visualizer experience
```

---

## Results

| Metric | Count |
|--------|-------|
| **Total overclaims found** | **14** |
| Critical | 4 |
| High | 4 |
| Medium | 6 |

**Single most damaging overclaim:** Finding #1 — `index.html:23` `<title>MilkDrop Visualizer | Stims</title>`. This is the page title served to every visitor, search engine, and social preview. It presents Stims as a MilkDrop implementation with no qualifier, directly contradicting the project's own `LINEAGE_AND_CREDITS.md` rule to "avoid implying official affiliation" and "pair successor claims with explicit lineage language." The description meta on the same page correctly uses "MilkDrop-inspired" — the title should match.

---

## Validation

All proposed fixes are text-only changes to prose, metadata, and data-file annotations. No code paths, tests, or build artifacts are affected. Once applied, run:

```bash
bun run check:quick
```
