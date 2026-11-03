# Stims Release Notes

Measurements describe the release they appear in; [implementation status](./IMPLEMENTATION_STATUS.md) has current capability limits, and the [changelog](../CHANGELOG.md) lists every change with its PR. Each section below is published as that version's GitHub Release (`bun run release:notes`).

---

## Release v1.5.0 (2026-10-21)

### 🌟 Release Highlights

- The editor says what moves a preset. Each Tune control names the audio that drives it (`eq · bass, mid, treb`), a fader shows the value the frame actually used beside its base value, Outline rows name the audio reaching each wave, shape and the per-pixel equations, and Solo and Mute cover every layer, including the main waveform, borders and motion vectors. Each custom wave and shape has its own Tune controls. All of it reads a static dataflow analysis of the compiled preset, so it works before any music plays.
- The editor treats a preset's warp and composite shaders as their own blocks: highlighted lines, compile errors that name backend, program and stage, and a Shader tab that lists the GLSL the GPU runs. A watcher HUD plots pinned variables over the stage, and comparing two versions says what an edit did to the audio reach ("zoom stopped listening to bass").
- Visual search in Browse. Nearby, By look and the Like your saved sort rank presets by embeddings of their rendered previews (EmbeddingGemma 2, 256 int8 values per preset), and a search made only of visual terms lists every preset whose preview looks like it: "tunnel" lists 28 presets instead of 7, and "galaxy" 12 instead of 3.
- Remix credit travels with the preset: share links and exported `.milk` files record the parents (`remix_of_N_id`, `_title`, `_author`), and every bundled preset now fits in a share link, where 16.8% did not.
- For performing: D blacks out the picture while held (two quick taps latch it), Y flashes white, a MIDI fader bound to crossfade drives the cue deck's hand fade, local audio plays several files as a playlist, and `?reduceFlashing=1` turns flash protection on for one visit on a shared screen.
- Every preset has a page search engines can read: `/presets/` lists all 2,488 indexable presets, author and collection pages list theirs in the raw HTML, a preset page names its preset and author and links its `.milk` file, and 19 more credited authors have pages.
- Four parts of Stims are standalone packages under `packages/`: `milkdrop-toolchain` (parser, EEL2 interpreter and JIT, shader translation, formatter, exporter, dataflow analysis), `flash-guard` (WCAG 2.3.1 flash analysis and the live governor), `audio-reactive` and `eel-conformance`. The app imports them as Bun workspaces with no build step and no second copy, and three are published on npm.

### ⚡ Engineering & Performance

