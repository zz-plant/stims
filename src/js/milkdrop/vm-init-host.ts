/**
 * Host-side adapter for running a preset's init programs in a worker
 * (Phase 1 of vm-worker-isolation). Creates a worker, sends the preset source,
 * and resolves with the post-init snapshot. Falls back to `null` (caller runs
 * init in-process) when workers are unavailable or the worker errors/times out.
 */
import type { MilkdropCompiledPreset } from 'milkdrop-toolchain/src/compiler-types.ts';
import type { MilkdropInitSnapshot, VmInitHost } from './vm.ts';
import type { VmInitRequest, VmInitResponse } from './vm-init-worker.ts';

const INIT_TIMEOUT_MS = 5000;

export class VmInitWorkerHost implements VmInitHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: MilkdropInitSnapshot | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  available(): boolean {
    return typeof Worker !== 'undefined';
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (!this.available()) return null;
    try {
      this.worker = new Worker(
        new URL('./vm-init-worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<VmInitResponse>) => {
        const { requestId } = event.data;
        const entry = this.pending.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        if (event.data.ok) {
          entry.resolve(event.data.snapshot);
        } else {
          entry.resolve(null);
        }
      };
      this.worker.onerror = () => {
        // Fail all pending.
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.resolve(null);
        }
        this.pending.clear();
        this.worker = null;
      };
      return this.worker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  async runInit(
    preset: MilkdropCompiledPreset,
  ): Promise<MilkdropInitSnapshot | null> {
    const worker = this.ensureWorker();
    if (!worker) return null;
    const requestId = this.nextId++;
    return new Promise<MilkdropInitSnapshot | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, INIT_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
      const req: VmInitRequest = {
        requestId,
        raw: preset.source.raw,
        source: { id: preset.source.id, title: preset.source.title },
      };
      worker.postMessage(req);
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.pending.clear();
  }
}

/** Shared host instance for the app (optional; tests may create their own). */
let sharedHost: VmInitWorkerHost | null = null;
export function getSharedVmInitHost(): VmInitWorkerHost {
  if (!sharedHost) sharedHost = new VmInitWorkerHost();
  return sharedHost;
}

/** Opt-in flag for the worker-init path. Default off; enable with
 * `?workerInit=true` (or by setting the exported override in tests). */
export function isWorkerInitEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('workerInit') === 'true';
  } catch {
    return false;
  }
}
