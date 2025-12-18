import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

const htmlEntrypoints = (await readdir(rootDir))
  .filter((file) => file.endsWith('.html'))
  .map((file) => path.join(rootDir, file));

if (htmlEntrypoints.length === 0) {
  console.error('No HTML entry points found in the project root.');
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: htmlEntrypoints,
  outdir: path.join(rootDir, 'dist'),
  minify: true,
  sourcemap: 'external',
  splitting: true,
  target: 'browser',
  publicPath: '/',
  naming: {
    entry: '[name]-[hash].[ext]',
    chunk: 'chunks/[name]-[hash].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const output of result.outputs) {
  console.info(`built ${path.relative(rootDir, output.path)}`);
}
