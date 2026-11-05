# Desktop shell spike

Can a thin desktop shell give Stims something the browser cannot, and should it
be Electron or Tauri? Both shells here load the unmodified app from a local
server. Measured on 2026-11-04.

## Recommendation

**Do not ship a desktop build yet. If you do later, use Electron.**

A shell does give Stims two things a browser cannot: system audio with no picker,
and rendering at full rate while the window is hidden. Neither has measured demand.
Only 14 of 284 desktop starts used tab audio in the last 30 days, and a shell adds
a second release channel, $99 a year, and a 121 MB download.

Reopen this on either signal, both rough figures: tab and system audio passing
about 20% of desktop starts, or a performer who needs Syphon, Spout or NDI output.

Electron wins on what the shell is for:
- It keeps rendering while hidden with one public preference. Tauri cannot.
- It runs the same engine as Chrome, so no guard misfires and presets render as
  they do there.
- Its system audio takes a 5-line handler and a small shim. Tauri's takes about
  320 lines of mostly unsafe Rust, on one OS only.

Tauri's advantage is size: a 1.5 MB installer against 121 MB. Its memory saving is
small, about 80 MB of 540 MB.

Worth doing regardless of desktop: [analysis lag creep](#latency) costs 40–100 ms in
Chromium, and that includes Chrome today.

## Findings

M1 Max (32-core GPU, 120 Hz display), macOS 27.0, AC power, built-in speakers at
44.1 kHz. Electron 45.2.2 and Chrome both run Chromium 156.0.8078.80. Tauri 2.12.5
runs WKWebView (WebKit 22625). Unless noted, runs used a local production build.
Other sessions were running throughout, with load average between 8 and 80, so
treat small timing differences as noise.

**No Windows machine was reachable, so Windows is unmeasured.**

| Question                                 | Chrome                   | Electron                       | Tauri                                     |
| ---------------------------------------- | ------------------------ | ------------------------------ | ----------------------------------------- |
| System audio without a picker            | No                       | **Yes**                        | **Yes**                                   |
| Real music reaches the Microphone source | n/a                      | Yes                            | Yes                                       |
| OS prompts                               | Not tested               | One: system audio              | One: system audio                         |
| Sound to first frame, first 25 s         | 41 ms (tab capture)      | **28–31 ms**                   | 88–94 ms                                  |
| Sound to first frame, after 2–3 minutes  | 66 ms                    | 131 ms                         | 89–94 ms                                  |
| WebGPU adapter                           | Yes                      | Yes                            | Yes                                       |
| Backend Stims picks                      | WebGPU                   | WebGPU                         | WebGPU, **draws nothing until UA is set** |
| Frame rate                               | 120 fps                  | 120 fps                        | 60 fps                                    |
| Main-thread frame cost                   | 0.9 ms                   | 1.4–1.5 ms                     | 5.6–6.3 ms                                |
| Draws while covered                      | No                       | **Yes, 120 fps**               | Only with a private API, 57 fps           |
| Draws while hidden or minimized          | No                       | **Yes, 120 fps**               | No                                        |
| Installer / app size                     | n/a                      | 121 MB / 258 MB                | **1.5 MB / 4.1 MB**                       |
| Memory, live                             | 763–803 MB (new profile) | 538–559 MB                     | **449–482 MB**                            |
| Could support Syphon or Spout            | No                       | Plausibly, via shared textures | No known route, not researched            |

## System audio

**Electron** answers `getDisplayMedia` from
[`setDisplayMediaRequestHandler`](electron/main.js) with
`{ video: request.frame, audio: 'loopback' }`, and a preload shim routes Stims's
`getUserMedia` to it. Capturing its own frame as the video source avoids the
Screen Recording permission. No feature flags were needed in Electron 45.

**Tauri** has no such API. [`system_audio.rs`](tauri/src/system_audio.rs) reads a
Core Audio process tap and pushes base64 PCM through `eval` into
[`pcm-shim.js`](shared/pcm-shim.js), adapted from the Android spike. WKWebView has
no `getDisplayMedia` at all.

Tested through Stims's own Microphone source:
- A track played in IINA reached both shells, and `audioEnergy` varied about 3
  times more than in silence (standard deviation 0.053 to 0.175 in Electron, 0.036
  to 0.113 in Tauri).
- A real click on Stims's button started capture in Electron. Tauri's real click
  was not tested, because control of that window was not granted.
- Capture is pre-volume. Electron peaked at 0.72 with the output muted, and Tauri's
  bursts arrived at their written amplitude of 0.01 with the volume at 40%.
- Levels match across routes: burst rms was 0.0059 in Electron, 0.0057 in Tauri and
  0.0060 in Chrome.
- Electron's track is stereo only if asked. The default was mono with voice
  processing on.

The prompt read in Tauri is a single dialog: "“Stims Tauri Spike.app” would like
access to record your system audio", followed by the app's usage string, with Don't
Allow and Allow. It does not mention the screen. Electron's prompt closed before it
could be read. Its docs name the same System Audio Recording permission, and its
default usage string is "This app needs access to audio capture".

## Latency

Each stage is milliseconds after a tone burst was presented to the output device,
on the wall clock every process shares. Medians over 40 bursts, with p95 in
brackets where it matters. The speaker adds an estimated 16 ms (704 frames of
device latency); Chrome's source tab adds about 30 ms.

| Stage                                 | Chrome tab capture | Electron loopback | Tauri tap           |
| ------------------------------------- | ------------------ | ----------------- | ------------------- |
| Tap timestamps the buffer             | n/a                | n/a               | −4                  |
| Native callback                       | n/a                | n/a               | +10                 |
| Page handler                          | n/a                | n/a               | +10–15 (p95 21–110) |
| Stream reaches a page worklet         | +54                | +40               | +76–80              |
| Stims analysis message                | +71                | +43               | +99–103             |
| Next rAF                              | +73                | +47               | +104–110            |
| **rAF after the speaker, first 25 s** | **41 (53)**        | **31 (43)**       | **88–94 (99–109)**  |
| **rAF after the speaker, steady**     | **66**             | **131**           | **89–94**           |

The last stage, rAF to pixels, was not measured. One refresh would add about 8 ms
at 120 Hz and 17 ms at 60 Hz. That puts sound-to-screen at about 140 ms for Electron
and 108 ms for Tauri once settled, against 215 ms for the Android spike.

**Analysis lag creep.** In Chromium, Stims's analysis falls behind the stream after
capture starts. Electron's gap between stream and analysis grew from 3 ms to about
100 ms within two minutes and then held there, through 300 bursts. Chrome's tab
capture grew from 17 ms to 42 ms in three minutes. Tauri stayed flat at about 23 ms.

The cause is unknown. A second context on a clone of the same stream stayed flat at
40 ms, both contexts keep real time (rate 0.99999 over 45 s), and the
[worklet](../../packages/audio-reactive/src/frequency-analyser-processor.ts) holds
no queue. Until this is understood, Electron's 30 ms is what it could reach, not
what it does.

Two things set Tauri's number:
- Its queue fills to its cap and stays there, so the cap sets the latency. 60 ms
  measured 122 ms to the first frame and 30 ms measures about 91 ms, at the cost
  of 868 dropped chunks and 3158 underruns in 150 s.
- About 65 ms sits between the page handler and a worklet. Up to 30 ms of that is
  the queue. The rest is inferred to be WebKit's MediaStream path, not timed apart.

The Chrome baseline bypasses Stims's Tab button. In the test harness the button
stayed at `ready` after `getDisplayMedia` succeeded, so its "Tab audio" track was
handed to the Microphone path instead. The picker was accepted by a launch flag; a
visitor also sees it.

## Rendering

Production build, 800×472 content at 2x, quality step 0, two presets, 30 s each.

| Shell                 | rAF per second | rAF p50 / p95 | Main-thread frame | Drawn | Path           |
| --------------------- | -------------- | ------------- | ----------------- | ----- | -------------- |
| Chrome                | 118–120        | 8.3 / 10      | 0.9 ms            | All   | Full WebGPU    |
| Electron              | 115–120        | 8.3 / 10      | 1.4–1.5 ms        | All   | Full WebGPU    |
| Tauri, Safari UA      | 60             | 17 / 19       | 5.6–6.3 ms        | All   | Full WebGPU    |
| Tauri, stock UA (dev) | 60             | 17 / 20       | 1.6–2.7 ms        | None  | Safe path, off |

GPU time was not measured, so the frame column is main-thread time only.

**The guard misfire is not the one suspected.** `isGuardedMobileWebGPUEnvironment`
never fires on these shells, because `isMobileDevice()` is false. The misfire is in
[`isWebGPUStableInThisBrowser`](../../src/js/core/renderer-query-override.ts):

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)
```

WKWebView's user agent has no `Version/` or `Safari/` token, so it counts as an
unknown browser. [`shouldUseSafeMilkdropWebGpuPath`](../../src/js/milkdrop/webgpu-query-override.ts)
then takes the safe path, `appliedShaderExecution` reads `off`, and the probe counts
zero `getCurrentTexture` calls while rAF runs at 60. Canvas readback returned alpha
0. A screen capture of that window was not available, so the blank stage rests on
those two readings.

Setting a Safari user agent through `STIMS_SPIKE_USER_AGENT` fixes it, and the same
readback then shows the preset correctly. Electron's user agent carries `Chrome/`, so
it takes the full path untouched.

WKWebView also holds rAF at 60 on this 120 Hz display.

## Hidden rendering

Frames per second from raw rAF and from WebGPU presents, which agreed in every
state. Loaded without `?agent=true`, so Stims's own hidden-tab rule applied.

| State                | Chrome | Electron | Electron, `backgroundThrottling: false` | Tauri | Tauri, `backgroundThrottling: disabled` | Tauri, plus private occlusion switch |
| -------------------- | ------ | -------- | --------------------------------------- | ----- | --------------------------------------- | ------------------------------------ |
| Visible              | 120    | 117      | 113–120                                 | 60    | 60                                      | 60                                   |
| Covered by a window  | 0\*    | 0        | **120**                                 | 0     | 0                                       | 57                                   |
| Hidden tab or window | 0      | 0        | **120**                                 | 0     | 0                                       | 0                                    |
| Minimized            | 0      | 0        | **120**                                 | 0     | 0                                       | 0                                    |
| App hidden           | n/a    | 0        | **120**                                 | 0     | 0                                       | 0                                    |
| `document.hidden`    | true   | true     | **false**                               | true  | true                                    | false only while covered             |

\* Stopped within a second of being covered (7.6 fps averaged over 10 s).

- Electron's one preference is enough. The three command-line switches often quoted
  made no measurable difference.
- The frames are real: two canvas reads from a hidden Electron window a few seconds
  apart differ, and system audio keeps arriving at 43 messages a second.
- In every shell, audio analysis keeps running in every state, even at 0 fps.
- Locking the screen hides the page in Tauri too. Electron was not tested locked.

**Measurement trap.** Playwright turns on focus emulation, which reports hidden tabs
as visible and keeps rAF at full speed. The first Chrome baseline measured 120 fps in
every state because of it. [`chrome-driver.ts`](tools/chrome-driver.ts) uses raw CDP.

## Cost

Measured with `footprint` across each shell's whole process tree. Tauri's WebKit
helpers are counted too.

|                                     | Chrome     | Electron        | Tauri                                     |
| ----------------------------------- | ---------- | --------------- | ----------------------------------------- |
| DMG                                 | n/a        | 120.8 MB        | 1.5 MB                                    |
| App on disk                         | n/a        | 258 MB          | 4.1 MB                                    |
| Memory, two presets on a mock track | 763–803 MB | 538–549 MB      | 449–482 MB                                |
| Memory, live system audio           | n/a        | 559 MB          | 466 MB                                    |
| Build                               | n/a        | 20 s to package | 4 min 36 s clean, then about 1 min        |
| Shell code                          | n/a        | 184 lines of JS | 481 lines of Rust, plus the 193-line shim |

**Signing, with nothing bought or enrolled.** No signing identity exists on this Mac,
so both DMGs are unsigned or ad-hoc. Per the docs below:
- macOS needs the [Apple Developer Program](https://v2.tauri.app/distribute/sign/macos/)
  at $99 a year, a Developer ID certificate and notarization, for either engine. Ad-hoc
  signing still leaves users approving the app in Privacy & Security.
- Windows needs [an EV certificate or Azure Artifact Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
  which Electron's docs call the cheapest option. A [third-party post](https://codenote.net/en/posts/windows-code-signing-ci-cost-per-signing-volume-2026/)
  puts it at $9.99 a month; Microsoft's own price list was not confirmed. It is
  [limited by region](https://azure.microsoft.com/products/artifact-signing).
- Whether a signed build's permission behaves as measured here is untested.

**Syphon and Spout were not attempted.** Electron's
[offscreen rendering](https://www.electronjs.org/docs/latest/api/structures/web-preferences)
exposes an [`IOSurface` or NT handle](https://www.electronjs.org/docs/latest/api/structures/shared-texture-handle)
under an experimental option. Its docs say the handle is local to the process and do
not mention Syphon or Spout, so a native add-on is the likely route. WKWebView has no
equivalent that this spike knows of, but that was not researched.

## Problems a user would hit

**Both shells**
- The button says "Resume with your mic" and "Your browser asks for the microphone
  again" while the source is system audio. A real product needs its own source.
- Capture takes in everything playing, Zoom calls included, and keeps going while
  muted. That needs saying plainly in the product.
- `localhost` turns telemetry off in
  [`optional-api.ts`](../../src/js/core/services/optional-api.ts), so a bundled shell
  serving from `tauri://localhost` would be invisible in reports.
