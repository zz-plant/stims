---
title: "How Stims Measures Fidelity Against projectM"
description: "How Stims compares frames against native projectM on a fixed clock, separates \"compiles and runs\" from \"diffed against a reference,\" and refuses captures a blank frame would pass."
url: https://toil.fyi/learn/milkdrop-fidelity/
source: https://github.com/zz-plant/stims/blob/main/docs/learn/milkdrop-fidelity.md
license: https://github.com/zz-plant/stims/blob/main/LICENSE
---

# How Stims measures fidelity against projectM

Stims is its own browser implementation of MilkDrop, written separately from projectM. To know whether a preset looks right, Stims compares its frames against a native projectM capture, one preset at a time, on a fixed clock.

## What gets measured

- Both renderers are stepped on the **same fixed clock**, so the comparison is frame-for-frame rather than "looks about right."
- A difference **counts only when it exceeds that preset's own run-to-run noise**. Presets are noisy (audio, randomness, feedback), so a small pixel delta is not a failure.
- Every measured preset's result is **published, passing or failing**.

## What the labels mean

Stims separates three claims that are easy to conflate:

1. **Compiles and runs.** The preset's equations and shaders parse and execute on both the WebGL2 and WebGPU backends. This is checked for the whole 1,750-preset Butterchurn pack in CI: none is unsupported on either backend.
2. **Runs with no approximation.** 1,578 of those presets run with no approximation on both backends; the other 172 approximate a shader on WebGPU or use a name the expression VM does not know.
3. **Diffed against a projectM reference.** A frame-level comparison against a native projectM capture. Only a few presets have been measured this way so far.

A preset can pass (1) and (2) and still be unmeasured for (3). The labels keep those distinct so a "runs" badge is never mistaken for "matches."

## How a reference is promoted

Promotion accepts a reference capture only when it carries real signal: it refuses one that a blank frame would pass, so an empty or broken capture cannot be recorded as a pass.

## Why projectM

projectM is the reference implementation most people trust for `.milk` fidelity, and it reads `.milk` files directly. Stims uses it as the oracle, not as a dependency.

## Limits

- Only a few presets have been measured against projectM; the rest are labeled by compile/run status only. The labels are not a claim that Stims matches projectM pixel-for-pixel everywhere.
- The two run the same equations in different places: Stims compiles per-pixel equations into the shader on WebGPU, while projectM and Butterchurn run them on the CPU.
