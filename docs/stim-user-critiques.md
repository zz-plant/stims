# User-Focused Critiques by Toy

This guide captures user-standpoint critiques for each Stim toy based on the current registry metadata, helping prioritize onboarding, controls, and clarity improvements alongside visual polish.

## Toy-specific priority implementation set (P0 + P1 only)

This scoped set intentionally includes only toy-level P0 and P1 actions from the wider fun/aesthetic backlog.

## Prioritized change plan (code + specs)

This sequence prioritizes **time-to-delight in the first 60–120 seconds** and focuses on reducing setup/tuning burden before visual payoff.

### 1) P0 — Ship instant-pleasing defaults for toys that currently require too much tuning

Target toys:

- `lights`
- `aurora-painter`
- `bioluminescent-tidepools`

Code changes:

- Add per-toy one-click starter presets tuned for immediate “best look.”
- Add a toy-shell `Try best preset` affordance that is visible on first load.
- Apply starter presets automatically for first-run sessions unless users opt out.

Spec/doc changes:

- Add a “first-look preset” requirement to toy UX expectations.
- Document each toy’s default preset values in `docs/toys.md`.

Success criteria:

- Users reach a visually pleasing state without touching advanced controls.
- Lower first-session control thrash (fewer setting toggles before sustained viewing).

### 2) P0 — Add explicit visual feedback for low-reactivity/perceived-passive toys

Target toys:

- `geom`
- `holy`
- `star-field`

Code changes:

- Add mic/demo activity meters or pulse indicators where audio linkage is currently unclear.
- Add a single high-impact intensity control surfaced in the primary control row.
- Ensure demo-audio path is obvious and one tap away from toy load.

Spec/doc changes:

- Define a minimum “reactivity visibility” rule: each toy should expose at least one always-visible reactive indicator.
- Add expected fallback behavior for quiet environments and no-mic sessions.

Success criteria:

- Toy no longer appears inert in quiet rooms.
- Users can see clear cause-and-effect from audio in under 10 seconds.

### 3) P1 — Improve discoverability for toys with high interaction complexity

Target toys:

- `clay`
- `seary`
- `cube-wave`

Code changes:

- Add lightweight first-use overlays (single-step or two-step maximum).
- Add in-context labels for mappings/modes and active-state feedback.
- Add mode labels and transition cues where effect differences are subtle.

Spec/doc changes:

- Add a toy onboarding microcopy checklist (verbs + expected result).
- Add mapping legend requirements for toys with non-obvious frequency/visual correspondence.

Success criteria:

- New users can identify “what this control does” without trial-and-error loops.
- Faster discovery of at least one high-reward interaction per session.

### 4) P1 — Normalize “wow path” metadata so the shell can guide users consistently

Target: all toys.

Code changes:

- Extend toy metadata with fields for `starterPreset`, `wowControl`, and `recommendedCapability`.
- Use metadata to drive shell hints and optional guided prompts.

Spec/doc changes:

- Update metadata schema docs with required/optional fields and examples.
- Add validation checks ensuring each featured toy defines at least one wow-path hint.

Success criteria:

- The shell can generate toy-specific guidance without hardcoded per-toy logic.
- Featured toys present consistent first-run guidance quality.

### 5) P2 — Session-level stimulation enhancements after toy-level baseline is fixed

Target: shell and homepage.

Code changes:

- Add `Surprise me` entry point biased toward high-reactivity toys.
- Add a global `Party mode` profile that raises intensity safely.

Spec/doc changes:

- Add A/B test plan and telemetry definitions for first-session delight metrics.

Success criteria:

- Improved time-to-first-delight and repeat toy exploration rates.

### P0 toy actions

- `geom`: add a visible mic-level meter and an obvious demo-audio path in the toy shell.
- `holy`: expose simple first-screen intensity and palette controls.
- `bubble-harmonics`: add split sensitivity and a manual demo split trigger.
- `lights`: add curated starter presets and a shuffle option for quick “best-of” looks.

### P1 toy actions

- `aurora-painter`: add a one-click starter preset and progressive disclosure for advanced controls.
- `clay`: add a “first sculpt” overlay with animated affordances for core tools.
- `evol`: add a “boost reactivity” toggle to strengthen audio linkage.
- `seary`: label frequency-band-to-visual mapping near controls.
- `legible`: add cadence controls and explicit audio linkage hints.
- `cube-wave`: add a prominent mode toggle with clear active-state feedback.
- `spiral-burst`: add beat sensitivity and a pulse indicator.
- `neon-wave`: add a “soft glow” accessibility preset.

## 3D Toy (`3dtoy`)
- Strength: The twisting tunnel premise is easy to understand and promises immediate audio feedback.
- Friction: As an archived toy, it may feel less polished or consistent with newer UI patterns.
- Opportunity: Add a quick hint about which frequencies drive the tunnel so users feel in control.

## Aurora Painter (`aurora-painter`)
- Strength: The “paint aurora ribbons” pitch and gestural controls signal creativity and depth.
- Friction: Multiple controls (density, pinch/rotate, mood switching) can overwhelm first-time users.
- Opportunity: Offer a one-click “starter” preset or tooltip to surface the strongest effect quickly.

