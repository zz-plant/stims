import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToyManifest } from '../assets/js/data/toy-schema.ts';

const TOY_DATA_RELATIVE_PATH = 'assets/data/toys.json';

export type LoadedToyRegistry = {
  entries: unknown;
  dataPath: string;
  relativePath: string;
};

export async function loadToyRegistry(
  root: string,
): Promise<LoadedToyRegistry> {
  const dataPath = path.join(root, TOY_DATA_RELATIVE_PATH);

  try {
    await fs.access(dataPath);
  } catch {
    throw new Error(
      `Toy metadata source is missing: ${TOY_DATA_RELATIVE_PATH}. Regenerate derived artifacts after restoring it with: bun run generate:toys`,
    );
  }

  const source = await fs.readFile(dataPath, 'utf8');
  const entries = JSON.parse(source) as unknown;

  return {
    entries,
    dataPath,
    relativePath: TOY_DATA_RELATIVE_PATH,
  };
}

export async function saveToyRegistry(
  root: string,
  relativePath: string,
  entries: ToyManifest,
): Promise<void> {
  const dataPath = path.join(root, relativePath);
  const serialized = `${JSON.stringify(entries, null, 2)}\n`;

  await fs.writeFile(dataPath, serialized, 'utf8');
}
