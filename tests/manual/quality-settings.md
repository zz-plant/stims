# Quality settings manual checklist

Use this checklist to confirm the shared quality panel is wiring into multiple toys without reloading the page.

1. Open `toy.html?toy=cube-wave` via the dev server.
2. In the floating "Grid visualizer" panel, switch Quality preset to **Battery saver**.
   - Expect the renderer to soften (pixel ratio capped) and the grid to rebuild with fewer items.
3. Switch Quality preset to **Hi-fi visuals**.
   - Expect a denser grid and sharper output while audio stays running.
4. Change the **Shape** dropdown and confirm the grid swaps primitives without stopping audio.
5. Open `toy.html?toy=cosmic-particles` and verify the panel remembers the last preset.
6. Toggle between **Orbit** and **Nebula**, then change quality presets.
   - Expect particle counts to increase/decrease without a page reload, while the active scene reconfigures in place.
