# How Stims measures fidelity against projectM

Stims is its own browser implementation of MilkDrop. It does not reuse projectM's code. To know whether a preset looks right, Stims compares its frames against a native projectM capture, one preset at a time, on a fixed clock.

## What gets measured

- Both renderers are stepped on the **same fixed clock**, so the comparison is frame-for-frame rather than "looks about right."
- A difference **counts only when it exceeds that preset's own run-to-run noise**. Presets are noisy (audio, randomness, feedback), so a small pixel delta is not a failure.
- Every measured preset's result is **published, passing or not** — there is no silent dropping of failures.

## What the labels mean

Stims separates three claims that are easy to conflate:

1. **Compiles and runs.** The preset's equations and shaders parse and execute on both the WebGL2 and WebGPU backends. This is checked for the whole 1,750-preset Butterchurn pack in CI: none is unsupported on either backend.
2. **Runs with no approximation.** 1,578 of those presets run with no approximation on both backends; the other 172 approximate a shader on WebGPU or use a name the expression VM does not know.
3. **Diffed against a projectM reference.** A frame-level comparison against a native projectM capture. Only a few presets have been measured this way so far.

A preset can pass (1) and (2) and still be unmeasured for (3). The labels keep those distinct so a "runs" badge is never mistaken for "matches."

## How a reference is promoted

A reference capture is not accepted just because it exists. Promotion refuses a reference that a blank frame would pass — i.e. a capture that contains no real signal. This stops an empty or broken capture from being recorded as a pass.

## Why projectM

projectM is the reference implementation most people trust for `.milk` fidelity, and it reads `.milk` files directly. Stims uses it as the oracle, not as a dependency.

## What this is not

- It is not a claim that Stims matches projectM pixel-for-pixel everywhere. Only a few presets have been measured; the rest are labeled by compile/run status only.
- It is not a reimplementation of projectM. Stims runs on the GPU (per-pixel equations compile into the shader on WebGPU), while projectM and Butterchurn run them on the CPU.
