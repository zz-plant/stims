export {};

type GateMode = 'quick' | 'full';

function parseMode(argv: string[]): GateMode {
  return argv.includes('--quick') ? 'quick' : 'full';
}

async function runStep(step: { label: string; cmd: string[] }) {
  console.log(`\n==> ${step.label}`);

  const proc = Bun.spawn({
    cmd: step.cmd,
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const noTsNoCheckLabel = ['No ', '@ts-', 'nocheck', ' guard'].join('');
  const steps = [
    {
      label: noTsNoCheckLabel,
      cmd: ['bun', 'run', 'check:no-ts-nocheck'],
    },
    {
      label: 'Biome check',
      cmd: ['bunx', 'biome', 'check', 'assets', 'scripts', 'tests'],
    },
    {
      label: 'TypeScript typecheck',
      cmd: ['bun', 'run', 'typecheck'],
    },
    {
      label: 'MilkDrop corpus check',
      cmd: ['bun', 'run', 'check:milkdrop-corpus'],
    },
    ...(mode === 'full'
      ? [
          {
            label: 'MilkDrop visual baseline check',
            cmd: ['bun', 'run', 'check:milkdrop-visuals'],
          },
          {
            label: 'Test suite',
            cmd: ['bun', 'run', 'test'],
          },
        ]
      : []),
  ];

  for (const step of steps) {
    await runStep(step);
  }
}

await main();
