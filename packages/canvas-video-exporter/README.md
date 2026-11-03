# canvas-video-exporter

Record a canvas to a video file at the sizes platforms ask for: Spotify Canvas and Shorts at 9:16, square, Full HD and 4K. It wraps `canvas.captureStream` and `MediaRecorder`: pick a preset, start, stop, get a `Blob`. A preset that does not match the canvas is recorded from a copy cropped to fill the frame. If your renderer can draw at the preset's size for the duration, it records that instead of scaling, and 4K is only recorded that way. Pure TypeScript, no dependencies. It was built for [Stims](https://toil.fyi), where it is the Record panel of a MilkDrop visualizer.

Demo: the [canvas-video-exporter site](https://zz-plant.github.io/stims/canvas-video-exporter/) records an animated canvas in your browser and plays the file back. Nothing is uploaded.

## Install

```sh
npm install canvas-video-exporter
# or
bun add canvas-video-exporter
```

## Quick start

```ts
import { CanvasVideoExporter } from 'canvas-video-exporter';

// Any canvas that is being drawn. This one is 640x360 and 2D.
const canvas = document.createElement('canvas');
canvas.width = 640;
canvas.height = 360;
document.body.append(canvas);
const ctx = canvas.getContext('2d');
const draw = (now: number) => {
  if (!ctx) return;
  ctx.fillStyle = `hsl(${now / 10} 70% 50%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  requestAnimationFrame(draw);
};
requestAnimationFrame(draw);

const exporter = new CanvasVideoExporter(canvas);
console.log(exporter.getSupport());
console.log(exporter.startRecording({ preset: 'tiktok-shorts', fps: 30 }));

await new Promise((resolve) => setTimeout(resolve, 2000));
const blob = await exporter.stopRecording();
if (!blob) throw new Error('the recorder produced no data');
console.log(blob.type);

// Decode the file to see what was recorded.
const video = document.createElement('video');
video.src = URL.createObjectURL(blob);
await new Promise((resolve) => {
  video.onloadedmetadata = resolve;
});
console.log(`${video.videoWidth}x${video.videoHeight}`);
console.log('source still', `${canvas.width}x${canvas.height}`);

// exporter.downloadVideo(blob, 'clip.webm') saves it.
```

Output, as printed by headless Chromium 156 running that file against the packed tarball:

```
{"supported":true,"mimeType":"video/webm;codecs=vp9","reason":null}
{"ok":true,"mimeType":"video/webm;codecs=vp9"}
video/webm;codecs=vp9
1080x1920
source still 640x360
```

The 640x360 source became a 1080x1920 file without being resized: the file holds the middle of the picture at full height. `startRecording` and `getSupport` report failure as a value with a `reason`.

### Native capture and audio

Give the exporter a runtime and it asks your renderer to draw at the preset's size, records the canvas itself, and clones the runtime's audio onto the file.

```ts
import {
  CanvasVideoExporter,
  type CanvasVideoExportRuntime,
} from 'canvas-video-exporter';

const canvas = document.createElement('canvas');
canvas.width = 640;
canvas.height = 360;
const ctx = canvas.getContext('2d');
const draw = (now: number) => {
  if (ctx) {
    ctx.fillStyle = `hsl(${now / 10} 70% 50%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(draw);
};
requestAnimationFrame(draw);

// An oscillator stands in for your audio graph.
const audio = new AudioContext();
const tone = audio.createOscillator();
const destination = audio.createMediaStreamDestination();
tone.connect(destination);
tone.start();
await audio.resume();

const runtime: CanvasVideoExportRuntime = {
  beginNativeCapture: ({ width, height }) => {
    const previous = { width: canvas.width, height: canvas.height };
    canvas.width = width; // your renderer's own resize goes here
    canvas.height = height;
    return { ok: true, restore: () => Object.assign(canvas, previous) };
  },
  getAudioStream: () => destination.stream,
};

const exporter = new CanvasVideoExporter(canvas, undefined, runtime);
console.log(exporter.startRecording({ preset: '4k-landscape', fps: 30 }));
console.log('during:', `${canvas.width}x${canvas.height}`);

// Long enough for the encoder to start: see "Short recordings" below.
await new Promise((resolve) => setTimeout(resolve, 5000));
const blob = await exporter.stopRecording();
if (!blob) throw new Error('the recorder produced no data');
console.log('after:', `${canvas.width}x${canvas.height}`);

const video = document.createElement('video');
video.src = URL.createObjectURL(blob);
await new Promise((resolve) => {
  video.onloadedmetadata = resolve;
});
console.log('file:', `${video.videoWidth}x${video.videoHeight}`);

const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
console.log('audio channels:', decoded.numberOfChannels);
console.log('original track:', destination.stream.getAudioTracks()[0]?.readyState);
```

Output, from the same run:

```
{"ok":true,"mimeType":"video/webm;codecs=vp9"}
during: 3840x2160
after: 640x360
file: 3840x2160
audio channels: 2
original track: live
```

The runtime's own audio track stays live, because only the clones are stopped.

## Presets

`EXPORT_PRESETS` holds these as data, each with a `label` you can show.

| Preset           | Size      | Aspect   | Frames come from                                  |
| ---------------- | --------- | -------- | ------------------------------------------------- |
| `spotify-canvas` | 1080x1920 | 9:16     | The renderer with a runtime, otherwise a copy     |
| `tiktok-shorts`  | 1080x1920 | 9:16     | The renderer with a runtime, otherwise a copy     |
| `youtube-shorts` | 1080x1920 | 9:16     | The renderer with a runtime, otherwise a copy     |
| `square-post`    | 1080x1080 | 1:1      | The renderer with a runtime, otherwise a copy     |
| `hd-landscape`   | 1920x1080 | 16:9     | A copy. This is the default.                      |
| `4k-landscape`   | 3840x2160 | 16:9     | The renderer. Refused without a runtime.          |
| `custom`         | 1280x720  | `custom` | A copy. The size is fixed; no option changes it.  |

Pass `native: false` to record a copy of a preset that would otherwise go through the renderer. If `beginNativeCapture` returns `ok: false`, the recording is refused with its reason, with no fallback to a copy.

## What to plan for

### When the copy can read your canvas

The default copy paints on `requestAnimationFrame`. That is safe for a 2D canvas. For WebGL without `preserveDrawingBuffer`, and for WebGPU, it depends on which callback runs first in the frame, so it can record black.

Measured in headless Chromium 156 on an M1 Max, with a source cleared to red every frame and the copy read back over 10 frames:

| Source                                | Draw callback runs first | Copy callback runs first | Copy painted from the draw (`subscribeToFrames`) |
| ------------------------------------- | ------------------------ | ------------------------ | ------------------------------------------------ |
| WebGL2                                | red                      | **black**                | red                                              |
| WebGL2 with `preserveDrawingBuffer`   | not run                  | red                      | not run                                          |
| WebGPU                                | red                      | **black**                | red                                              |

Your draw callback runs first when the loop was already going before `startRecording`, and that order then holds. A loop started or restarted during a recording runs second, and the copy turns black. If you own the render loop, make the order irrelevant by calling back right after the draw, in the same task:

```ts
const listeners = new Set<() => void>();

const exporter = new CanvasVideoExporter(canvas, undefined, null, {
  subscribeToFrames: (paint) => {
    listeners.add(paint);
    return () => listeners.delete(paint);
  },
});

function render() {
  draw();
  for (const paint of listeners) paint();
  requestAnimationFrame(render);
}
```

### Short recordings

`stopRecording` resolves `null` when nothing was encoded, and a recording shorter than the encoder's start-up encodes nothing. Handle `null` and tell the user.

Measured on the same machine in headless Chromium with VP9, while other work held its load average near 190:

| Preset         | First encoded chunk after | 2 s recording | 8 s recording |
| -------------- | ------------------------- | ------------- | ------------- |
| `square-post`  | 431 ms                    | 676 KB        | not run       |
| `4k-landscape` | 2082 ms                   | **`null`**    | 1.08 MB       |

An earlier run on that machine, whose load was not recorded, got 572 KB from the same 2 s 4K recording, so there is no fixed minimum length.

### Hidden tabs

Browsers pause `requestAnimationFrame` in a hidden tab, so the default copy stops updating until the tab comes back. To record while hidden, drive `subscribeToFrames` from a timer or a worker, and use `onRecordingChange` to keep your renderer going while a recording runs.

### Formats

`getSupport` picks the first type the browser can encode from `MIME_TYPE_CANDIDATES`, and may land on `video/mp4`. `downloadVideo` names the file `canvas-recording.webm` unless told otherwise, so pass a filename that matches `blob.type`.

## API

| Export                                                        | Purpose                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `new CanvasVideoExporter(canvas, environment?, runtime?, hooks?)` | The recorder. Pass `undefined` for `environment` to use the browser's.                                           |
| `.getSupport(mimeType?)`                                      | `{ supported, mimeType, reason }`, checked without starting anything.                                                |
| `.startRecording(options?)`                                   | `{ ok: true, mimeType }` or `{ ok: false, reason }`.                                                                 |
| `.stopRecording()`                                            | Resolves the `Blob`, or `null` if nothing was recorded.                                                              |
| `.downloadVideo(blob, filename?)`                             | Saves the file through a temporary link.                                                                             |
| `.getRecordingStatus()`                                       | Whether a recording is running.                                                                                      |
| `CanvasVideoExporter.getSupportedMimeTypes()`                 | The candidates this browser can encode.                                                                              |
| `EXPORT_PRESETS`, `MIME_TYPE_CANDIDATES`                      | The tables above, as data.                                                                                           |
| `createCanvasFrameCopy({ getCanvas, size?, createCanvas?, subscribe? })` | The cropped copy, for a capture of your own. Returns `null` where a 2D context is unavailable.          |
| `subscribeToAnimationFrames`                                  | The default `subscribe`.                                                                                             |
| `createBrowserEnvironment()`                                  | The browser capabilities as a `CanvasVideoExporterEnvironment`, which you can replace under test.                    |

| `startRecording` option | Default         | Purpose                                                  |
| ----------------------- | --------------- | -------------------------------------------------------- |
| `preset`                | `'hd-landscape'` | One of `EXPORT_PRESETS`.                                |
| `fps`                   | `60`            | Passed to `captureStream`.                               |
| `videoBitsPerSecond`    | `12000000`      | Passed to `MediaRecorder`.                               |
| `mimeType`              | First supported | A specific type. Refused if the browser cannot encode it. |
| `native`                | `true`          | Set `false` to record a copy instead of asking the runtime. |

| Hook                | Purpose                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeToFrames` | When the default copy paints. See [When the copy can read your canvas](#when-the-copy-can-read-your-canvas).                                    |
| `createFrames`      | Replaces the frame source. It receives `{ size, createCanvas }`, with `size` absent for a native recording, and returns `{ canvas, dispose }` or `null`. |
| `onRecordingChange` | Called with `true` when a recording starts and `false` when it ends. A recording that fails to start never calls it.                            |

`createFrames` is how Stims records what its stage shows: a copy painted from the render loop with the flash governor's dimming baked in, since that dimming is a CSS filter and not canvas pixels.

## Development

The code is developed in [zz-plant/stims](https://github.com/zz-plant/stims) under [`packages/canvas-video-exporter`](https://github.com/zz-plant/stims/tree/main/packages/canvas-video-exporter), next to the app that uses it, and released from there. Open issues and pull requests on zz-plant/stims.

```sh
bun install --frozen-lockfile
bun --cwd=packages/canvas-video-exporter run build
bun --cwd packages/canvas-video-exporter test
```

## Provenance

Extracted from [zz-plant/stims](https://github.com/zz-plant/stims):

| Package file                          | Stims source                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | `src/js/utils/media/canvas-video-exporter.ts`, with the stage copy and the recording flag replaced by hooks                  |
| `src/frame-copy.ts`                   | New: the crop from `createPresentedStageCanvas` in `src/js/core/services/stage-presentation.ts`, without the stage dimming   |
| `tests/canvas-video-exporter.test.ts` | `tests/unit/utils/canvas-video-exporter.test.ts`, with the stage cases left in the app and new cases for the hooks           |
| `tests/frame-copy.test.ts`            | New                                                                                                                          |
| `tests/grey-canvas.ts`                | `tests/grey-canvas.ts`                                                                                                       |

`bun test` runs 13 tests across 2 files, with no DOM: the canvases are fakes that composite a grey level. The default copy's animation-frame loop and a real encoder are covered by the runs above, not by the suite.

## License

[Unlicense](https://github.com/zz-plant/stims/blob/main/packages/canvas-video-exporter/LICENSE). Public domain.
