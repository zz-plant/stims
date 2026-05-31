import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_DIR = resolve(import.meta.dirname || '.', '..', 'public');
const API_BASE = process.env.API_BASE || 'http://localhost:5173';

async function main() {
  const catalogPath = resolve(PUBLIC_DIR, 'milkdrop-presets', 'catalog.json');
  const entries = JSON.parse(readFileSync(catalogPath, 'utf-8')).presets || [];

  const needsThumbnail = entries.filter((e: { preview?: boolean }) => !e.preview);

  console.log(`${needsThumbnail.length} presets need thumbnails`);

  let done = 0;
  const limit = Math.min(needsThumbnail.length, 100);
  for (const entry of needsThumbnail.slice(0, 100)) {
    try {
      const res = await fetch(`${API_BASE}/api/generate-thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: entry.id,
          title: entry.title,
          description:
            (entry.tags || []).join(', ') || 'abstract visualizer preset',
        }),
      });
      if (res.ok) {
        done++;
        console.log(
          `  OK: ${entry.id} (${done}/${limit})`,
        );
      } else {
        console.log(`  FAIL: ${entry.id} - ${res.status}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`  ERR: ${entry.id} - ${message}`);
    }
  }

  console.log(`Done. ${done} thumbnails generated.`);
}

main().catch(console.error);
