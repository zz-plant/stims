# Changelog

## Unreleased

- `audio-reactive/worklet`: the beat and transient detectors run on every FFT block, not only the blocks a packet carries, and a packet summarises every block since the previous one: `rms`, `spectralFlux`, `kickTransient` and `snareSnap` are peaks, and the beat flags are set if any block beat. With `messageEvery` above 1, a transient between packets used to go unseen. The spectrum, waveform and other fields still describe the latest block.
- The detector constants are now set in seconds (as tuned at one update per 4096 samples of 48 kHz audio), so `beatIntensity` decays, and the running averages adapt, at the same rate whatever `fftSize`, sample rate or `messageEvery`. At `messageEvery: 1` and fftSize 1024 this is a quarter of the old per-packet rate; `energyAverages` covers ~5.5 s instead of 64 packets.

## 0.1.0 (2026-10-07)

Initial release, extracted from zz-plant/stims.
- `audio-reactive`: Hann window, radix-2 FFT and AnalyserNode-compatible dB-to-byte spectrum (`analyseBlockBytes`), band averages, median-filter HPSS (`createHarmonicPercussiveAnalyser`), spectral features (RMS, centroid, flatness, rolloff), beat tracker (`createBeatTracker`, with a projectM-compatible mode), reactivity metrics (band levels, extended bands, four-band transients, weighted energy, peak tracking, waveform auto-gain), Hermite packet interpolator (`createAudioReactivityInterpolator`), AudioContext lifecycle tracker and generation token, and the audio gesture gate.
- `audio-reactive/worklet`: `FrequencyAnalyserProcessor`, registered as `frequency-analyser`, posting spectrum, waveform and time-domain buffers with energy, beat, transient, stereo and HPSS fields per FFT block; supports `recycle-buffers` messages.
- 55 tests under `bun test`; `tsc` strict typecheck and declaration build.
