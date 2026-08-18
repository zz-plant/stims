# Top 20 Impact Opportunities — August 2026

A ranked audit of the biggest-leverage improvements across performance, user
experience, preset fidelity, and audit posture, grounded in a full codebase
exploration plus the repo's own measured artifacts. Each entry records what
was **done in the accompanying PR** and what remains.

Baselines that anchored the ranking:

- Stored Lighthouse run (`tests/accessibility/lighthouse.json`, 2026-06-19,
  mobile): **Performance 0.33** (TBT 7,820 ms, TTI 15.2 s, LCP 6.9 s);
  Accessibility 1.00, Best-practices 0.96, SEO 1.00.
- Checked-in WebGPU certification report: 6 presets with measured visual
  failures, including shipped `rovastar-parallel-universe` at ~98% pixel
  mismatch; 62 of 71 corpus presets unmeasured.
- The compiler's fidelity classifier returned `exact` for 1,750/1,750
  bundled presets because its gap tables were empty constants.
- No default-on flash-safety control despite ~1,800 community presets
  imported without photosensitivity review.

## Tier 1

### 1. Startup performance (Lighthouse 0.33)
**Area:** Performance / audit. The worst number in the repo: TBT 7.8 s,
TTI 15.2 s, 95%-unused CSS, 249 KiB unused JS.
**Done:** Meyda (~100 KB, only needed on the AnalyserNode fallback) and
stats-gl (debug-only) converted to dynamic imports — both verified as
lazy-loaded chunks in the build; `editor-panel.css` (33 KB) moved into the
lazy EditorPanel chunk; bundle-size budget added (`check:bundle-size`).
**Remaining:** `vendor-three` is 64% unused on the landing path — splitting
the three.js surface the launch screen actually uses is the next big win.
Re-run Lighthouse after deploy to re-baseline.

### 2. Catalog delivery
**Area:** Performance. `catalog.json` (1.75 MB) and `search-index.json`
(1.13 MB) re-downloaded on every load: no cache headers, network-first
service worker that also blocked responses on `cache.put`.
**Done:** `_headers` now serves catalog JSON with
`max-age=3600, stale-while-revalidate=604800`; the service worker serves
`/milkdrop-presets/*` and `/textures/*` cache-first with background
revalidation and hands cache writes to `event.waitUntil` instead of blocking
the response (regression test updated to pin the new contract).
**Remaining:** parse the catalog in a worker (comlink is already a dep) —
the ~80–150 ms main-thread `JSON.parse` block is untouched.

### 3. Make the fidelity classifier real
**Area:** Fidelity / audit. `classifyFidelity` returned `exact` for every
preset; corpus "support" tests were vacuous; unknown EEL identifiers
silently evaluated to 0; the 169 presets whose shaders run directly on
WebGL but degrade to scalar approximation on WebGPU produced no evidence.
**Done:** asymmetric shader translation now emits `shader-text-translated`
partial backend evidence; unknown EEL identifiers emit a compile diagnostic
and `unknown-function` evidence. Measured corpus truth now: **1,577 exact,
169 WebGPU-partial (packed `sampler_fc_main` gap), 9 partial with unknown
identifiers** — and `tests/corpus/butterchurn-corpus-support.test.ts` pins
those counts as a regression baseline in both directions.
**Remaining:** the packed-sampler gap itself (exposing the feedback
composite texture to WebGPU direct execution) — closing it would move ~169
presets back to exact for real. Also of note: one preset's unknown
identifier is `else`, which suggests an EEL `if/else` parsing gap worth a
look.

### 4. Fix the six presets with measured visual failures
**Area:** Fidelity. Named, reproducible, checked-in failures
(`webgpu-certification-report.json`): `rovastar-parallel-universe` 98%
mismatch on both backends (a shipped bundled preset), `eos-phat-cubetrace-v2`
and `krash-rovastar-cerebral-demons-stars` 10–23%, plus three compshader
fixtures. Threshold is 0.04.
**Done:** stale doc claims corrected (the backlog understated unmeasured
count by 4×). Not attempted here: the renders themselves need iteration
against the native projectM references.
**Remaining:** the actual fixes — highest-leverage single fidelity task in
the repo since the failures are already measured and reproducible.

