#!/usr/bin/env bun
/**
 * Validates the PNGs in docs/assets against their expected dimensions and
 * quality floor.
 *
 * Reads each PNG header directly to reject wrong sizes, indexed color, low bit
 * depth, and undersized files that signal posterization or truncation; also
 * requires a valid source.svg. Exits 1 on any failure.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join(
  import.meta.dirname ?? __dirname,
  '..',
  'docs',
  'assets',
);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type Spec = { width: number; height: number; minBytes: number };

const SPECS: Record<string, Spec> = {
  hero: { width: 1600, height: 1200, minBytes: 50_000 },
};

const COLOR_TYPE_LABELS: Record<number, string> = {
  0: 'grayscale',
  2: 'RGB',
  3: 'indexed',
  4: 'grayscale+alpha',
  6: 'RGBA',
};

type PngInfo = {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  byteLength: number;
};

function readPngInfo(filePath: string): PngInfo {
  const buf = readFileSync(filePath);
  if (buf.length < 33) throw new Error('file too small for valid PNG');
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error('not a valid PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
    bitDepth: buf.readUInt8(24),
    byteLength: buf.length,
  };
}

function main() {
  const files = readdirSync(ASSETS_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (files.length === 0) {
    console.error(`FAIL: no PNGs found in ${ASSETS_DIR}`);
    process.exit(1);
  }

  const errors: string[] = [];
  const found = new Set<string>();
  const filesWithSizes = files.map((f) => ({
    name: f,
    size: statSync(join(ASSETS_DIR, f)).size,
  }));

  const prefix = (files[0] ?? 'unknown').split('-')[0] ?? '';
  console.log(`\n🔍 Checking assets for «${prefix}» in ${ASSETS_DIR}\n`);

  for (const { name, size } of filesWithSizes) {
    const filePath = join(ASSETS_DIR, name);
    let typeKey = name
      .replace(/\.png$/, '')
      .replace(new RegExp(`^${prefix}-`), '');

    if (typeKey.startsWith('dark-og')) typeKey = 'dark';
    else if (typeKey.startsWith('touch')) typeKey = 'touch';
    else if (typeKey.startsWith('github-preview')) typeKey = 'github';

    const spec = SPECS[typeKey];
    if (!spec) {
      try {
        const info = readPngInfo(filePath);
        found.add(typeKey);
        console.log(
          `  ⚠  ${name}  (${info.width}×${info.height}) — no spec, skipped`,
        );
      } catch (e: unknown) {
        errors.push(`${name}: invalid PNG — ${(e as Error).message}`);
      }
      continue;
    }

    found.add(typeKey);
    try {
      const info = readPngInfo(filePath);

      if (info.width !== spec.width || info.height !== spec.height) {
        errors.push(
          `${name}: expected ${spec.width}×${spec.height}, got ${info.width}×${info.height}`,
        );
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
        errors.push(
          `${name}: ${size}B < ${spec.minBytes}B min — possible posterization or truncation`,
        );
        continue;
      }

      const label =
        COLOR_TYPE_LABELS[info.colorType] ?? `type${info.colorType}`;
      console.log(
        `  ✅ ${name}  ${info.width}×${info.height}  ${size.toLocaleString()}B  ${label}`,
      );
    } catch (e: unknown) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  const svgPath = join(ASSETS_DIR, 'source.svg');
  try {
    const svg = readFileSync(svgPath, 'utf8').trim();
    if (svg.startsWith('<svg') || svg.startsWith('<?xml')) {
      console.log(
        `  ✅ source.svg  (${(statSync(svgPath).size).toLocaleString()}B)  design reference`,
      );
    } else {
      errors.push('source.svg: invalid SVG (missing <svg> root)');
    }
  } catch {
    errors.push('source.svg: missing — design source file required');
  }

  const expectedTypes = Object.keys(SPECS);
  const missing = expectedTypes.filter((t) => !found.has(t));
  if (missing.length > 0) {
    console.log(`\n  ⚠  Missing types: ${missing.join(', ')}`);
  }

  console.log(
    `\n${errors.length === 0 ? '✅ All assets valid' : '❌ FAILURES:'}  (${files.length} PNGs, 1 SVG checked)\n`,
  );

  if (errors.length > 0) {
    for (const err of errors) console.error(`  ❌ ${err}`);
    process.exit(1);
  }
}

main();
