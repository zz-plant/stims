# Changelog

## 0.1.0

Initial release, extracted from zz-plant/stims.

- `audio-reactive`: Hann window, radix-2 FFT and AnalyserNode-compatible dB-to-byte spectrum (`analyseBlockBytes`), band averages, median-filter HPSS (`createHarmonicPercussiveAnalyser`), spectral features (RMS, centroid, flatness, rolloff), beat tracker (`createBeatTracker`, with a projectM-compatible mode), reactivity metrics (band levels, extended bands, four-band transients, weighted energy, peak tracking, waveform auto-gain), Hermite packet interpolator (`createAudioReactivityInterpolator`), AudioContext lifecycle tracker and generation token, and the audio gesture gate.
- `audio-reactive/worklet`: `FrequencyAnalyserProcessor`, registered as `frequency-analyser`, posting spectrum, waveform and time-domain buffers with energy, beat, transient, stereo and HPSS fields per FFT block; supports `recycle-buffers` messages.
- 55 tests under `bun test`; `tsc` strict typecheck and declaration build.