### 5. Flash safety
**Area:** Safety / audit. Roadmap exit criteria unmet: no default-on
flash-rate cap, red-flash criterion unimplemented, audit runs incomplete
(16/50 timeouts), only synthetic audio measured.
**Done:** the WCAG red-flash criterion (saturated red `R/(R+G+B) ≥ 0.8`,
value delta > 20, same area/pairing/3-per-second machinery) is implemented
in `flash-analysis.ts`, wired through the capture harness
(`analyze-preset-flash.ts`), and unit-tested — including the case a
luminance-only criterion misses. The known-invalid `lab:flash-risk`
placeholder now prints a prominent not-a-WCAG-instrument warning.
**Remaining:** a full-corpus audit run (needs a GPU-capable environment and
the timeout tail fixed — `PAGE_RECYCLE_EVERY` may need to drop further), a
corpus threshold test in `tests/corpus/`, real high-energy audio stimulus,
and the user-facing flash-limit control itself (a product decision: an
intensity limiter between "full motion" and the existing freeze-all).

### 6. Honor prefers-reduced-motion
**Area:** Accessibility (WCAG 2.3.3). `reducedMotion` was computed and then
ignored — `workspace-hooks.ts` gated the full-screen animated attract mode
on `lowPower` with a comment falsely claiming reduced-motion was folded in.
**Done:** attract mode now checks `profile.reducedMotion` explicitly; the
high-contrast preference seeds from `prefers-contrast: more` when no in-app
choice is stored. (The "Motion control" toggle turned out to be device-tilt
steering, not animation — and `view-transition.ts` already honored the OS
flag — so no change was needed there.)

### 7. Renderer Proxy bound-method churn
**Area:** Performance. Every `renderer.*` access minted a fresh bound
closure (~30–60/frame) and made frame-path call sites megamorphic.
**Done:** bound methods cached per live renderer instance with automatic
rebinding on renderer recreation; redundant `set` writes skipped.

### 8. Browser Back
**Area:** UX. Only `replaceState` was ever used, so Back from an open
bottom sheet exited the site — the single biggest everyday mobile
navigation defect.
**Done:** opening a panel pushes a history entry (Back now closes the
sheet); every other route change stays a replace so history isn't flooded.

## Tier 2

### 9. Surface silently-degraded WebGPU presets — folded into #3 (done).

### 10. Loading states for lazy panels
**Area:** UX. All nine lazy panels used `Suspense fallback={null}` — a
blank sheet during chunk loads that are seconds long on cold caches.
**Done:** skeleton-row fallback (`role="status"`) for both the panel sheet
and the launch screen.

### 11. Measured reactivity instead of keyword tags
**Area:** UX / fidelity. `collection:audio-reactive` is a title-regex match
(1,391/1,787 presets); sampled measurement shows ~8% of the catalog barely
reacts; `reactivity-probe.ts` measures properly but only feeds AI
generation. Divergent accumulators go unclamped (`wave_r` std-dev observed
at 2.85e9 in one preset).
**Done:** nothing in this PR (corpus-scale measurement run required).
**Remaining:** run `lab:reactivity` corpus-wide, store scores in the
catalog, rank default recommendations by them, and add a swing-magnitude
ceiling detector to the corpus suite.

### 12. Wire the continuous DRS controller
**Area:** Performance. A unit-tested PID resolution scaler
(`continuous-drs.ts`) sits unwired while the shipping path uses the
discrete step-hunting it was written to replace.
**Done:** the adjacent win — the live tile pool (up to 10 extra WebGL
engines ≈ 30% of a core while browsing) now follows adaptive-quality
degradation via `engine-quality-store.ts` and sheds engines under load.
**Remaining:** the DRS wiring itself.

### 13. Frame-state cloning on the low-quality path
**Area:** Performance (mobile). 120–180 large object clones per second
imposed exactly on weak devices.
**Done:** the shared `createEnv` prototype-write deopt is fixed (guarded
`Object.setPrototypeOf`, benefiting shape and wave builders every frame).
The clone rework itself is deferred: the derived state's retention contract
across the adapter seam and 10-engine tile pool isn't locally provable, and
a shared scratch object would risk cross-engine aliasing. See the rewritten
`FRONTEND_PERFORMANCE_BOTTLENECKS.md` for the fix shape.

### 14. Keyboard-focus-safe auto-hide
**Area:** Accessibility (WCAG 2.4.7). Stage controls went
`visibility: hidden` under a focused control after 3 s, dropping focus to
`<body>`.
**Done:** `:focus-within` escape hatch in the CSS (the hard guarantee) plus
`focusin` as an activity signal. Note: the repo's passive-guidance design
(pinned by `app-shell-passive-guidance.test.ts`) intentionally excludes
dismiss buttons on transient hints — that product decision was honored, so
WCAG 2.2.1 dismissibility for hints remains a deliberate trade-off, not an
oversight.

