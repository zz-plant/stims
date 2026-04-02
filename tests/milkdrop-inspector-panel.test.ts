import { describe, expect, test } from 'bun:test';
import { InspectorPanel } from '../assets/js/milkdrop/overlay/inspector-panel.ts';

describe('milkdrop inspector panel selection summary', () => {
  test('shows the current scene selection and editing hints', () => {
    const panel = new InspectorPanel({
      onInspectorFieldChange: () => {},
    });

    panel.setVisible(true);
    panel.setSceneSelection({
      kind: 'shape',
      slotIndex: 1,
      worldX: 0.1,
      worldY: 0.2,
      sourceFields: ['shape_1_x', 'shape_1_y', 'shape_1_rad', 'shape_1_ang'],
    });

    expect(panel.element.textContent ?? '').toContain('Shape 1');
    expect(panel.element.textContent ?? '').toContain('Drag to move');
    expect(panel.element.textContent ?? '').toContain('shape_1_x');

    panel.dispose();
  });
});
