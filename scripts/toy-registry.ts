import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ToyManifest } from '../assets/js/data/toy-schema.ts';

const TOY_DATA_RELATIVE_PATHS = [
  'assets/data/toys.json',
  'assets/data/toys.yaml',
  'assets/data/toys.yml',
] as const;

type ToyRegistryFormat = 'json' | 'yaml';

export type LoadedToyRegistry = {
  entries: unknown;
  dataPath: string;
  relativePath: string;
  format: ToyRegistryFormat;
};

export async function loadToyRegistry(
  root: string,
): Promise<LoadedToyRegistry> {
  const matches = await Promise.all(
    TOY_DATA_RELATIVE_PATHS.map(async (relativePath) => {
      const dataPath = path.join(root, relativePath);
      try {
        await fs.access(dataPath);
        return { dataPath, relativePath };
      } catch {
        return null;
      }
    }),
  );

  const existing = matches.filter((entry) => entry !== null);
  if (!existing.length) {
    throw new Error(
      `No toy metadata file found. Expected one of: ${TOY_DATA_RELATIVE_PATHS.join(', ')}`,
    );
  }

  if (existing.length > 1) {
    const paths = existing.map((entry) => entry.relativePath).join(', ');
    throw new Error(
      `Multiple toy metadata files found (${paths}). Keep only one source of truth.`,
    );
  }

  const selected = existing[0];
  const source = await fs.readFile(selected.dataPath, 'utf8');
  const format = selected.relativePath.endsWith('.json')
    ? ('json' as const)
    : ('yaml' as const);

  const entries =
    format === 'json'
      ? (JSON.parse(source) as unknown)
      : (parseYaml(source) as unknown);

  return {
    entries,
    dataPath: selected.dataPath,
    relativePath: selected.relativePath,
    format,
  };
}

export async function saveToyRegistry(
  root: string,
  relativePath: string,
  entries: ToyManifest,
): Promise<void> {
  const dataPath = path.join(root, relativePath);
  const format = relativePath.endsWith('.json') ? 'json' : 'yaml';
  const serialized =
    format === 'json'
      ? `${JSON.stringify(entries, null, 2)}\n`
      : `${stringifyYaml(entries, { indent: 2 })}`;

  await fs.writeFile(dataPath, serialized, 'utf8');
}
