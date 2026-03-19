import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateMilkdropVisualBaselines } from './milkdrop-visual-regression.ts';

const outputPath = join(
  process.cwd(),
  'assets',
  'data',
  'milkdrop-parity',
  'visual-baselines.json',
);

const baselines = generateMilkdropVisualBaselines(process.cwd());
writeFileSync(outputPath, `${JSON.stringify(baselines)}\n`, 'utf8');

const formatProc = Bun.spawnSync({
  cmd: ['bunx', 'biome', 'check', '--write', outputPath],
  cwd: process.cwd(),
  stdout: 'inherit',
  stderr: 'inherit',
});

if (formatProc.exitCode !== 0) {
  process.exit(formatProc.exitCode);
}

console.log(`Wrote MilkDrop visual baselines to ${outputPath}`);
