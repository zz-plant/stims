import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const toyEntrySchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    module: z.string().min(1),
    type: z.enum(['module', 'iframe']),
    requiresWebGPU: z.boolean().optional(),
    allowWebGLFallback: z.boolean().optional(),
  })
  .passthrough();

const toysDataSchema = z.array(toyEntrySchema);
const IGNORED_TOY_FILES = new Set(['iframe-toy.ts']);

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
      'utf8'
    );

    validateEntries(entries, issues, warnings, indexContents, root);
    await detectUnregisteredToyFiles(entries, issues, root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, warnings };
}

async function loadToyData(root = repoRoot) {
  const dataPath = path.join(root, 'assets/js/toys-data.js');
  const source = await fs.readFile(dataPath, 'utf8');
  const tempPath = path.join(
    tmpdir(),
    `toys-data-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`
  );
  await fs.writeFile(tempPath, source, 'utf8');
  const module = await import(pathToFileURL(tempPath).href);
  await fs.unlink(tempPath).catch(() => {});
  const parsed = toysDataSchema.parse(module.default);

  const seen = new Set<string>();
  for (const entry of parsed) {
    if (seen.has(entry.slug)) {
      throw new Error(
        `Duplicate slug detected in assets/js/toys-data.js: ${entry.slug}`
      );
    }
    seen.add(entry.slug);
  }

  return parsed;
}

function validateEntries(
  entries: z.infer<typeof toysDataSchema>,
  issues: string[],
  warnings: string[],
  indexContents: string,
  root = repoRoot
) {
  for (const entry of entries) {
    const modulePath = path.join(root, entry.module);
    if (!entry.module.startsWith('assets/js/toys/')) {
      issues.push(
        `Module path for ${entry.slug} should live under assets/js/toys/.`
      );
    }

    if (!entry.description.trim()) {
      warnings.push(`Description missing or empty for ${entry.slug}.`);
    }

    issues.push(...missingFiles(entry, modulePath, root));

    if (entry.type === 'iframe') {
      const htmlPath = path.join(root, `${entry.slug}.html`);
      missingFiles(entry, htmlPath, root).forEach((missing) =>
        issues.push(missing)
      );
    }

    if (!indexContents.includes(`| \`${entry.slug}\``)) {
      warnings.push(
        `docs/TOY_SCRIPT_INDEX.md is missing an entry for ${entry.slug}.`
      );
    }
  }
}

function missingFiles(
  entry: z.infer<typeof toyEntrySchema>,
  targetPath: string,
  root = repoRoot
) {
  return [targetPath]
    .filter((filePath) => filePath)
    .map((filePath) => ({ filePath, exists: fileExistsSync(filePath) }))
    .filter(({ exists }) => !exists)
    .map(
      ({ filePath }) =>
        `Missing file for ${entry.slug}: ${path.relative(root, filePath)}`
    );
}

async function detectUnregisteredToyFiles(
  entries: z.infer<typeof toysDataSchema>,
  issues: string[],
  root = repoRoot
) {
  const registeredModules = new Set(
    entries.map((entry) => path.normalize(entry.module))
  );
  const toyDir = path.join(root, 'assets/js/toys');
  const files = await fs.readdir(toyDir);

  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    if (IGNORED_TOY_FILES.has(file)) continue;

    const modulePath = path.normalize(path.join('assets/js/toys', file));
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
