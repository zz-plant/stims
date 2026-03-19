import { describe, expect, test } from 'bun:test';
import { checkMilkdropVisualBaselines } from '../scripts/check-milkdrop-visual-baselines.ts';
import { generateMilkdropVisualBaselines } from '../scripts/milkdrop-visual-regression.ts';

describe('milkdrop visual baseline checks', () => {
  test('matches the checked-in canonical visual baseline signatures', () => {
    const result = checkMilkdropVisualBaselines(process.cwd());
    expect(result.issues).toEqual([]);
  });

  test('generates signatures for the canonical suite only', () => {
    const baselines = generateMilkdropVisualBaselines(process.cwd());
    expect(baselines.presets).toHaveLength(20);
    expect(baselines.frames).toEqual([1, 2, 3, 10]);
  });
});
