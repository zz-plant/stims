# Tactile Sand Table Notes

Use these quick references when launching or testing the tactile sand table toy:

- **Controls**
  - _Grain size_ adjusts the displacement height of the sand ripples so you can go from shallow grooves to tall dunes.
  - _Damping_ controls how quickly waves settle—higher values calm the table, lower values keep motion lingering.
  - _Gravity lock_ freezes gravity to a neutral, downward pull. Handy on desktop or when you want a stable plane.
  - _Re-center_ resets both gravity and lock state to the default downward orientation.
- **Audio mapping**
  - Low frequencies drive the deepest ripple punches; mids add secondary rings. Quiet passages leave the surface nearly flat.
- **Mobile tilt**
  - On phones and tablets with motion access, tilting the device steers the gravity vector so sand slides toward the low edge. If motion isn’t available or permissions are denied, the toy falls back to a gentle downward pull.
- **Desktop defaults**
  - Desktop browsers without motion data start with the gravity lock engaged. Unlock to animate the table with the default gravity vector and still use audio-driven ripples.
- **Performance tips**
  - Drop the quality preset to cap pixel ratio on battery-constrained devices, and reduce grain size plus increase damping if frame times climb.

# Toy notes and presets

## Bioluminescent Tidepools

- **Summary:** Draw rippling currents of light; metaball tides bloom with your mic’s crisp highs and sprinkle reactive sparks when treble peaks hit.
- **Suggested presets:**
  - Chill glow: trail length `2.8`, glow strength `1.0`, current speed `0.8`.
  - Punchy surf: trail length `1.8`, glow strength `1.4`, current speed `1.2`.
  - Night drift: trail length `3.4`, glow strength `0.9`, current speed `0.6`.

## Sunset candidates

If we need to trim the catalog, these five stims are the best sunset picks based on overlap or maintenance drag:

- **Defrag Visualizer (`defrag`)**: overlaps with other audio-reactive retro visuals without a unique interaction loop.
- **Pattern Recognition Visualizer (`sgpat`)**: similar motion language to other geometric toys, but with fewer controls and polish.
- **SVG + Three.js Visualizer (`svgtest`)**: mostly a hybrid-tech demo and duplicates visual goals covered by more refined stims.
- **Interactive Word Cloud (`words`)**: voice-driven idea is solid, but the interaction is slow compared to newer text toys.
- **Star Guitar Visualizer (`brand`)**: fun homage, yet narrow in scope and easier to retire than core, reusable modules.
