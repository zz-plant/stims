import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateMilkdropVisualBaselines } from './milkdrop-visual-regression.ts';

type VisualFrameSignature = {
  frame: number;
  mainWave: { count: number; checksum: number };
  waveform: { count: number; checksum: number };
  customWaves: { count: number; checksum: number };
  shapes: { count: number; checksum: number };
  borders: { count: number; checksum: number };
  motionVectors: { count: number; checksum: number };
  post: {
    gammaAdj: number;
    videoEchoAlpha: number;
    videoEchoZoom: number;
    shaderMixAlpha: number;
    checksum: number;
  };
};

type PresetVisualBaseline = {
  id: string;
  frames: VisualFrameSignature[];
};

type VisualBaselineDocument = {
  version: number;
  frames: number[];
  tolerance: number;
  presets: PresetVisualBaseline[];
};

function readBaselines(root = process.cwd()) {
  return JSON.parse(
    readFileSync(
      join(root, 'assets', 'data', 'milkdrop-parity', 'visual-baselines.json'),
      'utf8',
    ),
  ) as VisualBaselineDocument;
}

function compareNumber(
  issues: string[],
  label: string,
  expected: number,
  actual: number,
  tolerance: number,
) {
  if (Math.abs(expected - actual) > tolerance) {
    issues.push(
      `${label} drifted: expected ${expected}, received ${actual} (tol ${tolerance}).`,
    );
  }
}

export function checkMilkdropVisualBaselines(root = process.cwd()) {
  const expected = readBaselines(root);
  const actual = generateMilkdropVisualBaselines(root);
  const issues: string[] = [];
  const actualById = new Map(
    actual.presets.map((preset) => [preset.id, preset]),
  );

  expected.presets.forEach((preset) => {
    const next = actualById.get(preset.id);
    if (!next) {
      issues.push(`Missing canonical visual baseline for ${preset.id}.`);
      return;
    }

    preset.frames.forEach((frame, index) => {
      const actualFrame = next.frames[index];
      if (!actualFrame || actualFrame.frame !== frame.frame) {
        issues.push(`Frame mismatch for ${preset.id} at index ${index}.`);
        return;
      }

      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} mainWave.count`,
        frame.mainWave.count,
        actualFrame.mainWave.count,
        0,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} mainWave.checksum`,
        frame.mainWave.checksum,
        actualFrame.mainWave.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} waveform.checksum`,
        frame.waveform.checksum,
        actualFrame.waveform.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} customWaves.checksum`,
        frame.customWaves.checksum,
        actualFrame.customWaves.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} shapes.checksum`,
        frame.shapes.checksum,
        actualFrame.shapes.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} borders.checksum`,
        frame.borders.checksum,
        actualFrame.borders.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} motionVectors.checksum`,
        frame.motionVectors.checksum,
        actualFrame.motionVectors.checksum,
        expected.tolerance,
      );
      compareNumber(
        issues,
        `${preset.id} frame ${frame.frame} post.checksum`,
        frame.post.checksum,
        actualFrame.post.checksum,
        expected.tolerance,
      );
    });
  });

  return { issues };
}

if (import.meta.main) {
  const { issues } = checkMilkdropVisualBaselines();
  if (issues.length > 0) {
    console.error('MilkDrop visual baseline check failed:\n');
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log('MilkDrop visual baseline check passed.');
}