- The first paint downloads 585 kB of JavaScript instead of 1,007 kB: the CodeMirror editor and `three/webgpu` left the boot path, and WebGL sessions never download `three/webgpu`. `check:bundle-size` fails a build that puts either back (#1357).
- The start page paints its headline from the HTML, and its largest contentful paint fell from 4.8 s to 2.7 s in Lighthouse's mobile run of a local production build; a `?preset=` page fell from 7.8 s to 5.5 s, and its layout shift from 0.09 to 0 (#1392).
- WebGL batches shapes and borders as WebGPU does, halving frame time on shape-heavy presets: `martin-the-bridge-of-khazad-dum` 4.49 → 2.30 ms on an M1 Max (#1355).
- Less CPU per frame in the JIT and the mesh: inlining the EEL random generator and reading a twice-used variable once took median frame work on `shifter-glassworms-flare` from 5.24 to 4.51 ms, and skipping per-vertex built-ins the per-pixel program never references took `eos-apocalypse` from 4.14 to 3.77 ms. Presets with an identity warp skip the mesh transform, and the outgoing preset of a crossfade runs at 75% detail (#1420, #1421, #1424).
- Preset switches on WebGPU compile the incoming preset's pipelines before the blend starts, holding the fade for up to 1.5 s while the old preset keeps playing. The 0.25–1 s freezes at a switch are gone; a 50–75 ms hitch mid-blend remains (#1422).
- Flash samples are read back in a worker, so Reduce flashing no longer holds the main thread for 2–3.6 ms a frame waiting on the GPU (#1375).
- A shared preset's social card is a JPEG of 96 KB median (296 KB at worst) instead of a 775–789 KB PNG, under the size at which chat apps drop the preview (#1485).
- Generated presets are checked by the real compiler instead of a parenthesis count, and one that compiles but renders near-black is labelled low-confidence (#1404).

### 🐛 Bug Fixes

- Editing and comparing no longer overwrite work: undo history restarts on each preset load, A/B compares your edit with the original, Reset is an undoable Revert to the original, drafts are saved only for real edits, and Refine shows a diff with Apply and Discard.
- Reduce flashing acts in production. The flash sampler read the canvas outside the task that drew it, so the governor never engaged outside agent mode; it now samples each frame as it is drawn and counts what the WCAG audit counts, and shuffle and autoplay skip measured flashers while it is on.
- More preset shaders compile on WebGL: HLSL `saturate`, `frac`, `lerp` and `atan2` are translated, assignments are wrapped in the target's type as HLSL broadcasts and truncates, and declarations above `shader_body` carry over.
- Stims boots where reading `localStorage` throws: sandboxed iframes, third-party frames and browsers that block site data.
- The iframe `postMessage` bridge answers truthfully: every `toil:*` command gets one status reply, `load_preset` waits until the stage shows the preset, and unknown ids come back with suggestions.
- A shared `#code=` link waits for its preset to load before restoring the edited source, and links to presets you made or imported carry their code.
- The first-run preset is `shifter-curlique`; its predecessor settled to black on a phone held upright on WebGPU.
- **Breaking for MCP clients:** the leftover toy tools are removed. Replacements: `get_toys` → `list_presets` / `get_preset_info`, `launch_toy` → `open_preset_url`, `describe_loader` → `read_doc_section`, and the toy screenshot/health tools → `capture_preset`.

---

## Release v1.4.0 (2026-10-01)

### 🌟 Release Highlights

- Pause: Space or the dock's transport button holds the picture, while the preset, history and audio session stay put. The preset-tuning keys are listed and rebindable (H blend/cut, W waveform, I zoom, O warp, J wave scale, `<` / `>` rotation), and the first nine Browse cards play from the number keys.
- Presets draw closer to MilkDrop. Presets without a warp shader animate through the feedback loop instead of drawing one static frame, fields a preset omits take projectM's defaults instead of 0, waves and shapes land where MilkDrop puts them (y up, full-width waves, wave modes 6 and 7, no main-wave trails), per-pixel `rad`/`ang` follow MilkDrop, and post effects use MilkDrop's curves.
- Preset switches crossfade again; a gate below the corpus minimum had made every switch a hard cut. During a crossfade the outgoing preset keeps running on its own deck, as it does in projectM.
- For performing: a cue deck runs the next queued preset with Take, Skip and a hand crossfade, autoplay waits for a downbeat, live performance mode (Shift+D) holds the quality step, MIDI gains notes, clock in and out and controller LEDs, and a webcam, a second display and a gamepad work as inputs.
- The editor gains an Inspect tab with live q1–q32 and every equation variable, named versions that survive a reload, preset-parameter knobs, a GLSL view, `.zip` pack import and MilkDrop 2 export. Format is lossless; it used to delete shader comments in 544 of 579 shader presets.
- A runtime flash governor applies the WCAG 2.3.1 rule the offline audit checks, and the cream-of-the-crop library grows from 40 to 895 presets through a gated ingest.
- One pitch across the site, link previews and README: "Play and live-edit MilkDrop presets in your browser". The README is less than half its old length, and the repository no longer carries 130 MiB of build output.

### ⚡ Engineering & Performance

- Per-pixel equations run on the GPU on WebGPU for 1,611 of the 1,619 bundled presets that have them; the planner lowers q1–q32, the screen and mesh sizes, `log10` and a 32-slot bus of per-frame scalars (`f8156c384`, `88df79354`, `58f985f78`).
- Seeded differential fuzzers hold the interpreter, JIT, GPU field lowering and compute VM to the same answers. Their first runs found 308 of 955 lowered per-pixel programs (32%) disagreeing between WebGPU and WebGL, now 955 of 955 agree, and 18 shipped blocks that could not JIT, now 0 of 38,406 (`ba4d5bdfa`, `95f50ed4a`).
- The CPU mesh transform builds its per-frame constants once per pass instead of per vertex: CPU-isolated `vm.step()` on `shifter-robotopia` 2.45 → 1.19 ms (p95 8.42 → 1.84 ms), `cope-ferrofluid` 1.06 → 0.35 ms (`ef60340cd`, `9565604d6`).
- Shape-heavy presets: on `martin-the-bridge-of-khazad-dum` the average frame (live rAF) went 33.8 → 8.6 ms on WebGL and 8.98 → 3.05 ms on WebGPU, from single-pass transparent materials and an instanced TSL shape batcher (`0ba121f02`, `ae1ead136`).
- Removing duplicate JIT stores took `eos-apocalypse` average frame work from 3.43 to 2.87 ms, and from 17.56 to 15.31 ms under 4× CPU throttle (Apple M1 Max, native WebGPU, quality step locked) (`9a4b789b6`).
- On an RG Vita Pro handheld (Mali-G52, Chromium 133) the first-run preset went from 10–20 fps to 60 fps locked, a preset switch from a ~3.7 s freeze to 0.3–0.7 s, and the WebGPU composite shader from 333 KB to 29 KB; 12 rapid switches hold at ~450–650 MB where the GPU process grew to 1.4 GB and was killed (#1209).
- Chrome for Android gets WebGPU and capable phones a higher pixel-ratio ceiling: a Galaxy S22 that rendered at ~43% of native resolution held 60 fps at ~8 ms a frame at 1.75–2.0×, and most of its preset switches drop no frames, where about half stalled for 300 ms–2 s (`79505b9d1`, `17f39b337`, `207158aaf`).
- WebGL compiles far more preset shaders: an offline scan of 2,679 presets went from 575 failing presets to 150, and the 511 presets that called MilkDrop 2's `GetPixel`/`GetBlur` helpers no longer render black (`6ee742723`, #1220, #1221, #1223, #1227, #1228, #1229). Matrix element writes execute directly on WebGPU, so 1,578 of the 1,750 Butterchurn presets run with no approximation on both backends (#1166, #1167).
- Lighter startup and deploys: the Strudel lab's dependencies leave the eager vendor chunk (228 KB → 12 KB gzipped), `dist/` shrinks from 269 MB to 42 MB, and median cold `shell-rendered` went 2,288 → 2,121 ms under 4× CPU throttle (`1f0b4d636`, `c2e4597a6`).
- Measurement that can say no: `lab:nan-sweep` steps all 2,679 presets with no browser in about 10 minutes, `lab:replay` replays a VM trace bit for bit, `lab:backend-diff` scores WebGL against WebGPU within each backend's noise, `lab:dataflow` traces audio to every variable (1 false negative in 215,160 checked cells), and the projectM parity oracle's certified count fell from 4/9 to 2/9 once it stopped passing frames a black image also passed (`22af8bdc8`, `9640d58e3`, `505d38772`, #1303, `575f13ca3`).
- Pushing a `vX.Y.Z` tag, or running the Release workflow on `main`, publishes a GitHub Release from these notes (#1324, #1326).

### 🐛 Bug Fixes

- A sweep of the 1,787 bundled presets found 342 rendering black, white or flat; the causes with a compile-level signature are fixed, among them 306 presets whose `equal()`, `sqr()` and bitwise calls the WebGPU per-pixel compiler dropped (#1206).
- Equations the parser had dropped run: `loop()` and `while()` in ~55 presets, and 64 statements that compiling the corpus discarded while reporting 0 errors (#1122).
- Live audio reaches presets wherever AudioWorklet runs; a linear byte mapping had flattened the bands (bass on the demo stream 0.006 → 0.676).
- Native WebGPU no longer mirrors the display or flips feedback each frame, no longer tone-maps presets without shaders, and keeps custom waves' per-point colour.
- The keyboard is no longer treated as a TV remote on every page, and closing a panel no longer reverts a preset change made in the same tick.
- Status messages no longer silence each other, the status toast no longer covers the Cue deck card, and fast preset switching no longer ratchets quality to the minimum.
- oEmbed titles name a preset's author once, and the cache and pool growth paths found in the #1105–#1111 series are bounded.

---

## Release v1.3.0 (2026-07-29)

### 🌟 Release Highlights

- Settings, the preset browse drawer and the dock are redesigned as a console-style workspace.
- Equations restored across the Butterchurn corpus: a transpiler converts its JavaScript equation strings back to MilkDrop EEL, recovering 157,950 statements, so 1,629 presets gained per-frame code and 1,068 per-pixel code, and 1,739 compile clean.
- Custom shapes draw every instance (`shapecode_N_num_inst`), which 304 bundled presets declare, and the expression language gains `randint`, `log10` and `gmegabuf`.

### ⚡ Engineering & Performance

- VM program blocks compile to one JavaScript function each instead of one per statement, cutting VM CPU cost from 2.00 ms to 1.10 ms a frame (`c065a6823`).

### 🐛 Bug Fixes

- The custom shape radius floor is 0.002 instead of 0.04, so MilkDrop's instanced dot fields keep their authored size.
- Microphone permission errors say what to do, a missing or busy device falls back with its own message, and capture works on mobile browsers.

---

## Release v1.2.0 (2026-07-24)

### 🌟 Release Highlights

- A header bar over the stage shows the preset title, author and an eight-bar audio level meter.
- The app source moved from `assets/` to `src/`, and the tests into `tests/{unit,compat,corpus,e2e}`, with each test profile taken from its folder.

### ⚡ Engineering & Performance

- Compiled presets (up to 50) and JIT-compiled expressions (up to 2,000) are cached, and Browse search is debounced (`c87525cdd`).

### 🐛 Bug Fixes

- The workspace requests the microphone with music-oriented constraints (no echo cancellation, noise suppression or auto gain control); a bare request had skipped them on the main path and misbehaved on mobile (#1078).
- Preset search ignores punctuation, matches each word of a multi-word query and finds presets by collection name.
- Hashed assets and API calls bypass the service worker, which no longer caches HTML for non-navigation requests.

---

## Release v1.1.0 (2026-07-19)

### 🌟 Release Highlights

- Stims became a MilkDrop preset player. A `.milk` parser, an EEL evaluator, a compiler, a per-frame VM, a three.js renderer and a live CodeMirror editor arrived in March 2026, replacing the HTML toy library, and a React workspace followed in April.
- 1,748 Butterchurn presets were imported, taking the catalog from 43 to 1,791 entries.
- Presets render on WebGL and WebGPU, and on WebGL with MilkDrop 2's separate warp and composite passes and blur targets.
- Parity captures are compared with frames rendered by native projectM 3.1.12; `250-wavecode` is certified on WebGPU, and three of the four shipped presets remain uncertified.
- An MCP server and tools let agents list, search and drive presets.

### ⚡ Engineering & Performance

- Equations compile to JavaScript functions (the EEL JIT), per-pixel equations run in the WebGPU fragment shader through an expression-to-TSL compiler, and WebGPU draws with render bundles (`c09e9fe2e`, `f0c73fa85`, `bf3b45a0e`).
- The loose HTML pages became one project: Vite and TypeScript (June 2025), Bun and a Cloudflare Pages build (December 2025), and Biome (January 2026).

### 🐛 Bug Fixes

- The 2D and volume noise textures use projectM's memory layout.
- The light theme's muted text, lines and accents are darker, and high-contrast and forced-colors modes have their own rules.

---

## Release v1.0.0 (2024-11-02)

### 🌟 Release Highlights

- 16 standalone HTML pages, most reacting to microphone input, with an index linking 10 of them, among them the Defrag Visualizer and the Multi-Capability Visualizer.
- No build step: pages load three.js from cdnjs or draw with raw WebGL, WebGPU or Canvas 2D, and the Multi-Capability Visualizer tries WebGPU before falling back to WebGL.
