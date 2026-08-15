import { Glob } from 'bun';

const directories = ['src', 'scripts', 'tests'];
const patterns = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];

const matches: string[] = [];

const targetDirective = '@ts-' + 'nocheck';

for (const dir of directories) {
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: dir, absolute: false })) {
      const fullPath = `${dir}/${file}`;
      if (fullPath.endsWith('check-no-ts-nocheck.ts')) continue;
      const content = await Bun.file(fullPath).text();
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(targetDirective)) {
          matches.push(`${fullPath}:${i + 1}:${lines[i]}`);
        }
      }
    }
  }
}

if (matches.length > 0) {
  console.error('Found forbidden @ts-nocheck directives:');
  for (const match of matches) {
    console.error(match);
  }
  console.error('\nRemove @ts-nocheck and resolve the underlying type issues.');
  process.exit(1);
}

console.log('No @ts-nocheck directives found in src/, scripts/, or tests/.');
