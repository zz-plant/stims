# Use Stims

Open [toil.fyi](https://toil.fyi/) to play a MilkDrop preset, edit it while it runs, and share the result. Start with demo audio to try the workflow before granting microphone or screen-sharing permission.

## Play and choose audio

The root workspace contains the stage, preset browser, editor, and settings. Select a preset in Browse to load it into the stage. Search by title, author, or tags; use collections to narrow the catalog.

Audio options depend on your browser:

| Source | What to expect |
| --- | --- |
| Demo | A built-in sample; playback may require a click because of autoplay policy |
| Microphone | Requires microphone permission and a secure context |
| Audio file | Choose or drop one or more local files the browser can decode |
| Tab or screen capture | Chrome or Edge on a desktop: choose a tab or screen and enable audio in the browser's picker. Firefox and Safari share no audio, so Stims does not offer it there |
| YouTube | Same browsers as tab capture: the YouTube controls feed the player's sound through a share of this tab |

Every source is analysed in the browser; Stims never uploads the audio.

Several files play as a playlist: each track advances to the next, and the list starts again after the last. While a playlist plays, Previous track and Next track appear in the audio panel and the dock's audio menu, and your system's media keys skip tracks.

A moving stage does not prove that external audio reached it. Check the audio status, then listen or change the input to confirm the intended source. If capture is unavailable or permission is denied, select demo audio or a local file.

## Edit a preset

1. Choose **Edit this visual** to open the studio.
2. On a first edit, use **Add a slow spin**, or change the source directly.
3. Use the tabs under the code:
   - **Tune**: sliders, switches and colours for each field. A field the equations recompute names the audio that reaches it.
   - **Outline**: the preset's parts with their line ranges, and solo or mute for each wave, shape and layer.
   - **Insert**: technique recipes, each added to the block it belongs in.
   - **Reference**: every built-in function and variable, searchable, inserted at the cursor.
   - **Assist**: AI refinement, when a provider is configured (see below).
   - **Inspect**: live values of the preset's variables, with Freeze and Step for the stage.
   - **Shader**: the warp and composite shaders, their compile errors, and the GLSL the GPU runs.
   - **Compat**: what will not run as written here, and what will not carry over to MilkDrop 2.
   - **Textures**: the image files the preset samples.
   - **History**: named versions you save and automatic checkpoints, to compare or restore.
4. Watch the running stage as you apply a change. A compile error is a diagnostic, not a saved working visual; correct it or restore a previous version.

Compare with the original (Cmd/Ctrl+Shift+B) shows your edit against the preset you started from. For a guided course with runnable examples, start at [Play](./authoring/00-play.md). For `.milk` syntax and signals, use the [generated reference](./authoring/reference.md).

## Save and share

An edit that compiles is saved as that preset's draft in this browser, and the preset opens with it next time; the status line says so when it does, and Revert in the editor returns to the original. Text with errors is not saved: the draft keeps the last version that ran, and the browser asks before you leave the page.

Use the editor's export controls to keep a `.milk` file. A file gives you a portable backup of the source independent of local browser storage.

Share produces a remix URL containing the source. It can carry original-author and remix-lineage metadata; that metadata is attribution, not independent verification of authorship. Depending on the browser, Share opens a native share sheet or copies the link. Open the link in a fresh tab to confirm the recipient sees the intended edit.

When video publishing is enabled, the stage’s **More actions → Create video
link…** dialog can publish a small, silent preview with the current preset
code. Choose **Create public link** to capture four seconds; opening the
dialog captures nothing. Anyone with the resulting link can view and copy
the code. Audio stays in your browser. Keep the preset unchanged during
capture. The dialog offers sharing and deletion after publication; deletion
does not recall copies already downloaded or cached by other services.

Remix URLs have a size limit. If the source exceeds that limit, export the `.milk` file instead. Browser drafts and queues are local to that browser; they are not cloud accounts or cross-device backups. Links are designed to carry source, not your microphone stream, audio file, or API key.

## Tune playback

Use Settings to adjust quality, render scale, the renderer, motion, and flashing controls. Lower quality or render scale when frames slow down.

Stims renders with WebGPU in browsers where it is stable (recent Chrome, Edge, Opera and Samsung Internet, and Safari 26 or later) and with WebGL elsewhere, including Firefox. A preset that needs something WebGPU cannot run yet switches to WebGL by reloading the page, which stops your audio; a notice says so, and Resume starts the same source again (an audio file has to be picked again). Settings → Graphics shows which one is running and why WebGL was chosen; its Renderer menu (Auto, WebGPU, WebGL) takes effect after a reload. Adding `?renderer=webgl` to the address forces WebGL for one visit.

Reduce flashing and motion controls can reduce exposure, but they do not certify a preset or display as safe for every viewer. See [sensory controls](./guides/accessibility.md) for their scope.

## Keyboard shortcuts

Press `?` for the full list, where most keys can also be rebound. Cmd+K (Ctrl+K on Windows and Linux) opens the command palette, which reaches every action, including those without a key.

| Key | Action |
| --- | --- |
| Space | Pause or resume the picture; the preset and audio stay |
| N or → / P, ← or Backspace | Next preset (random) / previous preset |
| L | Stay on this preset (pause auto-advance) |
| T | Turn autoplay on or off |
| 1–9 | Play that numbered preset in Browse, once focus leaves the search box |
| B, M, S | Browse, find a preset, Settings |
| E | Edit the preset's code; Cmd/Ctrl+Enter compiles it |
| F | Full screen |
| C | Record video |
| U | Add this preset to the queue |
| Shift+D | Live performance mode |
| D | Black out the picture while held; two quick taps keep it black until the next press |
| Y | Flash the screen white while held; tapping repeatedly strobes |
| V | Cycle the theme (dark, light, system) |
| H | Switch transitions between blend and cut |
| W, I, O, J | Nudge the running preset: next waveform, zoom in, more warp, bigger waveform; with Shift, the opposite |
| `>` / `<` | Rotate clockwise / counterclockwise |
| Esc | Close panels |

## Optional AI assistance

The Assist and synthesis tools can generate or refine source when a configured provider is available. Hosted generation depends on the deployment. Local inference needs a supported loopback endpoint; OpenRouter uses a key you supply. Read the provider settings before sending source or a prompt.

Generated source still needs compilation and visual review. A successful compile does not establish visual quality, compatibility with every renderer, or similarity to native MilkDrop.

## Capture a session

Browser recording is beta. Resolution options do not establish the encoded resolution, audio synchronization, or sustained frame pacing on your device. Make a short recording and inspect the downloaded file before a longer session. For OBS, follow the [capture and audio-routing guide](./OBS.md).

## Report a problem

Include the preset or exported source, browser version, operating system, audio source, rendering backend (Settings → Graphics shows it), and steps to reproduce. If the problem looks renderer-specific, say whether it also happens with `?renderer=webgl` added to the address. For a shared-link problem, include the link when its contents are suitable to share. Say whether the problem occurs on a fresh load or after switching presets. [Open an issue](https://github.com/zz-plant/stims/issues/new/choose) with that evidence.

## Check a picture against a description

In Generate, expand **Check the current picture**, enter a description, and choose **Check picture**. When the optional hosted service is configured, this sends one reduced stage image and the description to Cloudflare. It sends no audio. The result can suggest trying a more specific prompt or generating again; it does not replace the preset. If you edit the source or controls while it runs, check the new picture again.

This is an AI judgment about one frame. It does not verify flashing, performance, audio synchronization, or MilkDrop parity. Playback and local editing work without the service. Developer and agent workflows are in [Decision models](./DECISION_MODELS.md).
