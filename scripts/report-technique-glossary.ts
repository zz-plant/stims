/**
 * Recount the named-technique vocabulary in the shipped catalog.
 *
 * MilkDrop authors circulated techniques as named modules, cited in the title
 * of every preset that used one — "(Relief Mix)", "(Jelly V3)", "(+Krash's
 * beat code)". This reports how often each marker appears and which handles
 * are credited on those presets, which is the evidence behind the table in
 * `docs/authoring/09-technique-glossary.md`.
 *
 * A co-credit count shows who *applied* a technique, not who invented it.
 * Establishing origin needs dated sources the catalog does not carry.
 *
 *   bun run scripts/report-technique-glossary.ts
 *   bun run scripts/report-technique-glossary.ts --undocumented
 */
import fs from 'node:fs';
import path from 'node:path';
import { parsePresetCredit } from '../src/js/milkdrop/preset-credit.ts';
import { creditedHandles } from '../src/js/milkdrop/preset-handles.ts';

const CATALOG_PATH = path.join(
  process.cwd(),
  'public/milkdrop-presets/catalog.json',
);

/** The vocabulary the glossary documents, as title-matching patterns. */
const TECHNIQUES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Jelly', pattern: /\bjelly\b/i },
  { label: 'Painterly', pattern: /painterly/i },
  { label: 'Relief Mix', pattern: /relief\s*mix|bas relief/i },
  { label: 'Emboss', pattern: /emboss/i },
  { label: 'Ripple', pattern: /\bripples?\b/i },
  { label: 'Grow Mix', pattern: /grow\s*mix/i },
  { label: 'Saturation Remix', pattern: /saturation\s*(remix|boosted)/i },
  { label: 'Crossfire', pattern: /crossfire/i },
  { label: 'Kali Mix', pattern: /kali\s*mix/i },
  { label: 'Filament Mix', pattern: /filament/i },
  { label: 'Glow Mix', pattern: /glow\s*mix|everglow/i },
  { label: 'Kaleidoscope Mix', pattern: /kaleidoscope/i },
  { label: 'LSB Mix', pattern: /\blsb\b/i },
  { label: 'HPF', pattern: /\bhpf\b/i },
  { label: 'Composite Mix', pattern: /composite\s*mix|composite\b/i },
  { label: 'Flexi-Tex Shader', pattern: /flexi-?tex/i },
];

type CatalogPreset = { title: string; author?: string };

function main() {
  const catalog: { presets: CatalogPreset[] } = JSON.parse(
    fs.readFileSync(CATALOG_PATH, 'utf8'),
  );
  const presets = catalog.presets;

  console.log(`Catalog: ${presets.length} presets\n`);
  console.log('Technique                  Shipped  Most-credited');
  console.log(
    '-------------------------  -------  ---------------------------',
  );

  for (const { label, pattern } of TECHNIQUES) {
    const matches = presets.filter((preset) => pattern.test(preset.title));
    const credits = new Map<string, number>();
    for (const preset of matches) {
      for (const handle of creditedHandles(preset.author)) {
        credits.set(handle, (credits.get(handle) ?? 0) + 1);
      }
    }
    const top = [...credits]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([handle, count]) => `${handle} (${count})`)
      .join(', ');
    console.log(
      `${label.padEnd(25)}  ${String(matches.length).padStart(7)}  ${top || '—'}`,
    );
  }

  const componentCredits = new Map<string, number>();
  const compatibility = new Map<string, number>();
  let shaderVariants = 0;
  for (const preset of presets) {
    const credit = parsePresetCredit(preset.title, preset.author);
    for (const component of credit.componentCredits) {
      const key = `${component.author}'s ${component.component}`;
      componentCredits.set(key, (componentCredits.get(key) ?? 0) + 1);
    }
    for (const note of credit.compatibilityNotes) {
      const key = note.toLowerCase();
      compatibility.set(key, (compatibility.get(key) ?? 0) + 1);
    }
    if (credit.shaderModel) shaderVariants += 1;
  }

  console.log('\nInline component credits (code cited by author):');
  for (const [key, count] of componentCredits) {
    console.log(`  ${String(count).padStart(3)}  ${key}`);
  }

  console.log('\nCompatibility markers:');
  for (const [key, count] of compatibility) {
    console.log(`  ${String(count).padStart(3)}  ${key}`);
  }
  console.log(`  ${String(shaderVariants).padStart(3)}  shader-model variants`);

  if (!process.argv.includes('--undocumented')) return;

  // Mix names the glossary has no entry for — the queue for extending it.
  const undocumented = new Map<string, number>();
  for (const preset of presets) {
    const { mixName } = parsePresetCredit(preset.title, preset.author);
    if (!mixName) continue;
    if (TECHNIQUES.some(({ pattern }) => pattern.test(mixName))) continue;
    const key = mixName.toLowerCase();
    undocumented.set(key, (undocumented.get(key) ?? 0) + 1);
  }
  console.log('\nMix names with no glossary entry (2+ uses):');
  for (const [key, count] of [...undocumented]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${key}`);
  }
}

main();
