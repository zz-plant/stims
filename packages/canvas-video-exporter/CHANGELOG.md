# Changelog

## 0.1.0 (2026-10-28)

First release as a package, extracted from
[zz-plant/stims](https://github.com/zz-plant/stims)
(`src/js/utils/media/canvas-video-exporter.ts`).
- `CanvasVideoExporter`: `MediaRecorder` recording of a canvas at the
  `EXPORT_PRESETS` sizes (Spotify Canvas, TikTok and YouTube Shorts at 9:16,
  1080×1080 square, Full HD, 4K, custom), with `getSupport`,
  `startRecording` and `getSupportedMimeTypes` over `MIME_TYPE_CANDIDATES`,
  and the runtime's audio stream cloned onto the recording. Carried over with
  its tests.
- Native capture: given a `CanvasVideoExportRuntime`, the 4K, 9:16 and 1:1
  presets ask the host renderer to draw at the preset's size for the duration
  and record the canvas itself. 4K is only recorded natively.
- New: `createCanvasFrameCopy` and `subscribeToAnimationFrames`. Without a
  runtime, or for any other preset, the exporter records a copy cropped to
  fill the preset's size and painted on animation frames.
- New: `CanvasVideoExporterHooks`. `createFrames` replaces the frame source
  (Stims paints its copy from the render loop and bakes in the stage
  dimming), and `onRecordingChange` reports when a recording starts and ends.
- New: `createBrowserEnvironment` and the `CanvasVideoExporterEnvironment`
  type, the browser capabilities the exporter uses, replaceable under test.
