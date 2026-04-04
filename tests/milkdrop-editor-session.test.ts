import { describe, expect, test } from 'bun:test';
import { createMilkdropEditorSession } from '../assets/js/milkdrop/editor-session.ts';

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
});
