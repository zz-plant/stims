import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_ROOT = path.resolve('assets/js');
const JS_SOURCE_PATTERN = /\.(?:ts|tsx|js)$/;
const IGNORED_SEGMENTS = new Set(['lib']);
const CORE_TO_UTILS_ALLOWLIST = new Set([
  'assets/js/utils/device-detect.ts',
  'assets/js/utils/device-detect.js',
]);

type ArchitectureLayer =
  | 'app'
  | 'frontend'
  | 'legacy'
  | 'core'
  | 'ui'
  | 'utils'
  | 'data'
  | 'toy'
  | 'milkdrop-public'
  | 'milkdrop';

type ArchitectureViolation = {
  source: string;
  sourceLayer: ArchitectureLayer;
  target: string;
  targetLayer: ArchitectureLayer;
  specifier: string;
  reason: string;
};

function normalizeRelative(filePath: string) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

export function classifyArchitectureLayer(
  filePath: string,
): ArchitectureLayer | null {
  const relative = normalizeRelative(filePath);

  if (relative === 'assets/js/app.ts') return 'app';
  if (relative.startsWith('assets/js/frontend/')) return 'frontend';
  if (
    relative === 'assets/js/loader.ts' ||
    relative === 'assets/js/router.ts' ||
    relative === 'assets/js/toy-view.ts' ||
    relative === 'assets/js/library-view.js' ||
    relative.startsWith('assets/js/bootstrap/') ||
    relative.startsWith('assets/js/library-view/') ||
    relative.startsWith('assets/js/loader/')
  ) {
    return 'legacy';
  }
  if (relative.startsWith('assets/js/core/')) return 'core';
  if (relative.startsWith('assets/js/ui/')) {
    return 'ui';
  }
  if (relative.startsWith('assets/js/data/')) return 'data';
  if (relative.startsWith('assets/js/toys/')) return 'toy';
  if (relative.startsWith('assets/js/milkdrop/public/')) {
    return 'milkdrop-public';
  }
  if (relative.startsWith('assets/js/milkdrop/')) return 'milkdrop';
  if (relative.startsWith('assets/js/utils/')) return 'utils';

  return null;
}

export function isArchitectureDependencyAllowed({
  sourceLayer,
  targetLayer,
  targetPath,
}: {
  sourceLayer: ArchitectureLayer;
  targetLayer: ArchitectureLayer;
  targetPath: string;
}) {
  const relativeTarget = normalizeRelative(targetPath);

  if (sourceLayer === 'data') {
    return targetLayer === 'data';
  }

  if (targetLayer === 'data') {
    return true;
  }

  if (sourceLayer === 'app') {
    return (
      targetLayer === 'frontend' ||
      targetLayer === 'core' ||
      targetLayer === 'utils'
    );
  }

  if (sourceLayer === 'core') {
    if (targetLayer === 'core') return true;
    if (
      targetLayer === 'utils' &&
      CORE_TO_UTILS_ALLOWLIST.has(relativeTarget)
    ) {
      return true;
    }
    return false;
  }

  if (sourceLayer === 'utils') {
    return targetLayer === 'utils';
  }

  if (sourceLayer === 'frontend') {
    return (
      targetLayer === 'frontend' ||
      targetLayer === 'core' ||
      targetLayer === 'ui' ||
      targetLayer === 'utils' ||
      targetLayer === 'milkdrop-public' ||
      targetLayer === 'milkdrop'
    );
  }

  if (sourceLayer === 'ui') {
    return (
      targetLayer === 'ui' || targetLayer === 'core' || targetLayer === 'utils'
    );
  }

  if (sourceLayer === 'legacy') {
    return (
      targetLayer === 'legacy' ||
      targetLayer === 'core' ||
      targetLayer === 'ui' ||
      targetLayer === 'utils' ||
      targetLayer === 'toy' ||
      targetLayer === 'milkdrop-public'
    );
  }

  if (sourceLayer === 'toy') {
    return (
      targetLayer === 'toy' ||
      targetLayer === 'core' ||
      targetLayer === 'utils' ||
      targetLayer === 'milkdrop-public' ||
      targetLayer === 'milkdrop'
    );
  }

  if (sourceLayer === 'milkdrop-public') {
    return (
      targetLayer === 'milkdrop-public' ||
      targetLayer === 'milkdrop' ||
      targetLayer === 'core' ||
      targetLayer === 'utils'
    );
  }

  if (sourceLayer === 'milkdrop') {
    return (
      targetLayer === 'milkdrop' ||
      targetLayer === 'milkdrop-public' ||
      targetLayer === 'core' ||
      targetLayer === 'utils'
    );
  }

  return true;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_SEGMENTS.has(entry.name)) {
          return [];
        }
        return listSourceFiles(absolutePath);
      }

      if (!JS_SOURCE_PATTERN.test(entry.name)) {
        return [];
      }

      return [absolutePath];
    }),
  );

  return files.flat();
}

function extractSpecifiers(sourceText: string) {
  const specifiers = new Set<string>();
  const staticImportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    let match: RegExpExecArray | null = pattern.exec(sourceText);
    while (match) {
      const specifier = match[1]?.trim();
      if (specifier?.startsWith('.')) {
        specifiers.add(specifier);
      }
      match = pattern.exec(sourceText);
    }
  }

  return [...specifiers];
}

function resolveLocalImport(importer: string, specifier: string) {
  const resolvedBase = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    path.join(resolvedBase, 'index.ts'),
    path.join(resolvedBase, 'index.tsx'),
    path.join(resolvedBase, 'index.js'),
  ];

  return candidates.find((candidate) => JS_SOURCE_PATTERN.test(candidate));
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

export async function collectArchitectureViolations() {
  const files = await listSourceFiles(SOURCE_ROOT);
  const violations: ArchitectureViolation[] = [];

  for (const filePath of files) {
    const sourceLayer = classifyArchitectureLayer(filePath);
    if (!sourceLayer) continue;

    const sourceText = await fs.readFile(filePath, 'utf8');
    const specifiers = extractSpecifiers(sourceText);

    for (const specifier of specifiers) {
      const resolvedPath = resolveLocalImport(filePath, specifier);
      if (!resolvedPath) continue;
      if (!(await pathExists(resolvedPath))) continue;
      if (!resolvedPath.startsWith(SOURCE_ROOT)) continue;

      const targetLayer = classifyArchitectureLayer(resolvedPath);
      if (!targetLayer) continue;

      if (
        isArchitectureDependencyAllowed({
          sourceLayer,
          targetLayer,
          targetPath: resolvedPath,
        })
      ) {
        continue;
      }

      const reason =
        sourceLayer === 'core' && targetLayer === 'utils'
          ? `core may only depend on allowlisted utils helpers (${[
              ...CORE_TO_UTILS_ALLOWLIST,
            ].join(', ')})`
          : `${sourceLayer} must not depend on ${targetLayer}`;

      violations.push({
        source: normalizeRelative(filePath),
        sourceLayer,
        target: normalizeRelative(resolvedPath),
        targetLayer,
        specifier,
        reason,
      });
    }
  }

  return violations.sort((a, b) => a.source.localeCompare(b.source));
}

async function main() {
  const violations = await collectArchitectureViolations();
  if (violations.length === 0) {
    console.log('Architecture boundaries are healthy.');
    return;
  }

  console.error('Architecture boundary violations detected:');
  violations.forEach((violation) => {
    console.error(
      `- ${violation.source} (${violation.sourceLayer}) -> ${violation.target} (${violation.targetLayer}) via "${violation.specifier}": ${violation.reason}`,
    );
  });
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
