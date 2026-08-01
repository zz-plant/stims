import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

test('settings exposes live MIDI and immersive XR product controls', async () => {
  const [settingsSource, hardwareSource, engineContextSource] =
    await Promise.all([
      readFile(
        path.join(root, 'src/js/frontend/SettingsSheetPanel.tsx'),
        'utf8',
      ),
      readFile(
        path.join(root, 'src/js/frontend/PerformanceHardwareSection.tsx'),
        'utf8',
      ),
      readFile(path.join(root, 'src/js/frontend/engine-context.tsx'), 'utf8'),
    ]);

  expect(settingsSource).toContain('<PerformanceHardwareSection />');
  expect(hardwareSource).toContain('Connect MIDI controller');
  expect(hardwareSource).toContain('Enter VR stage');
  expect(hardwareSource).toContain('bindMidiToMilkdropControls');
  expect(hardwareSource).toContain('engine.startXrStage');
  expect(engineContextSource).toContain('startXrStage:');
  expect(engineContextSource).toContain('endXrStage:');
});
