#!/usr/bin/env bun
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join(import.meta.dirname ?? __dirname, '..', 'docs', 'assets');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type Spec = { width: number; height: number; minBytes: number };

const SPECS: Record<string, Spec> = {
  badge:   { width: 240,  height: 96,   minBytes:  5_000 },
  blur:    { width: 50,   height: 28,   minBytes:    500 },
  card:    { width: 400,  height: 300,  minBytes: 25_000 },
  circle:  { width: 540,  height: 540,  minBytes: 15_000 },
  dark:    { width: 960,  height: 540,  minBytes: 25_000 },
  demo:    { width: 720,  height: 405,  minBytes: 25_000 },
  email:   { width: 600,  height: 200,  minBytes: 20_000 },
  favicon: { width: 64,   height: 64,   minBytes:  1_000 },
  github:  { width: 1280, height: 640,  minBytes: 50_000 },
  header:  { width: 1920, height: 400,  minBytes: 25_000 },
  mastodon:{ width: 1200, height: 600,  minBytes: 50_000 },
  og:      { width: 1200, height: 675,  minBytes: 50_000 },
  square:  { width: 1080, height: 1080, minBytes: 50_000 },
  touch:   { width: 360,  height: 360,  minBytes: 20_000 },
  unfurl:  { width: 1200, height: 628,  minBytes: 50_000 },
};

const COLOR_TYPE_LABELS: Record<number, string> = {
  0: 'grayscale', 2: 'RGB', 3: 'indexed', 4: 'grayscale+alpha', 6: 'RGBA'
};

type PngInfo = { width: number; height: number; colorType: number; bitDepth: number; byteLength: number };

function readPngInfo(filePath: string): PngInfo {
  const buf = readFileSync(filePath);
  if (buf.length < 33) throw new Error('file too small for valid PNG');
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a valid PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
    bitDepth: buf.readUInt8(24),
    byteLength: buf.length,
  };
}

function main() {
  const files = readdirSync(ASSETS_DIR).filter(f => f.endsWith('.png')).sort();
  if (files.length === 0) {
    console.error(`FAIL: no PNGs found in ${ASSETS_DIR}`);
    process.exit(1);
  }

  const errors: string[] = [];
  const found = new Set<string>();
  const filesWithSizes = files.map(f => ({ name: f, size: statSync(join(ASSETS_DIR, f)).size }));

  const prefix = (files[0] ?? 'unknown').split('-')[0] ?? '';
  console.log(`\n🔍 Checking assets for «${prefix}» in ${ASSETS_DIR}\n`);

  for (const { name, size } of filesWithSizes) {
    const filePath = join(ASSETS_DIR, name);
    let typeKey = name.replace(/\.png$/, '').replace(new RegExp(`^${prefix}-`), '');

    if (typeKey.startsWith('dark-og')) typeKey = 'dark';
    else if (typeKey.startsWith('touch')) typeKey = 'touch';
    else if (typeKey.startsWith('github-preview')) typeKey = 'github';

    const spec = SPECS[typeKey];
    if (!spec) {
      try {
        const info = readPngInfo(filePath);
        found.add(typeKey);
        console.log(`  ⚠  ${name}  (${info.width}×${info.height}) — no spec, skipped`);
      } catch (e: unknown) {
        errors.push(`${name}: invalid PNG — ${(e as Error).message}`);
      }
      continue;
    }

    found.add(typeKey);
    try {
      const info = readPngInfo(filePath);

      if (info.width !== spec.width || info.height !== spec.height) {
        errors.push(`${name}: expected ${spec.width}×${spec.height}, got ${info.width}×${info.height}`);
        continue;
      }
      if (info.colorType === 3) {
        errors.push(`${name}: indexed color (type 3) — posterized`);
        continue;
      }
      if (info.bitDepth < 8) {
        errors.push(`${name}: low bit depth (${info.bitDepth}-bit)`);
        continue;
      }
      if (size < spec.minBytes) {
        errors.push(`${name}: ${size}B < ${spec.minBytes}B min — possible posterization or truncation`);
        continue;
      }

      const label = COLOR_TYPE_LABELS[info.colorType] ?? `type${info.colorType}`;
      console.log(`  ✅ ${name}  ${info.width}×${info.height}  ${size.toLocaleString()}B  ${label}`);
    } catch (e: unknown) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  const svgPath = join(ASSETS_DIR, 'source.svg');
  try {
    const svg = readFileSync(svgPath, 'utf8').trim();
    if (svg.startsWith('<svg') || svg.startsWith('<?xml')) {
      console.log(`  ✅ source.svg  (${(statSync(svgPath).size).toLocaleString()}B)  design reference`);
    } else {
      errors.push('source.svg: invalid SVG (missing <svg> root)');
    }
  } catch {
    errors.push('source.svg: missing — design source file required');
  }

  const expectedTypes = Object.keys(SPECS);
  const missing = expectedTypes.filter(t => !found.has(t));
  if (missing.length > 0) {
    console.log(`\n  ⚠  Missing types: ${missing.join(', ')}`);
  }

  console.log(`\n${errors.length === 0 ? '✅ All assets valid' : '❌ FAILURES:'}  (${files.length} PNGs, 1 SVG checked)\n`);

  if (errors.length > 0) {
    for (const err of errors) console.error(`  ❌ ${err}`);
    process.exit(1);
  }
}

main();
