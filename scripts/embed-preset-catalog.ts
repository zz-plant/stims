import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_DIR = resolve(import.meta.dirname || '.', '..', 'public');
const API_BASE = process.env.API_BASE || 'http://localhost:5173';

interface CatalogEntry {
  id: string;
  title: string;
  author?: string;
  tags?: string[];
}

interface CatalogDocument {
  presets?: CatalogEntry[];
}

async function loadCatalog(path: string): Promise<CatalogEntry[]> {
  if (!existsSync(path)) {
    console.warn(`Catalog not found: ${path}`);
    return [];
  }
  const raw = readFileSync(path, 'utf-8');
  const doc = JSON.parse(raw) as CatalogEntry[] | CatalogDocument;
  if (Array.isArray(doc)) return doc;
  return doc.presets ?? [];
}

function describePreset(entry: CatalogEntry): string {
  const parts: string[] = [];
  parts.push(`Preset titled "${entry.title}"`);
  if (entry.author) {
    parts.push(`by ${entry.author}`);
  }
  if (entry.tags && entry.tags.length > 0) {
    const moodTags = entry.tags.filter(
      (t) =>
        !t.startsWith('collection:') &&
        !t.startsWith('source:') &&
        t !== 'preset',
    );
    if (moodTags.length > 0) {
      parts.push(`described as ${moodTags.join(', ')}`);
    }
  }
  return parts.join(', ');
}

async function embedDescription(
  description: string,
): Promise<number[]> {
  const response = await fetch(`${API_BASE}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, embedOnly: true }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = (await response.json()) as { embedding?: number[] };
  if (!data.embedding) {
    throw new Error('No embedding returned from API');
  }

  return data.embedding;
}

async function storeEmbedding(
  presetId: string,
  embedding: number[],
  description: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/store-embedding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      presetId,
      embedding: embedding,
      description,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Store embedding error: ${response.status} ${text}`);
  }
}

async function main() {
  const catalogPaths = [
    resolve(PUBLIC_DIR, 'milkdrop-presets', 'catalog.json'),
    resolve(
      PUBLIC_DIR,
      'milkdrop-presets',
      'libraries',
      'projectm-cream-of-the-crop',
      'catalog.json',
    ),
    resolve(
      PUBLIC_DIR,
      'milkdrop-presets',
      'libraries',
      'projectm-upstream',
      'catalog.json',
    ),
  ];

  let total = 0;
  let succeeded = 0;
  let failed = 0;

  for (const catalogPath of catalogPaths) {
    const entries = await loadCatalog(catalogPath);
    console.log(
      `Loaded ${entries.length} presets from ${catalogPath}`,
    );

    for (const entry of entries) {
      total++;
      try {
        const description = describePreset(entry);
        const embedding = await embedDescription(description);
        await storeEmbedding(entry.id, embedding, description);
        succeeded++;
        console.log(`  OK: ${entry.id}`);
      } catch (error) {
        failed++;
        console.error(
          `  FAIL: ${entry.id} - ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  console.log(
    `\nDone. Total: ${total}, Succeeded: ${succeeded}, Failed: ${failed}`,
  );
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
