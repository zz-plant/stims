import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

test('settings exposes the live MIDI product control', async () => {
  const [settingsSource, hardwareSource] = await Promise.all([
    readFile(path.join(root, 'src/js/frontend/SettingsSheetPanel.tsx'), 'utf8'),
    readFile(
      path.join(root, 'src/js/frontend/PerformanceHardwareSection.tsx'),
      'utf8',
    ),
  ]);

  expect(settingsSource).toContain('<PerformanceHardwareSection />');
  expect(hardwareSource).toContain('Connect MIDI controller');
  expect(hardwareSource).toContain('bindMidiToMilkdropControls');
  // The WebXR stage was retired (research-bucket scaffolding with no
  // device-backed proof); the section must not reference it anymore.
  expect(hardwareSource).not.toContain('XrStage');
});
