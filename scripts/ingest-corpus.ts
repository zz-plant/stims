/**
 * Bulk-ingest a .milk corpus into an exploratory preset library, gated by the
 * real Stims compiler (strict, no salvage) and exact-content dedupe against
 * everything already in the catalog and libraries.
 *
 * The corpus's top-level directories are treated as category tags (the
 * cream-of-the-crop pack organizes presets as Dancer/, Fractal/, etc.).
 * With --limit, the budget is spread evenly across categories so the ingest
 * doesn't skew toward whichever directory sorts first.
 *
 * Usage:
 *   bun run scripts/ingest-corpus.ts --source=/path/to/corpus [--limit=2000] [--dry]
 *   # target library defaults to projectm-cream-of-the-crop
 *   bun run scripts/ingest-corpus.ts --source=... --library=my-library
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { countEquationLines } from '../src/js/milkdrop/salvage-compile.ts';
import { normalizeMilkdropShaderSamplerName } from '../src/js/milkdrop/shader-samplers.ts';

// Same predicate as tests/unit/catalog-compiler-smoke.test.ts: every sampler
// token must resolve, or the preset references texture packs we don't ship.
const SAMPLER_TOKEN_PATTERN = /\b(?:sampler_\w+|fw_\w+|blur[123])\b/gi;

function hasUnrecognizedSampler(raw: string): boolean {
  for (const token of raw.match(SAMPLER_TOKEN_PATTERN) ?? []) {
    if (normalizeMilkdropShaderSamplerName(token) === null) return true;
  }
  return false;
}

const REPO_ROOT = path.join(import.meta.dir, '..');
const PRESETS_ROOT = path.join(REPO_ROOT, 'public', 'milkdrop-presets');

type LibraryEntry = {
  id: string;
  title: string;
  author?: string;
  file: string;
  tags: string[];
  order: number;
};

type LibraryCatalog = {
  version: number;
  libraryId: string;
  libraryName: string;
  certification: string;
  corpusTier: string;
  presets: LibraryEntry[];
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
}

function normalizedHash(source: string): string {
  const normalized = source
    .toLowerCase()
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** "Author - Title === Other Author - Title --- editor edit" → first segment */
function parseAuthorTitle(basename: string): {
  author?: string;
  title: string;
} {
  const primary = basename.split(/\s*(?:===|---)\s*/u)[0].trim();
  const parts = primary.split(/\s+-\s+/u);
  if (parts.length > 1) {
    return {
      author: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim(),
    };
  }
  return { title: primary };
}

function collectExistingHashes(): Set<string> {
  const hashes = new Set<string>();
  const roots = [PRESETS_ROOT, path.join(PRESETS_ROOT, 'butterchurn')];
  const librariesDir = path.join(PRESETS_ROOT, 'libraries');
  if (fs.existsSync(librariesDir)) {
    for (const lib of fs.readdirSync(librariesDir)) {
      roots.push(path.join(librariesDir, lib));
    }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of fs.readdirSync(root)) {
      if (!file.endsWith('.milk')) continue;
      hashes.add(
        normalizedHash(fs.readFileSync(path.join(root, file), 'utf8')),
      );
    }
  }
  return hashes;
}

function walkMilkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory() && item.name !== '.git')
      out.push(...walkMilkFiles(full));
    else if (item.name.endsWith('.milk')) out.push(full);
  }
  return out;
}

