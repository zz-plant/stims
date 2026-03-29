import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  loadVisualReferenceManifest,
  VISUAL_REFERENCE_FIXTURE_ROOT,
  VISUAL_REFERENCE_MANIFEST_PATH,
} from '../scripts/visual-reference-manifest.ts';

test('visual reference manifest stays internally consistent', () => {
  const repoRoot = process.cwd();
  const manifestPath = path.join(repoRoot, VISUAL_REFERENCE_MANIFEST_PATH);
  const fixtureRoot = path.join(repoRoot, VISUAL_REFERENCE_FIXTURE_ROOT);
  const manifest = loadVisualReferenceManifest(repoRoot);

  expect(existsSync(manifestPath)).toBe(true);
  expect(existsSync(fixtureRoot)).toBe(true);
  expect(manifest.version).toBe(1);
  expect(manifest.parityTarget).toBe('projectm-visual-reference');
  expect(manifest.fixtureRoot).toBe(VISUAL_REFERENCE_FIXTURE_ROOT);
  expect(manifest.presetCount).toBe(manifest.presets.length);
  expect(manifest.presets.length).toBeGreaterThanOrEqual(
    manifest.minimumPresetCount,
  );

  manifest.presets.forEach((entry) => {
    expect(entry.id.trim().length).toBeGreaterThan(0);
    expect(entry.title.trim().length).toBeGreaterThan(0);
    expect(entry.sourceFamily.trim().length).toBeGreaterThan(0);
    expect(entry.capture.renderer).toBe('projectm');
    expect(entry.capture.requiredBackend).toBe('webgpu');
    expect(entry.capture.width).toBeGreaterThan(0);
    expect(entry.capture.height).toBeGreaterThan(0);
    expect(entry.capture.warmupMs).toBeGreaterThanOrEqual(0);
    expect(entry.capture.captureOffsetMs).toBeGreaterThanOrEqual(0);
    expect(entry.tolerance.profile.trim().length).toBeGreaterThan(0);
    expect(entry.tolerance.threshold).toBeGreaterThanOrEqual(0);
    expect(entry.tolerance.failThreshold).toBeGreaterThanOrEqual(0);
    expect(existsSync(path.join(fixtureRoot, entry.image))).toBe(true);
    if (entry.metadata) {
      expect(existsSync(path.join(fixtureRoot, entry.metadata))).toBe(true);
    }
  });
});
