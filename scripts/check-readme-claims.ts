#!/usr/bin/env bun
/**
 * Keeps the README's public claims aligned with what the repo actually ships.
 *
 * Docs that oversell are a support cost and an onboarding trap: a contributor
 * who reads that a foundation is shipped, then finds it experimental, has to
 * re-derive the real state from the code. This guard checks the README's preset
 * count against the bundled catalog and rejects wording that promotes known
 * experimental work as finished.
 *
 * It is the same principle as `check-doc-references.ts` applied to claims
 * rather than paths: documentation that lies is worse than documentation that
 * is missing, because it is trusted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/**
 * Keeps the public README honest about what actually ships.
 *
 * Previously part of `check:toys`; it was never toy-specific, so it outlived
 * the toy manifest pipeline that used to carry it.
 */
export async function validateReadmeProductClaims(
  issues: string[],
  root = repoRoot,
) {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const catalogPath = path.join(root, 'public/milkdrop-presets/catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as {
    presets?: unknown[];
  };
  const catalogCount = Array.isArray(catalog.presets)
    ? catalog.presets.length
    : 0;
  const countPatterns = [
    /\b([\d][\d,]*)-preset catalog\b/giu,
    /\*\*([\d][\d,]*) presets\*\*/giu,
    /\b([\d][\d,]*)\+ preset embeddings\b/giu,
  ];

  for (const pattern of countPatterns) {
    for (const match of readme.matchAll(pattern)) {
      const claimedCount = Number((match[1] ?? '').replace(/,/gu, ''));
      if (claimedCount === catalogCount) continue;
      issues.push(
        `README preset count is ${claimedCount}, but public/milkdrop-presets/catalog.json contains ${catalogCount} entries. Update the public claim to match the catalog source of truth.`,
      );
    }
  }

  const unshippedClaims = [
    {
      pattern: /Stem-Aware Audio Engine/iu,
      issue:
        'README presents stem separation as shipped, but the runtime currently exposes reserved stem signals only.',
    },
    {
      pattern: /WebMIDI & VJ Controls/iu,
      issue:
        'README presents MIDI control as fully shipped, but the current integration still lacks device-backed verification and persistent mappings.',
    },
    {
      pattern: /4K \/ 60FPS Video Export/iu,
      issue:
        'README presents creator-ready 4K audio-video export as fully shipped, but the native render and audio path still requires browser-backed output verification.',
    },
    {
      pattern: /AI Generation & Blending/iu,
      issue:
        'README presents model generation and blending as one fully shipped feature, but generation requires a configured hosted or local model and blending remains an optional API.',
    },
  ];

  for (const claim of unshippedClaims) {
    if (claim.pattern.test(readme)) {
      issues.push(claim.issue);
    }
  }
}

export async function runReadmeClaimChecks(root = repoRoot) {
  const issues: string[] = [];
  await validateReadmeProductClaims(issues, root);
  return { issues };
}

async function main() {
  const { issues } = await runReadmeClaimChecks();

  if (issues.length > 0) {
    console.error('README claim check failed:\n');
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('✔ README public claims match the shipped catalog and runtime');
}

const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  await main();
}
