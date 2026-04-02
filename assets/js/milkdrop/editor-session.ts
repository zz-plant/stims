import { compileMilkdropPresetSource } from './compiler';
import { upsertMilkdropField } from './formatter';
import type {
  MilkdropCompiledPreset,
  MilkdropEditorSession,
  MilkdropEditorSessionState,
  MilkdropPresetSource,
} from './types';

type WorkerRequest = {
  id: number;
  type: 'compile';
  source: string;
  preset: Partial<MilkdropPresetSource>;
};

type WorkerResponse = {
  id: number;
  compiled: MilkdropCompiledPreset;
};

function hasErrors(compiled: MilkdropCompiledPreset) {
  return compiled.diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  );
}

export function createMilkdropEditorSession({
  initialPreset,
}: {
  initialPreset: MilkdropPresetSource;
}): MilkdropEditorSession {
  const listeners = new Set<(state: MilkdropEditorSessionState) => void>();
  let worker: Worker | null = null;
  let requestId = 0;
  let sourceMeta: MilkdropPresetSource = initialPreset;
  let lastGood = compileMilkdropPresetSource(initialPreset.raw, initialPreset);
  let state: MilkdropEditorSessionState = {
    source: initialPreset.raw,
    latestCompiled: lastGood,
    activeCompiled: lastGood,
    diagnostics: lastGood.diagnostics,
    dirty: false,
  };

  const notify = () => {
    listeners.forEach((listener) => listener(state));
  };

  const ensureWorker = () => {
    if (worker || typeof Worker === 'undefined') {
      return worker;
    }
    worker = new Worker(new URL('./editor-worker.ts', import.meta.url), {
      type: 'module',
    });
    return worker;
  };

  const compile = (source: string) => {
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      return Promise.resolve(compileMilkdropPresetSource(source, sourceMeta));
    }

    return new Promise<MilkdropCompiledPreset>((resolve, reject) => {
      const currentRequestId = ++requestId;
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== currentRequestId) {
          return;
        }
        activeWorker.removeEventListener('message', onMessage);
        resolve(event.data.compiled);
      };
      const onError = (error: Event) => {
        activeWorker.removeEventListener('message', onMessage);
        activeWorker.removeEventListener('error', onError);
        reject(error);
      };
      activeWorker.addEventListener('message', onMessage);
      activeWorker.addEventListener('error', onError, { once: true });
      const payload: WorkerRequest = {
        id: currentRequestId,
        type: 'compile',
        source,
        preset: sourceMeta,
      };
      activeWorker.postMessage(payload);
    }).catch(() => compileMilkdropPresetSource(source, sourceMeta));
  };

  const commit = async (
    source: string,
    options: {
      markClean?: boolean;
    } = {},
  ) => {
    const compiled = await compile(source);
    if (!hasErrors(compiled)) {
      lastGood = compiled;
    }

    const activeCompiled = hasErrors(compiled) ? lastGood : compiled;
    const formattedSource = activeCompiled.formattedSource;
    const nextSource = options.markClean ? formattedSource : source;

    state = {
      source: nextSource,
      latestCompiled: compiled,
      activeCompiled,
      diagnostics: compiled.diagnostics,
      dirty: options.markClean
        ? false
        : nextSource.trim() !== formattedSource.trim(),
    };
    notify();
    return state;
  };

  return {
    getState() {
      return state;
    },

    async loadPreset(source) {
      sourceMeta = source;
      return commit(source.raw, { markClean: true });
    },

    async applySource(source) {
      return commit(source);
    },

    async updateField(key, value) {
      const baseline = state.latestCompiled?.formattedSource ?? state.source;
      return commit(upsertMilkdropField(baseline, key, value));
    },

    async resetToActive() {
      const activeSource =
        state.activeCompiled?.formattedSource ?? state.source;
      return commit(activeSource, { markClean: true });
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      worker?.terminate();
      worker = null;
      listeners.clear();
    },
  };
}
