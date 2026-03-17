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

const REGENERATE_COMMAND = 'bun run generate:toys';
const TOY_START_EXPORT_PATTERN =
  /export\s+(async\s+)?function\s+start\b|export\s+const\s+start\b|export\s*\{\s*start\s*\}\s*from\b/;

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
    const [loadedToyData, indexContents] = await Promise.all([
      loadToyData(root),
      fs.readFile(path.join(root, 'docs/TOY_SCRIPT_INDEX.md'), 'utf8'),
    ]);
    const { manifest: entries, rawEntries, relativePath } = loadedToyData;

    await validateEntries(entries, issues, warnings, indexContents, root);
    await validateRegisteredToyEntrypoints(entries, issues, root);
    validateSlugEntrypointConsistency(entries, issues);
    await detectUnregisteredToyFiles(entries, issues, root);
    validateBehaviorMetadataParity(entries, rawEntries, relativePath, issues);
    await validateGeneratedArtifactParity(entries, issues, root);
    await validateCapabilityClaims(entries, issues, root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return { issues, warnings };
}

async function loadToyData(root = repoRoot) {
  const { entries, rawEntries, relativePath } = await loadToyRegistry(root);
  try {
    return {
      manifest: toyManifestSchema.parse(entries),
      rawEntries,
      relativePath,
    };
  } catch (error) {
    throw new Error(
      `Toy metadata schema validation failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}\nRegenerate derived artifacts with: ${REGENERATE_COMMAND}`,
    );
  }
}

function validateBehaviorMetadataParity(
  entries: ToyManifest,
  rawEntries: unknown,
  relativePath: string,
  issues: string[],
) {
  const expected = `${JSON.stringify(entries, null, 2)}\n`;
  const actual = `${JSON.stringify(rawEntries, null, 2)}\n`;
  if (expected === actual) {
    return;
  }

  issues.push(
    `Behavior-derived interaction metadata is out of date in ${relativePath}.\nRun: ${REGENERATE_COMMAND}`,
  );
}

async function validateRegisteredToyEntrypoints(
  entries: ToyManifest,
  issues: string[],
  root = repoRoot,
) {
  for (const entry of entries) {
    if (entry.type !== 'module') continue;

    const modulePath = path.join(root, entry.module);
    const fileContents = await fs.readFile(modulePath, 'utf8');
    if (TOY_START_EXPORT_PATTERN.test(fileContents)) {
      continue;
    }

    issues.push(
      `Registered toy entrypoint is missing an exported start() function for ${entry.slug}: ${entry.module}\nExport start() or fix assets/data/toys.json, then run: ${REGENERATE_COMMAND}`,
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

    const modulePath = path.join('assets/js/toys', file).replace(/\\/g, '/');
    if (registeredModules.has(modulePath)) continue;

    const fileContents = await fs.readFile(path.join(toyDir, file), 'utf8');
    const looksLikeToyEntrypoint = TOY_START_EXPORT_PATTERN.test(fileContents);
    if (!looksLikeToyEntrypoint) continue;

    issues.push(
      `Unregistered toy module detected: ${modulePath}\nEither register it in assets/data/toys.json or remove the file, then run: ${REGENERATE_COMMAND}`,
    );
  }
}

async function validateCapabilityClaims(
  entries: ToyManifest,
  issues: string[],
  root = repoRoot,
) {
  const hasWebGpuOnlyToy = entries.some(
    (entry) => entry.requiresWebGPU && !entry.allowWebGLFallback,
  );

  if (hasWebGpuOnlyToy) return;

  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const staleClaims = [
    'WebGPU-only toys (like [`multi`](./multi.html))',
    '| Browser | WebGL toys | Microphone input | WebGPU-only toys |',
  ];

  for (const claim of staleClaims) {
    if (!readme.includes(claim)) continue;
    issues.push(
      `README contains stale WebGPU-only wording ("${claim}") but assets/data/toys.json currently exposes fallback for all toys. Update README copy or metadata to match.`,
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
