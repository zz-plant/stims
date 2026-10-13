# Standalone package launch drafts

Each library has a different audience and a working browser demo. Treat these as separate launches, each linking directly to its demonstration and source. These are prepared drafts; no launch posts or npm releases were sent by this workflow.

On October 10, 2026, all four demo URLs returned HTTP 200 and all four npm registry names returned HTTP 404. An HTTP response verifies reachability, not the demo's interactions. Use the demos and checkout examples now; add installation commands to posts only after the first release and a clean-consumer check pass. The publishing setup is in [Packages](../packages/README.md#publishing).

## milkdrop-toolchain: preset editors and renderer authors

Title: **A TypeScript compiler and EEL runtime for original MilkDrop presets**

> milkdrop-toolchain reads original .milk text, compiles equations into an IR, evaluates EEL2 with an interpreter or JavaScript JIT, and lowers supported equation blocks to WGSL. It also formats and exports presets and traces which audio signals reach each control.
>
> Try the compile playground with a preset, inspect its diagnostics, then change an equation. This is the compiler used by Stims; it does not render the picture. Successful compilation and agreement between execution tiers do not establish visual matching with native MilkDrop.
>
> Demo: https://zz-plant.github.io/stims/milkdrop-toolchain/
> Source and worked examples: https://github.com/zz-plant/milkdrop-toolchain
> Feedback: which preset constructs or editor tools would you need before adopting it?

Before posting: run the README compile example, check the diagnostic output in the playground, and show the input alongside its result. Publish a speed claim only with inputs, hardware, and a comparison benchmark.

## audio-reactive: creative coding and Web Audio developers

Title: **AudioWorklet FFT, beat envelopes, and harmonic/percussive signals for visualizers**

> audio-reactive turns audio into signals a renderer can use: band energies, beat envelopes, spectral features, and harmonic/percussive estimates. Analysis runs in an AudioWorklet, with pure functions for offline use and interpolation between packets on the rendering side.
>
> The demo lets you inspect the signal changes rather than infer them from a visual effect. The README shows worklet bundling, packet buffer recycling, and an offline example. Harmonic/percussive separation is a signal estimate, not instrument identification or isolated vocal stems.
>
> Demo: https://zz-plant.github.io/stims/audio-reactive/
> Source and integration example: https://github.com/zz-plant/audio-reactive
> Feedback: which signals are useful in your visuals, and which bundlers make worklet setup difficult?

Before posting: test the worklet with user-started audio in a clean browser and check the documented asset-bundling path. Do not describe synthetic click tests as music-dataset accuracy.

## flash-guard: canvas authors and accessibility tooling

Title: **Analyze flash transitions in frame sequences and govern a live canvas**

> flash-guard provides frame-sequence analysis and a canvas luminance governor. Its demo exposes the measurements and mitigation, and its README describes sampling timing and how the governor observes its own brightness changes.
>
> It is a tool for investigating and reducing flashing under its sampling and threshold model. It does not certify a video, application, or viewing setup as safe. Sparse samples, unmeasured content, and transitions outside the capture remain limits.
>
> Demo: https://zz-plant.github.io/stims/flash-guard/
> Source and measured examples: https://github.com/zz-plant/flash-guard
> Feedback: reproducible false positives, missed transitions, and integration problems are useful reports.

Before posting: show a measured input and the output without autoplaying a strobe in a social preview. Retain the distinction between offline flash/red-flash analysis and the live luminance governor.

## eel-conformance: EEL implementers

Title: **A portable EEL2 conformance corpus with a runner contract**

> eel-conformance packages JSON cases, a schema, and a harness for testing EEL2 implementations. The runner contract specifies environment seeding, guest buffers, comparison tolerance, and deterministic random draws.
>
> Pinned cases define the corpus's required results; provisional cases remain questions awaiting upstream confirmation. Passing this corpus establishes agreement on those cases, not complete compatibility with every preset or native runtime.
>
> Demo: https://zz-plant.github.io/stims/eel-conformance/
> Source and runner contract: https://github.com/zz-plant/eel-conformance
> Feedback: independent runner results, upstream evidence for provisional cases, and small counterexamples.

Before posting: reproduce the corpus summary and run it against the intended engine. Include failures and the upstream version if comparing native behavior.

## Release and publication record

Track first npm publication, trusted-publisher setup, and clean-consumer verification separately for each library in [the release and launch issue](https://github.com/zz-plant/stims/issues/1410). Mirrors are read-only; route issues and pull requests to [zz-plant/stims](https://github.com/zz-plant/stims/issues).

After an actual post, record its date, destination URL, source revision, package version if released, and the example it demonstrates. Use the measurement instructions in [Launch material](./LAUNCH.md#measurement). GitHub visits and package downloads are not attributable stars or evidence that someone adopted the library.