- An unanswered prompt stalls capture silently, and one app's open prompt stalled the
  other's too. Stims then reports "Another audio source is still starting".

**Electron**
- A denied permission gives a [dead track with no error](https://www.electronjs.org/docs/latest/api/desktop-capturer),
  per its docs. Not tested.
- Hidden rendering spends GPU while nobody is watching, so it should be tied to Live
  performance mode rather than left on.
- The log fills with `uninitialized SharedImage` GL errors from a 2D canvas. The
  picture is fine and the cause was not traced.
- electron-builder 26.18 walks up to this repo's root `node_modules` and packs them
  into the app, adding 10 MB to the DMG. The `files` list in
  [`package.json`](electron/package.json) excludes them, and a real build must too.
- The Tab / system button also reaches the handler, so it gives system audio too. Its
  route changed, but the source did not switch within the time checked.

**Tauri**
- With its stock user agent, no picture at all.
- The tap reports 48 kHz while delivering at the device's 44.1 kHz. Trusting it
  starved the page and shifted the pitch by 9%. Fixed here by reading the output
  device's rate, but a device change while running is not handled.
- Opening the tap blocks until the prompt is answered, so it must stay off the main
  thread. It runs at launch here; a real build would ask on click.
- One of two ad-hoc rebuilds after a grant asked for permission again.
- `eval` delivery has occasional spikes, with a hop p95 reaching 200 ms in one second
  of a 150 s run.
- rAF fell to 30 fps with timers at 1 per second once, while visible and unfocused on
  the stock user agent. A later focused run did not repeat it, so this is unexplained.

## Not measured

- Windows, and Tauri's Linux WebView.
- Rendering in a different Space, Bluetooth output, and a device change mid-run.
- Rendering while hidden in a signed build, or for hours.
- rAF to pixels, and GPU frame time.
- Chrome's system audio through the picker, because it would have asked for a
  permission on your everyday browser.
- Apple Music or other protected streams. The source was a local MP3.

## Run it

Run these from this folder. They need Bun, Rust with `cargo-tauri`, and a local
server, such as `bun run build` then `bunx vite preview --port 5993 --strictPort` at the
repo root. Point a shell at a local URL, never toil.fyi: production telemetry had to
exclude the Android spike's runs. The Electron shell also blocks every non-local request.

```bash
bun tools/collector.ts /tmp/desktop-shell
```

```bash
(cd electron && bun install && node node_modules/electron/install.js)
```

```bash
(cd tauri && CI=true cargo tauri build --bundles app,dmg)
```

```bash
mkdir -p tools/bin && swiftc -O tools/burst.swift -o tools/bin/burst && swiftc -O tools/cover.swift -o tools/bin/cover
```

```bash
tools/launch.sh tauri 'http://localhost:5993/?agent=true' /tmp/tauri 'STIMS_SPIKE_USER_AGENT=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
```

| Tool                                                                                         | What it does                                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`shared/probe.js`](shared/probe.js)                                                         | Injected only when `STIMS_SPIKE_COLLECTOR` is set; times every stage and counts frames |
| [`tools/burst.swift`](tools/burst.swift)                                                     | The "other app": quiet tone bursts with presentation times                             |
| [`tools/latency-report.ts`](tools/latency-report.ts)                                         | One burst run, stage by stage                                                          |
| [`tools/latency-trend.py`](tools/latency-trend.py)                                           | Whether latency holds over a long run                                                  |
| [`tools/hidden-run.sh`](tools/hidden-run.sh), [`hidden-summary.ts`](tools/hidden-summary.ts) | Hidden states and their frame rates                                                    |
| [`tools/frames-run.sh`](tools/frames-run.sh), [`memory.sh`](tools/memory.sh)                 | Frame windows and process-tree memory                                                  |
| [`tools/chrome-driver.ts`](tools/chrome-driver.ts)                                           | Chrome baseline over raw CDP                                                           |

`STIMS_SPIKE_KEEP_RENDERING`, `STIMS_SPIKE_NO_OCCLUSION`, `STIMS_SPIKE_NO_AUDIO` and
`STIMS_SPIKE_USER_AGENT` select the variants measured above. The bursts play at
−40 dBFS by default, which a capture path still detects cleanly.