export function ingestCorpus(opts: {
  source: string;
  library: string;
  limit: number | null;
  dry: boolean;
}) {
  const libraryDir = path.join(PRESETS_ROOT, 'libraries', opts.library);
  const libraryCatalogPath = path.join(libraryDir, 'catalog.json');
  if (!fs.existsSync(libraryCatalogPath)) {
    throw new Error(`library catalog not found: ${libraryCatalogPath}`);
  }
  const catalog: LibraryCatalog = JSON.parse(
    fs.readFileSync(libraryCatalogPath, 'utf8'),
  );
  const existingIds = new Set(catalog.presets.map((p) => p.id));
  const existingHashes = collectExistingHashes();

  const files = walkMilkFiles(opts.source);
  // Group by top-level category directory relative to the corpus root.
  const byCategory = new Map<string, string[]>();
  for (const file of files) {
    const rel = path.relative(opts.source, file);
    const category = rel.includes(path.sep)
      ? rel.split(path.sep)[0]
      : 'uncategorized';
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(file);
    else byCategory.set(category, [file]);
  }
  // Transitions are scene-change utilities, not standalone visuals.
  byCategory.delete('! Transition');

  const stats = {
    scanned: 0,
    compileFailed: 0,
    duplicate: 0,
    ingested: 0,
    perCategory: new Map<string, number>(),
  };
  const perCategoryBudget = opts.limit
    ? Math.ceil(opts.limit / byCategory.size)
    : Number.POSITIVE_INFINITY;
  let nextOrder =
    catalog.presets.reduce((max, p) => Math.max(max, p.order), 0) + 1;

  for (const [category, categoryFiles] of byCategory) {
    let accepted = 0;
    for (const file of categoryFiles) {
      if (accepted >= perCategoryBudget) break;
      if (opts.limit && stats.ingested >= opts.limit) break;
      stats.scanned++;
      const basename = path.basename(file, '.milk');
      const id = slugify(`cotc-${basename}`);
      if (existingIds.has(id)) {
        stats.duplicate++;
        continue;
      }
      let raw: string;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const hash = normalizedHash(raw);
      if (existingHashes.has(hash)) {
        stats.duplicate++;
        continue;
      }
      // The compiler is deliberately lenient (diagnostics, not throws), so
      // the gate is: no error-severity diagnostics, and the source carries
      // at least one equation line (rejects empty/degenerate presets).
      try {
        const compiled = compileMilkdropPresetSource(raw, { id });
        const hasErrors = compiled.diagnostics?.some(
          (d: { severity?: string }) => d.severity === 'error',
        );
        // Library presets carry a "fully supported on both backends"
        // guarantee (tests/unit/milkdrop-projectm-cream-library.test.ts).
        const backends = compiled.ir.compatibility.backends;
        const fullySupported =
          backends.webgl.status === 'supported' &&
          backends.webgpu.status === 'supported';
        if (
          hasErrors ||
          !fullySupported ||
          countEquationLines(raw) === 0 ||
          hasUnrecognizedSampler(raw)
        ) {
          stats.compileFailed++;
          continue;
        }
      } catch {
        stats.compileFailed++;
        continue;
      }

      const { author, title } = parseAuthorTitle(basename);
      const targetFile = `${id}.milk`;
      const entry: LibraryEntry = {
        id,
        title: author ? `${author} - ${title}` : title,
        ...(author ? { author } : {}),
        file: `/milkdrop-presets/libraries/${opts.library}/${targetFile}`,
        tags: [
          'collection:cream-of-the-crop',
          'projectm-github',
          `category:${slugify(category)}`,
          'preset',
        ],
        order: nextOrder++,
      };
      if (!opts.dry) {
        fs.writeFileSync(path.join(libraryDir, targetFile), raw, 'utf8');
        catalog.presets.push(entry);
      }
      existingIds.add(id);
      existingHashes.add(hash);
      stats.ingested++;
      accepted++;
      stats.perCategory.set(category, accepted);
    }
  }

  if (!opts.dry && stats.ingested > 0) {
    fs.writeFileSync(
      libraryCatalogPath,
      JSON.stringify(catalog, null, 2),
      'utf8',
    );
  }

  console.log(
    `[ingest-corpus] scanned ${stats.scanned}: ingested ${stats.ingested}, compile-failed ${stats.compileFailed}, duplicates ${stats.duplicate}${opts.dry ? ' (dry run)' : ''}`,
  );
  for (const [category, count] of stats.perCategory) {
    console.log(`  ${category}: ${count}`);
  }
  return stats;
}

if (import.meta.main) {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const source = arg('source');
  if (!source) {
    console.error(
      'usage: ingest-corpus.ts --source=<dir> [--library=<id>] [--limit=N] [--dry]',
    );
    process.exit(1);
  }
  ingestCorpus({
    source,
    library: arg('library') ?? 'projectm-cream-of-the-crop',
    limit: arg('limit') ? Number.parseInt(arg('limit') as string, 10) : null,
    dry: process.argv.includes('--dry'),
  });
}
