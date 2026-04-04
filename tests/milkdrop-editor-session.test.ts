import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { createMilkdropEditorSession } from '../assets/js/milkdrop/editor-session.ts';
import type { MilkdropPresetSource } from '../assets/js/milkdrop/types.ts';

describe('milkdrop editor session', () => {
  test('loads presets without starting the editor worker', async () => {
    const OriginalWorker = globalThis.Worker;
    let workerCreations = 0;

    globalThis.Worker = class {
      private errorListener: ((event: Event) => void) | null = null;

      constructor() {
        workerCreations += 1;
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'error') {
          this.errorListener = listener;
        }
      }

      removeEventListener() {}

      postMessage() {
        this.errorListener?.(new Event('error'));
      }

      terminate() {}
    } as unknown as typeof Worker;

    try {
      const session = createMilkdropEditorSession({
        initialPreset: {
          id: 'editor-load-no-worker',
          title: 'Editor Load No Worker',
          raw: 'title=Editor Load No Worker\nwave_r=0.4\n',
          origin: 'user',
        },
      });

      await session.loadPreset({
        id: 'editor-load-no-worker-2',
        title: 'Editor Load No Worker 2',
        raw: 'title=Editor Load No Worker 2\nwave_g=0.5\n',
        origin: 'bundled',
      });

      expect(workerCreations).toBe(0);

      await session.applySource('title=Editor Load No Worker 2\nwave_g=0.75\n');
      expect(workerCreations).toBe(1);

      session.dispose();
    } finally {
      globalThis.Worker = OriginalWorker;
    }
  });

  test('keeps the last good preset active when new source has errors', async () => {
    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'editor-session-test',
        title: 'Editor Session Test',
        raw: 'title=Editor Session Test\nwave_r=0.4\n',
        origin: 'user',
      },
    });

    const firstState = session.getState();
    expect(firstState.activeCompiled?.title).toBe('Editor Session Test');

    const broken = await session.applySource(
      'title=Editor Session Test\nwave_r=bad(\n',
    );
    expect(
      broken.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(true);
    expect(broken.activeCompiled?.title).toBe('Editor Session Test');
    expect(broken.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(0.4, 6);

    const repaired = await session.updateField('wave_r', 0.75);
    expect(
      repaired.diagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      ),
    ).toBe(false);
    expect(repaired.activeCompiled?.ir.numericFields.wave_r).toBeCloseTo(
      0.75,
      6,
    );

    const structured = await session.updateField('wavecode_0_enabled', 1);
    expect(structured.activeCompiled?.ir.customWaves.length).toBe(1);
    expect(structured.activeCompiled?.ir.customWaves[0]?.fields.enabled).toBe(
      1,
    );

    session.dispose();
  });

  test('loads presets into a clean editor state before any user edits', async () => {
    const session = createMilkdropEditorSession({
      initialPreset: {
        id: 'editor-load-clean',
        title: 'Editor Load Clean',
        raw: 'title=Editor Load Clean\nwave_r=0.4\n',
        origin: 'user',
      },
    });

    const loaded = await session.loadPreset({
      id: 'editor-load-clean-2',
      title: 'Editor Load Clean 2',
      raw: 'title=Editor Load Clean 2\nwave_g=0.5\n',
      origin: 'bundled',
    });
    const formattedSource = loaded.activeCompiled?.formattedSource;

    expect(loaded.dirty).toBe(false);
    expect(formattedSource).toBeDefined();
    if (!formattedSource) {
      throw new Error('Expected the loaded preset to compile successfully.');
    }
    expect(loaded.source).toBe(formattedSource);

    session.dispose();
  });

  test('ignores stale worker commits after a newer preset load', async () => {
    const OriginalWorker = globalThis.Worker;
    const postedMessages: Array<{
      id: number;
      type: 'compile';
      source: string;
      preset: Partial<MilkdropPresetSource>;
    }> = [];
    let messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];

    globalThis.Worker = class {
      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'message') {
          messageListeners.push(
            listener as unknown as (event: MessageEvent<unknown>) => void,
          );
        }
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        if (type !== 'message') {
          return;
        }
        messageListeners = messageListeners.filter(
          (candidate) =>
            candidate !==
            (listener as unknown as (event: MessageEvent<unknown>) => void),
        );
      }

      postMessage(payload: (typeof postedMessages)[number]) {
        postedMessages.push(payload);
      }

      terminate() {}
    } as unknown as typeof Worker;

    try {
      const session = createMilkdropEditorSession({
        initialPreset: {
          id: 'stale-commit-a',
          title: 'Stale Commit A',
          raw: 'title=Stale Commit A\nwave_r=0.4\n',
          origin: 'user',
        },
      });

      const pendingDraft = session.applySource(
        'title=Stale Commit A\nwave_r=0.75\n',
      );
      expect(postedMessages).toHaveLength(1);

      const loaded = await session.loadPreset({
        id: 'stale-commit-b',
        title: 'Stale Commit B',
        raw: 'title=Stale Commit B\nwave_g=0.5\n',
        origin: 'bundled',
      });
      expect(loaded.activeCompiled?.title).toBe('Stale Commit B');

      const workerPayload = postedMessages[0];
      if (!workerPayload) {
        throw new Error('Expected a pending worker payload.');
      }

      const compiled = compileMilkdropPresetSource(
        workerPayload.source,
        workerPayload.preset,
      );
      [...messageListeners].forEach((listener) =>
        listener({
          data: {
            id: workerPayload.id,
            compiled,
          },
        } as MessageEvent<unknown>),
      );

      const resolvedState = await pendingDraft;
      expect(resolvedState.activeCompiled?.title).toBe('Stale Commit B');
      const finalState = session.getState();
      expect(finalState.activeCompiled?.title).toBe('Stale Commit B');
      if (!finalState.activeCompiled) {
        throw new Error('Expected the latest preset to stay compiled.');
      }
      expect(finalState.source).toBe(finalState.activeCompiled.formattedSource);

      session.dispose();
    } finally {
      globalThis.Worker = OriginalWorker;
    }
  });
});
