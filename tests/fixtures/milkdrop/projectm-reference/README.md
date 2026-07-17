# projectM visual reference fixtures

This directory stores checked-in reference renders captured from `projectM` for certified visual-parity checks.

The source of truth for this fixture set is:

- [`assets/data/milkdrop-parity/visual-reference-manifest.json`](../../../assets/data/milkdrop-parity/visual-reference-manifest.json)

Each promoted native projectM preset must include:

- a reference image,
- a native capture metadata sidecar,
- a manifest entry with:
  - preset id,
  - title,
  - strata,
  - tolerance profile,
  - capture resolution,
  - provenance for the imported artifact.

Native capture flow on Apple Silicon macOS:

1. Install Homebrew `projectm`. The formula includes `projectMSDL`, `libprojectM`, and the SDL2 compatibility dependency; there is no separate `projectmsdl` formula.
2. Capture one isolated upstream fixture into a review-only directory:

   ```bash
   bun run parity:capture:projectm-native -- \
     --preset 100-square \
     --output /tmp/stims-projectm-review
   ```

   The harness compiles against `/opt/homebrew/opt/projectm` and `/opt/homebrew/opt/sdl2`, creates a hidden native SDL/OpenGL context, injects stereo silence, calls native `projectM::renderFrame` 300 times with projectM configured for 60 FPS at 1280x720, and reads `GL_BACK`. It does not add a second sleep/throttle and does not invoke the Stims renderer or browser VM. The recorded duration is nominal (`frames / configured FPS`), not a claim about wall-clock scheduling in a particular Homebrew build. Preset IDs must be safe filename stems, and the fixture root must resolve inside the repository.
3. Review both `100-square.native-projectm.png` and `100-square.native-projectm.json`. Re-run the command into a second directory and compare the image SHA-256 before treating a static fixture as repeatable.
4. Promote the reviewed pair directly:

   ```bash
   bun run parity:promote-reference -- \
     --preset 100-square \
     --source-image /tmp/stims-projectm-review/100-square.native-projectm.png \
     --source-meta /tmp/stims-projectm-review/100-square.native-projectm.json \
     --strata projectm-upstream,geometry,regression
   ```

5. Commit the copied image, copied sidecar, and visual-reference manifest update together only after review.

Promotion rejects images without a valid native sidecar. It recomputes and binds the sidecar to the current upstream fixture SHA-256 and checked-in harness SHA-256, in addition to checking the image SHA-256, dimensions, preset ID, frame count, FPS, silence input, and framebuffer source. ProjectM and SDL versions/library hashes plus macOS and OpenGL details are recorded separately as `capture-host-only` external runtime provenance; they describe the capture machine but are not checked-in identity anchors.

The command intentionally leaves captures at `promotionStatus: "review-required"`; it never imports or promotes them automatically. It stages the image and sidecar in a temporary directory, deletes that directory in `finally`, and publishes neither file if render or teardown exits nonzero. On macOS, explicit `SDL_DestroyWindow` after a successful hidden capture intermittently crashed inside SDL2-compat with `SIGSEGV`; the harness now deletes the GL context and lets `SDL_Quit` release the remaining window, which completed 30 repeated teardown probes. Native projectM may still emit an OpenGL warning about an unloadable texture for `100-square`; independently captured images must be inspected and hash-compared.

Legacy files in this directory whose provenance says `checked-in output/playwright projectM capture` do not satisfy the native sidecar contract. Do not use or re-promote them as native projectM oracle evidence; recapture them through the native command first.
