import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type ToyManifest,
  toyManifestSchema,
} from '../assets/js/data/toy-schema.ts';
import {
  buildManifestModule,
  buildManifestSource,
  buildPublicToysJson,
  GENERATED_PUBLIC_TOYS_PATH,
  GENERATED_TOY_MANIFEST_PATH,
} from './generate-toy-manifest.ts';
import { loadToyRegistry } from './toy-registry.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const IGNORED_TOY_FILES = new Set(['clay-toy.ts', 'page-toy.ts']);
const REGENERATE_COMMAND = 'bun run generate:toys';

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

  console.log(
    'All toy metadata, generated artifacts, and entry points are healthy.',
  );
}

export async function runToyChecks(root = repoRoot) {
  const issues: string[] = [];
  const warnings: string[] = [];

  try {
    const [entries, indexContents] = await Promise.all([
      loadToyData(root),
      fs.readFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), 'utf8'),
    ]);

    await validateEntries(entries, issues, warnings, indexContents, root);
    validateSlugEntrypointConsistency(entries, issues);
    await detectUnregisteredToyFiles(entries, issues, root);
    await validateGeneratedArtifactParity(entries, issues, root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, warnings };
}

async function loadToyData(root = repoRoot) {
  const { entries, relativePath } = await loadToyRegistry(root);
  try {
    return toyManifestSchema.parse(entries);
  } catch (error) {
    throw new Error(
      `Toy metadata schema validation failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}\nRegenerate derived artifacts with: ${REGENERATE_COMMAND}`,
    );
  }
}

async function validateEntries(
  entries: ToyManifest,
  issues: string[],
  warnings: string[],
  indexContents: string,
  root = repoRoot,
) {
  for (const entry of entries) {
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

    const targetPath = path.join(root, entry.module);
    const exists = await fileExists(targetPath);
    if (!exists) {
      issues.push(
        `Missing file for ${entry.slug}: ${path.relative(root, targetPath).replace(/\\/g, '/')}\nCreate the file or update assets/data/toys.json, then regenerate with: ${REGENERATE_COMMAND}`,
      );
    }

    if (!indexContents.includes(`| \`${entry.slug}\``)) {
      warnings.push(
        `docs/TOY_SCRIPT_INDEX.md is missing an entry for ${entry.slug}.`,
      );
    }
  }
}

function validateSlugEntrypointConsistency(
  entries: ToyManifest,
  issues: string[],
) {
  const slugs = new Set<string>();
  const modules = new Set<string>();

  for (const entry of entries) {
    const normalizedModule = entry.module.replace(/\\/g, '/');

    if (slugs.has(entry.slug)) {
      issues.push(
        `Duplicate slug found in assets/data/toys.json: ${entry.slug}.`,
      );
    }
    slugs.add(entry.slug);

    if (modules.has(normalizedModule)) {
      issues.push(
        `Duplicate module entrypoint found in assets/data/toys.json: ${normalizedModule}.`,
      );
    }
    modules.add(normalizedModule);

    if (entry.type === 'module' && !normalizedModule.endsWith('.ts')) {
      issues.push(
        `Module entrypoint mismatch for ${entry.slug}: module entries must point to a TypeScript file, found "${normalizedModule}".`,
      );
    }

    if (entry.type === 'page') {
      const expectedPagePath = `toys/${entry.slug}.html`;
      if (normalizedModule !== expectedPagePath) {
        issues.push(
          `Page entrypoint mismatch for ${entry.slug}: expected "${expectedPagePath}" but found "${normalizedModule}".`,
        );
      }
    }
  }
}

async function validateGeneratedArtifactParity(
  entries: ToyManifest,
  issues: string[],
  root = repoRoot,
) {
  const manifest = buildManifestSource(entries, 'assets/data/toys.json');
  const expectedManifestModule = buildManifestModule(manifest);
  const expectedPublicToys = buildPublicToysJson(manifest);

  await compareGeneratedFile(
    root,
    GENERATED_TOY_MANIFEST_PATH,
    expectedManifestModule,
    issues,
  );
  await compareGeneratedFile(
    root,
    GENERATED_PUBLIC_TOYS_PATH,
    expectedPublicToys,
    issues,
  );
}

async function compareGeneratedFile(
  root: string,
  relativePath: string,
  expected: string,
  issues: string[],
) {
  const absolutePath = path.join(root, relativePath);
  const exists = await fileExists(absolutePath);

  if (!exists) {
    issues.push(
      `Generated artifact missing: ${relativePath}\nRun: ${REGENERATE_COMMAND}`,
    );
    return;
  }

  const actual = await fs.readFile(absolutePath, 'utf8');
  if (actual !== expected) {
    issues.push(
      `Generated artifact out of date: ${relativePath}\nRun: ${REGENERATE_COMMAND}`,
    );
  }
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
    if (registeredModules.has(modulePath)) continue;

    const fileContents = await fs.readFile(path.join(toyDir, file), 'utf8');
    const looksLikeToyEntrypoint =
      /export\s+(async\s+)?function\s+start\b|export\s+const\s+start\b/.test(
        fileContents,
      );
    if (!looksLikeToyEntrypoint) continue;

    issues.push(
      `Unregistered toy module detected: ${modulePath}\nEither register it in assets/data/toys.json or remove the file, then run: ${REGENERATE_COMMAND}`,
    );
  }
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
