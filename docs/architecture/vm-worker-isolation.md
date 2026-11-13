# Architecture Rationale: Worker Isolation for the MilkDrop VM

## Problem

Stims executes untrusted preset code (EEL2 equations) on the **main thread**.
A hostile or merely pathological preset can:

- Stall the main thread up to the per-frame deadline (50 ms) every frame,
  degrading playback and input responsiveness.
- Run before the browser's compositor, so a single bad frame visibly janks
  the whole UI, not just the canvas.
- Share the JS realm with the React workspace, so a VM bug or an unexpected
  exception can corrupt app state or throw out of the render loop.

The existing mitigations (iteration budget, wall-clock deadline, CSP) bound
the *duration* of a bad preset but not its *blast radius*: the VM still runs
in-process with the UI and the renderer, and a preset that throws or
allocates heavily can take down the whole page.

This is the gap the security review identified as "no worker isolation."

## Why the current structure cannot be extended

The VM (`src/js/milkdrop/vm.ts`, `MilkdropVm`) is not a pure function. A
single `step()` call does all of the following in one synchronous block:

1. Mutates `this.state`, `this.registers`, `this.megabuf`, `this.gmegabuf`,
   `this.randomCell`, `this.waveState` in place.
2. Calls `compileMilkdropProgram(...)` (JIT, `new Function`) and runs it
   against those stores.
3. On the WebGPU path, syncs state to a GPU runner, dispatches a compute
   pass, and reads results back into the same stores.
4. Builds a `MilkdropFrameState` (mesh, waves, shapes, motion vectors) that
   the renderer consumes immediately.
5. Runs per-vertex and per-sample program calls (custom waves/shapes) that
   themselves mutate the same stores.

The renderer (`feedback-manager-*`, the WebGL/WebGPU backends) consumes the
frame state synchronously right after `step()` returns, and the per-vertex
programs need the VM's stores mid-frame. There is no single "input in, output
out" boundary: the VM and the renderer are interleaved within one frame.

Consequences for a naive worker port:

- Every frame would need to serialize ~4 MiB of megabuf/gmegabuf plus state,
  registers, and wave state across the worker boundary, then deserialize the
  results before rendering -- likely slower than the in-process path and
  certainly more complex.
- The WebGPU compute VM runs on the GPU from the main thread; moving it to a
  worker requires transferring the GPU device or re-creating pipelines, which
  WebGPU does not support across workers cleanly.
- The JIT's `new Function` and the interpreter both close over the VM's
  stores; they cannot be invoked in a worker without re-creating those stores
  there and keeping them in sync.

So "just move `step()` to a worker" is not an extension -- it is a
restructuring of the per-frame data flow.

## What the restructure solves

1. **Blast-radius containment.** A preset that throws, allocates, or spins
   runs in a separate realm. The main thread can terminate the worker and
   fall back to a blank frame instead of losing the whole page.
2. **Responsiveness.** Even within the deadline, heavy VM work no longer
   blocks the compositor or React; the UI stays interactive during a heavy
   preset.
3. **A security boundary.** The worker has no DOM, no `window`, no React
   state. A VM escape (if one existed) would land in the worker, not the app.

## Proposed scope (incremental, not all at once)

Phase 1 -- isolate the *init* programs only.
- Init runs once per preset load and can take up to 500 ms. It is the
  highest-value, lowest-risk target: it is not on the per-frame hot path,
  its inputs/outputs are a bounded state snapshot, and a failure during init
  already aborts the load.
- Move `runProgram(init)` and the state it produces to a worker; post the
  resulting state/registers/megabuf back. The main thread applies them before
  the first frame.

Phase 2 -- isolate per-frame *equation* execution (CPU tiers only).
- Move the CPU JIT/interpreter per-frame block to a worker, passing signals
  in and receiving state/registers/megabuf + the derived frame inputs.
- The WebGPU compute-VM path stays on the main thread (GPU device constraint);
  per-pixel/per-vertex programs already run on GPU or CPU as today.
- Keep `buildFrame` (mesh/waves/shapes assembly) on the main thread -- it is
  cheap and needs the renderer's procedural plans.

Phase 3 -- worker lifecycle and fallback.
- Terminate + recreate the worker on exception or deadline breach; render a
  blank frame; surface a "preset stalled" status in the editor.
- Add a feature flag so the in-process path remains the default until the
  worker path is proven.

## What this does NOT change

- The EEL2 language, the compiler, the JIT, the interpreter, and the
  conformance spec are untouched. Only the *host* of execution changes.
- The WebGPU compute VM and per-pixel GPU lowering stay as-is.
- The megabuf/gmegabuf coherency protocol (CPU canonical, GPU mirror) is
  unchanged; the worker owns the CPU copy.

## Risks and open questions

- Serialization cost of megabuf (4 MiB) per frame may erase the responsiveness
  gain. Needs measurement before committing to Phase 2.
- The JIT's `new Function` works in workers, but the interpreter's
  `expression.ts` helpers close over the VM's stores; they must be
  re-instantiated in the worker.
- SharedArrayBuffer could avoid copies but requires COOP/COEP headers, which
  affect embedding (the `?embed=true` iframe story).
- Testing: the VM has extensive unit tests that instantiate `MilkdropVm`
  directly. A worker host needs an adapter that preserves that test surface,
  or the tests move to integration level.

## Decision requested

Approve Phase 1 (init isolation) as the first increment. It is the
highest-value, lowest-risk step and validates the worker host + serialization
plumbing before touching the per-frame hot path. Phase 2/3 follow only if
Phase 1's measurements are favorable.
