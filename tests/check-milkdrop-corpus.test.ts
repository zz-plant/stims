import { describe, expect, test } from 'bun:test';
import {
  runMilkdropCorpusCheck,
  validateMilkdropCorpusManifest,
} from '../scripts/check-milkdrop-corpus.ts';

describe('milkdrop corpus manifest checks', () => {
  test('accepts the checked-in corpus manifest', () => {
    const result = runMilkdropCorpusCheck(process.cwd());
    expect(result.issues).toEqual([]);
  });

  test('requires provenance and fidelity metadata after defaults resolve', () => {
    const issues = validateMilkdropCorpusManifest({
      version: 1,
      minimumPresetCount: 1,
      presetCount: 1,
      canonicalVisualSuite: ['sample'],
      defaults: {
        provenance: 'Test Pack',
        license: 'CC-BY',
        usage: 'approved',
        corpusTier: 'certified',
        expectedFidelityClass: 'near-exact',
        visualEvidenceTier: 'runtime',
      },
      presets: [
        {
          id: 'sample',
          title: 'Sample',
          file: 'sample.milk',
          strata: ['feedback'],
        },
      ],
    });

    expect(issues).toEqual([]);
  });

  test('fails when waiver metadata is incomplete', () => {
    const issues = validateMilkdropCorpusManifest({
      version: 1,
      minimumPresetCount: 1,
      presetCount: 1,
      canonicalVisualSuite: ['sample'],
      defaults: {
        provenance: 'Test Pack',
        license: 'CC-BY',
        usage: 'approved',
        corpusTier: 'certified',
        expectedFidelityClass: 'partial',
        visualEvidenceTier: 'compile',
      },
      presets: [
        {
          id: 'sample',
          title: 'Sample',
          file: 'sample.milk',
          strata: ['feedback'],
          waivers: [
            {
              blockedConstruct: 'shader:unsupported(shader)',
              owner: '',
              expiry: 'bad-date',
            },
          ],
        },
      ],
    });

    expect(issues).toContain(
      'preset sample waiver 0 is missing owner.',
    );
    expect(issues).toContain(
      'preset sample waiver 0 has invalid expiry bad-date.',
    );
  });
});
