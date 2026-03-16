import { describe, expect, test } from 'bun:test';
import { createMilkdropEditorSession } from '../assets/js/milkdrop/editor-session.ts';

describe('milkdrop editor session', () => {
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
});
