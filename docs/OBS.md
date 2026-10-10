# Use Stims in OBS

Start with the demo to establish that the picture works, then choose your own audio. OBS captures the rendered picture; Stims still needs an audio source of its own to react to music. Sending music into the OBS mixer does not automatically send it into Stims.

## Browser Source: demo scene

1. In OBS, add a **Browser** source and leave **Local file** off.
2. Set the URL to:

   ```text
   https://toil.fyi/?embed=true&renderer=webgl&preset=shifter-curlique&audio=demo
   ```

3. Set **Width** to `1280` and **Height** to `720`. Start with a custom frame rate of `30`; this requests a capture rate, not a performance guarantee.
4. Leave **Shutdown source when not visible** and **Refresh browser source when scene becomes active** off while testing. Enabling either reload behavior can discard live edits or require starting audio again.
5. Fit the source to your scene. The embed URL uses a compact stage view and retains a small Stims link. The controls dock and startup hints can still appear; let them fade before recording. Keep the default custom CSS initially.
6. Check that the picture moves. Record ten seconds locally and play it back before using the scene in a stream.

The URL selects WebGL, a bundled preset, and demo audio. Browser autoplay policy can still suspend audio; open the source's **Interact** window to inspect it. If it remains blank or silent, use the regular-browser path below to select audio and start playback explicitly.

The [OBS Browser Source reference](https://obsproject.com/kb/browser-source) defines the viewport, frame-rate, refresh, and shutdown settings. Browser Source uses Chromium Embedded Framework; a successful Chrome session does not prove the same behavior in OBS.

## Your own music: capture a regular browser

Use this path when you need the browser's file picker, microphone permissions, or tab-audio sharing, or when Browser Source does not render correctly.

1. Open [Stims](https://toil.fyi/?renderer=webgl) in Chrome or another WebGL2-capable browser. Start **Play demo** first to confirm that the stage renders.
2. Use the audio control to select a local file, microphone, or tab audio. Tab audio depends on browser and operating-system support; select the tab that plays the music and enable audio sharing when the picker offers it.
3. Select your preset, then use the stage's fullscreen control. The dock hides while watching and returns when the pointer moves.
4. In OBS, capture that browser window or display using the capture source available on your operating system. Crop browser chrome if it is still visible. Avoid capturing a display that contains the OBS preview itself.
5. Configure the stream's audio in OBS separately. Check its meters and a recorded playback; hearing Stims locally does not establish that the recording contains sound. Route each intended track once to avoid doubled audio.

To show a remix, copy **Copy link to this edit** from the preset actions, then open that full URL in the capture browser. It carries the edited source. A local audio file is not carried by the URL, so select the file again on another machine.

## Troubleshooting and evidence

- **Blank Browser Source:** try the regular-browser path with the same preset and `renderer=webgl`. Check whether the browser reports a renderer or compile error. Refreshing a Browser Source loses unsaved in-memory state, so save the remix link first.
- **Picture moves but ignores music:** check the source selected in Stims. The OBS mixer and Stims audio analysis are separate paths.
- **Recording has no audio:** check the OBS capture/mixer path rather than assuming the Browser Source URL captures your desktop sound.
- **Low frame rate:** reduce the Browser Source viewport or requested frame rate and compare a local recording. A `1920×1080` viewport does not promise 1080p at 60 FPS.

Verification on October 10, 2026: the demo URL was checked in local Chromium at 1280×720, with the requested preset, active demo audio, non-black canvas statistics, and no page errors. **Native OBS capture, microphone permissions inside CEF, and recorded audio have not been verified.** Track those checks in [the OBS validation issue](https://github.com/zz-plant/stims/issues/1409) before describing this as a tested OBS integration. The regular-browser path also needs an OBS recording check on each target operating system.

For a rendering report, include the complete URL, OBS and browser versions, operating system, GPU, selected audio source, and whether the same URL works in a regular browser. Follow the preset credit rules in [Lineage and credits](./LINEAGE_AND_CREDITS.md) when sharing a recording.
