import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type ToyManifest,
  toyManifestSchema,
} from '../assets/js/data/toy-schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const IGNORED_TOY_FILES = new Set(['page-toy.ts']);

async function main() {
  const { issues, warnings } = await runToyChecks();

  if (warnings.length) {
    console.warn('Warnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (issues.length) {
    console.error('Toy checks failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('All toys registered and entry points are healthy.');
}

export async function runToyChecks(root = repoRoot) {
  const issues: string[] = [];
  const warnings: string[] = [];

  try {
    const entries = await loadToyData(root);
    const indexContents = await fs.readFile(
      path.join(root, 'docs/TOY_SCRIPT_INDEX.md'),
      'utf8',
    );

    validateEntries(entries, issues, warnings, indexContents, root);
    await detectUnregisteredToyFiles(entries, issues, root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, warnings };
}

async function loadToyData(root = repoRoot) {
  const dataPath = path.join(root, 'assets/data/toys.json');
  const source = await fs.readFile(dataPath, 'utf8');
  const parsed = toyManifestSchema.parse(JSON.parse(source));
  return parsed;
}

function validateEntries(
  entries: ToyManifest,
  issues: string[],
  warnings: string[],
  indexContents: string,
  root = repoRoot,
) {
  for (const entry of entries) {
    const modulePath = path.join(root, entry.module);
    if (
      entry.type === 'module' &&
      !entry.module.startsWith('assets/js/toys/')
    ) {
      issues.push(
        `Module path for ${entry.slug} should live under assets/js/toys/.`,
      );
    }
    if (entry.type === 'page' && !entry.module.endsWith('.html')) {
      issues.push(`Page entry for ${entry.slug} should point to an HTML file.`);
    }

    if (!entry.description.trim()) {
      warnings.push(`Description missing or empty for ${entry.slug}.`);
    }

    if (entry.type === 'module') {
      issues.push(...missingFiles(entry, modulePath, root));
    }

    if (entry.type === 'page') {
      const htmlPath = path.join(root, entry.module);
      missingFiles(entry, htmlPath, root).forEach((missing) =>
        issues.push(missing),
      );
    }

    if (!indexContents.includes(`| \`${entry.slug}\``)) {
      warnings.push(
        `docs/TOY_SCRIPT_INDEX.md is missing an entry for ${entry.slug}.`,
      );
    }
  }
}

function missingFiles(
  entry: ToyManifest[number],
  targetPath: string,
  root = repoRoot,
) {
  return [targetPath]
    .filter((filePath) => filePath)
    .map((filePath) => ({ filePath, exists: fileExistsSync(filePath) }))
    .filter(({ exists }) => !exists)
    .map(
      ({ filePath }) =>
        `Missing file for ${entry.slug}: ${path.relative(root, filePath).replace(/\\/g, '/')}`,
    );
}

async function detectUnregisteredToyFiles(
  entries: ToyManifest,
  issues: string[],
  root = repoRoot,
) {
  const registeredModules = new Set(
    entries.map((entry) => entry.module.replace(/\\/g, '/')),
  );
  const toyDir = path.join(root, 'assets/js/toys');
  const files = await fs.readdir(toyDir);

  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    if (IGNORED_TOY_FILES.has(file)) continue;

    const modulePath = path.join('assets/js/toys', file).replace(/\\/g, '/');
    if (!registeredModules.has(modulePath)) {
      issues.push(`Unregistered toy module detected: ${modulePath}`);
    }
  }
}

function fileExistsSync(targetPath: string) {
  try {
    fsSync.accessSync(targetPath, fsSync.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
