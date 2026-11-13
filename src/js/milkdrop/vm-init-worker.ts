/**
 * Web Worker entry that compiles a MilkDrop preset and runs its init programs
 * off the main thread (Phase 1 of vm-worker-isolation). The host applies the
 * returned post-init snapshot to a main-thread VM.
 *
 * Protocol: receives a `VmInitRequest`, answers with a `VmInitResponse`
 * carrying the same `requestId`.
 */
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import type { MilkdropInitSnapshot } from './vm.ts';
import { MilkdropPresetVM } from './vm.ts';

export type VmInitRequest = {
  requestId: number;
  raw: string;
  source: { id?: string; title?: string };
};

export type VmInitResponse =
  | { requestId: number; ok: true; snapshot: MilkdropInitSnapshot }
  | { requestId: number; ok: false; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<VmInitRequest>) => void) | null;
  postMessage: (message: VmInitResponse) => void;
};

scope.onmessage = async (event) => {
  const { requestId, raw, source } = event.data;
  try {
    const preset = compileMilkdropPresetSource(raw, source ?? {});
    const vm = new MilkdropPresetVM(preset, undefined, { deferInit: false });
    // reset() already ran in the constructor (in-process init in the worker).
    const snapshot = vm.exportPostInitState();
    scope.postMessage({ requestId, ok: true, snapshot });
  } catch (error) {
    scope.postMessage({
      requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
