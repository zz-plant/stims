# Quality settings manual checklist

Use this checklist to confirm the dedicated `/milkdrop/` settings surface applies quality changes without restarting the active session.

1. Open `/milkdrop/` via the dev server.
2. Start a session with **Demo audio** so the visualizer is actively animating.
3. Open the settings surface and switch Quality preset to **Battery saver**.
   - Expect the renderer to soften and detail density to step down while audio keeps running.
4. Switch Quality preset to **Hi-fi visuals**.
   - Expect a sharper image and denser rendering without a page reload or session restart.
5. Change to a different preset from the browse panel.
   - Expect the session to stay on `/milkdrop/`, with the chosen quality preset still applied.
6. Return to the settings surface and confirm the selected quality preset is still reflected in the controls.