## Pottery Wheel Sculptor (`clay`)
- Strength: Sculpting is a clear, tactile activity with high engagement potential.
- Friction: Tool sets (smoothing/carving/pinching) can be hard to discover without guidance.
- Opportunity: Add a lightweight “first sculpt” overlay or animated affordances.

## Evolutionary Weirdcore (`evol`)
- Strength: Surreal, evolving landscapes promise novelty and replay value.
- Friction: Abstract effects can feel disconnected if audio reactivity is subtle.
- Opportunity: Provide a “boost reactivity” toggle to make the music link obvious.

## Microphone Geometry Visualizer (`geom`)
- Strength: Direct mic-driven geometry implies strong user agency.
- Friction: Quiet environments can make it feel inert or unresponsive.
- Opportunity: Add a visible mic-level meter and an obvious demo-audio path.

## Halo Visualizer (`holy`)
- Strength: Layered halos and particles suggest a rich, hypnotic mood.
- Friction: If interactions are minimal, users may perceive it as passive.
- Opportunity: Expose a simple intensity/palette control for immediate agency.

## Multi-Capability Visualizer (`multi`)
- Strength: Combines sound + device motion for a more embodied experience.
- Friction: WebGPU and motion permissions can block entry on some devices.
- Opportunity: Add a clear preflight screen plus “try without motion” guidance.

## Synesthetic Visualizer (`seary`)
- Strength: Promises tight audio-visual mapping and cohesive patterns.
- Friction: Mapping may be opaque to new users.
- Opportunity: Label which frequency bands map to which visual elements.

## Terminal Word Grid (`legible`)
- Strength: Retro text grid and live word surfacing is distinctive.
- Friction: Users may not see how audio changes influence word timing.
- Opportunity: Offer word cadence controls and clearer audio linkage hints.

## Spectrograph (`symph`)
- Strength: Gentle motion is calming and approachable.
- Friction: Some users may want stronger motion in louder environments.
- Opportunity: Add a sensitivity slider or intensity toggle.

## Grid Visualizer (`cube-wave`)
- Strength: Mode switching between cube waves and spheres adds variety.
- Friction: Mode changes may feel subtle without clear UI feedback.
- Opportunity: Provide a prominent mode toggle with visible state.

## Bubble Harmonics (`bubble-harmonics`)
- Strength: The bubble split on high frequencies feels playful and reactive.
- Friction: Users without high-frequency input may miss the split effect.
- Opportunity: Add a demo trigger or sensitivity adjustment for splits.

## Cosmic Particles (`cosmic-particles`)
- Strength: Dual modes (orbiting swirls + nebula fly-through) add breadth.
- Friction: Switching can disrupt flow if the transition is jarring.
- Opportunity: Use smoother transitions and explicit mode labels.

## Audio Light Show (`lights`)
- Strength: Shader and palette swapping supports personalization.
- Friction: Without a “best-of” starting look, users may not land on a satisfying style.
- Opportunity: Add curated presets or a shuffle button for quick exploration.

## Spiral Burst (`spiral-burst`)
- Strength: Beat-synced expansion encourages rhythmic engagement.
- Friction: Beat detection can feel soft if sensitivity is low.
- Opportunity: Provide a beat sensitivity slider or pulse indicator.

## Rainbow Tunnel (`rainbow-tunnel`)
- Strength: Continuous motion and color produce immersive flow states.
- Friction: Constant forward motion may be fatiguing for some users.
- Opportunity: Add speed control or a stationary camera option.

## Star Field (`star-field`)
- Strength: Soothing visuals for ambient listening.
- Friction: Lack of interactivity can feel passive.
- Opportunity: Add twinkle intensity or parallax controls.

## Fractal Kite Garden (`fractal-kite-garden`)
- Strength: Explicit density + palette controls promote customization.
- Friction: “Pattern density” may be ambiguous without feedback.
- Opportunity: Show a small preview or tooltip on density changes.

## Tactile Sand Table (`tactile-sand-table`)
- Strength: Audio + tilt control offers tactile depth.
- Friction: Desktop users may not realize tilt is a key feature.
- Opportunity: Add a clear “try on mobile for tilt” hint and desktop fallback messaging.

## Bioluminescent Tidepools (`bioluminescent-tidepools`)
- Strength: Drawing glowing currents plus sparkle feels novel and expressive.
- Friction: Users might not know which control most affects the wow factor.
- Opportunity: Highlight “glow strength” or provide a guided preset.

## Neon Wave (`neon-wave`)
- Strength: Synthwave + bloom visuals are recognizable and strong.
- Friction: Heavy bloom can be harsh for sensitive users.
- Opportunity: Provide a “soft glow” accessibility toggle.

## MilkDrop Proto (`milkdrop`)
- Strength: The MilkDrop-inspired feedback engine promises power-user depth.
- Friction: “Proto” implies rough edges and may confuse expectations.
- Opportunity: Add a short “what this is” primer and a suggested preset.
