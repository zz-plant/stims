import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

test('settings exposes the live MIDI product control', async () => {
  const [settingsSource, hardwareSource, appSource] = await Promise.all([
    readFile(path.join(root, 'src/js/frontend/SettingsSheetPanel.tsx'), 'utf8'),
    readFile(
      path.join(root, 'src/js/frontend/PerformanceHardwareSection.tsx'),
      'utf8',
    ),
    readFile(path.join(root, 'src/js/frontend/App.tsx'), 'utf8'),
  ]);

  expect(settingsSource).toContain('<PerformanceHardwareSection />');
  expect(hardwareSource).toContain('Connect MIDI controller');
  // The live engine binding is wired at the App shell level (not inside
  // this settings-only panel) so a controller keeps driving the visuals
  // after Settings is closed — see App.tsx.
  expect(appSource).toContain('bindMidiToMilkdropControls');
  // The WebXR stage was retired (research-bucket scaffolding with no
  // device-backed proof); the section must not reference it anymore.
  expect(hardwareSource).not.toContain('XrStage');
});