### 15. A11y quick wins
**Area:** Accessibility / audit.
**Done:** Label-in-Name failures fixed on the three primary CTAs (redundant
aria-labels removed — visible text is the accessible name; WCAG 2.5.3
Level A, breaks Voice Control); a screen-reader `<h1>` persists in live
mode; `--stims-ink-dim` raised to ~5.9:1 and the light-theme accent
darkened so white CTA text clears 4.5:1; the accessibility audit script is
now headless-by-default so it can join CI (`HEADFUL=1` to watch locally);
external troubleshooting links announce "(opens in a new tab)".
**Remaining:** wire `check:accessibility` into the quality gate; add an
automated contrast assertion.

### 16. WebGL-failure dead end
**Area:** UX. The no-GPU overlay promised a compatibility mode it never
offered — its only action reloaded into the same failure.
**Done:** a "Try compatibility mode" button (same recovery as the error
boundary) plus honest copy.

### 17. First-run experience
**Area:** UX. Two of three onboarding hints were unreachable dead code: they
fired exactly when a panel opened, but the component unmounted whenever a
panel was open — and `IMPLEMENTATION_STATUS.md` marks the feature done.
**Done:** `ContextualHelp` renders regardless of open panels, and the CSS
rule that hid it under open sheets is removed, so browse/editor hints
actually appear on first use.
**Remaining:** the P0 time-to-first-delight items from
`stim-user-critiques.md` (starter presets, visible reactivity indicator).

### 18. SEO: doorway-page risk and the internal link graph
**Area:** SEO. `/discover/<slug>` synthesized a unique self-canonical page
for ANY slug (unbounded thin-page space — a penalty risk hiding behind the
1.00 score), while zero discover hubs appeared in any sitemap and the 1,787
preset URLs had no internal linking.
**Done:** curated slug allowlist (`functions/discover-slugs.ts`) gates the
middleware; the 14 hub URLs are in `sitemap-1.xml` and the homepage
crawl-links nav; the previously-untested HTMLRewriter middleware (which
holds every preset URL's canonical) now has unit coverage via a recording
mock — including the collapse case where a silent no-op would have pointed
1,787 canonicals at `/`.
**Remaining:** hub pages render app-shell content only — giving them real
per-topic preset listings (and per-preset related links) is the next step.

### 19. Make the quality gate tell the truth
**Area:** Audit. The gate validated catalog *shape*, never catalog *truth*.
**Done:** catalog integrity now consumes `preview-failures.json` (a
known-black preset can no longer ship with `preview: true` — the one
existing offender is fixed); a bundle-size budget exists; the committed
low-resource perf baseline that was 70/71 `ERR_CONNECTION_REFUSED` is
deleted rather than masquerading as data; the corpus support test asserts
measured reality (see #3).
**Remaining:** a CI-safe visual smoke path (the only pixel-level regression
suite is `test.skip` in CI), and a regenerated, valid perf baseline via
`perf:low-resource` on a GPU-capable machine.

### 20. Measured visual coverage and stale claims
**Area:** Fidelity / audit. Only 3/1,787 presets have measured parity
results; 62/71 certification-corpus presets are unmeasured; 14 bundled
presets ship with zero equations (static frames); parity docs disagreed
with the checked-in report.
**Done:** doc claims corrected against the actual report;
`FRONTEND_PERFORMANCE_BOTTLENECKS.md` rewritten (its top findings were
already fixed and would have sent auditors chasing solved issues).
**Remaining:** capture the 62 missing projectM references (the single
highest-leverage unblock for every measured metric), and re-transpile or
retire the 14 zero-equation presets
(`fishbrain-*-witchcraft*`, `reenen-geiss-*feedback*`, `cope-ferrofluid`,
etc.).

## Deferred with rationale

- **`visualEvidenceTier` default flip** (compiler claims `reference-suite`
  visual evidence for presets with no reference): the honest default is
  `runtime`, but the change cascades through catalog regeneration across
  1,787 entries and multiple store projections — do it as its own reviewed
  change. The `visualCertification` layer already carries the honest label
  user-side.
- **Content-hashed catalog filename** (`immutable` caching): touches every
  reference to `catalog.json` across scripts and SW precache; the
  stale-while-revalidate headers capture most of the win at 1% of the risk.
- **Stage `--energy` pulse per-frame publisher**: needs a small engine-seam
  API addition; see the bottlenecks doc.

## What is already strong (do not re-litigate)

Focus trapping with restore, ~25 correctly-scoped live regions, a working
skip link, `aria-expanded` discipline under test, thorough
`prefers-reduced-motion` CSS blocks, an excellent `getUserMedia` error
taxonomy with actionable copy and demo fallback, safe-area insets and 44 px
touch targets, correct 30-on-60Hz frame pacing, zero TODO/FIXME markers in
`src/js`, and a genuinely strong measurement culture (deterministic parity
artifacts, provenance-checked native references, honest certification
labels). The gaps in this report are the exceptions.
