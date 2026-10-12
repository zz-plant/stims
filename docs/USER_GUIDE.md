# Use Stims

Open [toil.fyi](https://toil.fyi/) to play a MilkDrop preset, edit it while it runs, and share the result. Start with demo audio to try the workflow before granting microphone or screen-sharing permission.

## Play and choose audio

The root workspace contains the stage, preset browser, editor, and settings. Select a preset in Browse to load it into the stage. Search by title, author, or tags; use collections to narrow the catalog.

Audio options depend on your browser:

| Source | What to expect |
| --- | --- |
| Demo | A built-in sample; playback may require a click because of autoplay policy |
| Microphone | Requires microphone permission and a secure context |
| Audio file | Choose a local file the browser can decode |
| Tab or screen capture | Choose a supported capture source and enable audio in the browser's picker |
| YouTube | Use the YouTube controls and supported tab capture to feed audio to the visualizer |

A moving stage does not prove that external audio reached it. Check the audio status, then listen or change the input to confirm the intended source. If capture is unavailable or permission is denied, select demo audio or a local file.

## Edit a preset

1. Choose **Edit this visual** to open the studio.
2. On a first edit, use **Add a slow spin**, or change the source directly.
3. Use Tune for parameter controls, Reference for language help, and Inspect or Compat for diagnostics. Shader tools apply to presets with shader source.
4. Watch the running stage as you apply a change. A compile error is a diagnostic, not a saved working visual; correct it or restore a previous version.

Versions and draft controls help you compare or restore edits. For a guided course with runnable examples, start at [Play](./authoring/00-play.md). For `.milk` syntax and signals, use the [generated reference](./authoring/reference.md).

## Save and share

Use the editor's export controls to keep a `.milk` file. A file gives you a portable backup of the source independent of local browser storage.

Share produces a remix URL containing the source. It can carry original-author and remix-lineage metadata; that metadata is attribution, not independent verification of authorship. Depending on the browser, Share opens a native share sheet or copies the link. Open the link in a fresh tab to confirm the recipient sees the intended edit.

Remix URLs have a size limit. If the source exceeds that limit, export the `.milk` file instead. Browser drafts and queues are local to that browser; they are not cloud accounts or cross-device backups. Links are designed to carry source, not your microphone stream, audio file, or API key.

## Tune playback

Use Settings to adjust quality, render scale, compatibility mode, motion, and flashing controls. Lower quality or render scale when frames slow down. The default rendering path is WebGL; WebGPU is an optional path with preset- and browser-dependent support.

Reduce flashing and motion controls can reduce exposure, but they do not certify a preset or display as safe for every viewer. See [sensory controls](./guides/accessibility.md) for their scope.

## Optional AI assistance

The Assist and synthesis tools can generate or refine source when a configured provider is available. Hosted generation depends on the deployment. Local inference needs a supported loopback endpoint; OpenRouter uses a key you supply. Read the provider settings before sending source or a prompt.

Generated source still needs compilation and visual review. A successful compile does not establish visual quality, compatibility with every renderer, or similarity to native MilkDrop.

## Capture a session

Browser recording is beta. Resolution options do not establish the encoded resolution, audio synchronization, or sustained frame pacing on your device. Make a short recording and inspect the downloaded file before a longer session. For OBS, follow the [capture and audio-routing guide](./OBS.md).

## Report a problem

Include the preset or exported source, browser version, operating system, audio source, rendering backend, and steps to reproduce. For a shared-link problem, include the link when its contents are suitable to share. Say whether the problem occurs on a fresh load or after switching presets. [Open an issue](https://github.com/zz-plant/stims/issues/new/choose) with that evidence.
