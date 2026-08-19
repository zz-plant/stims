/**
 * Compiles every bundled Butterchurn preset and tallies its WebGL and WebGPU
 * support status.
 *
 * Headless corpus census, no browser involved: each preset is run through the
 * MilkDrop compiler and the results are aggregated into per-backend
 * supported/partial/unsupported counts plus frequency tables of unknown preset
 * fields, evidence codes and unsupported features, with the top 50 unknown
 * fields highlighted as the blockers worth fixing first.
 *
 *   bun run sweep:butterchurn
 *
 * Takes no flags; prints the summary and writes
 * screenshots/butterchurn-support-sweep/summary.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MilkdropSupportStatus } from '../src/js/milkdrop/common-types.ts';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(repoRoot, 'public');
const catalogPath = path.join(publicRoot, 'milkdrop-presets', 'catalog.json');
const outputDir = path.join(
  repoRoot,
  'screenshots',
  'butterchurn-support-sweep',
);

type CatalogEntry = {
  id: string;
  title: string;
  file: string;
};

type PresetResult = {
  id: string;
  title: string;
  file: string;
  webglStatus: MilkdropSupportStatus;
  webgpuStatus: MilkdropSupportStatus;
  softUnknownKeys: string[];
  evidenceCodes: string[];
  unsupportedFeatures: string[];
  hasShaderBody: boolean;
  diagnostics: number;
};

type SweepSummary = {
  total: number;
  webgl: Record<MilkdropSupportStatus, number>;
  webgpu: Record<MilkdropSupportStatus, number>;
  bothSupported: number;
  eitherSupported: number;
  softUnknownKeyFrequency: Array<{ key: string; count: number }>;
  evidenceCodeFrequency: Array<{ code: string; count: number }>;
  unsupportedFeatureFrequency: Array<{ feature: string; count: number }>;
  presetsWithShaderBody: number;
  presetsWithoutShaderBody: number;
  topBlockers: Array<{ key: string; blockingCount: number }>;
  results: PresetResult[];
};

function statusCounts(): Record<MilkdropSupportStatus, number> {
  return { supported: 0, partial: 0, unsupported: 0 };
}

function isButterchurnPreset(entry: CatalogEntry): boolean {
  return entry.file.includes('butterchurn/');
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    presets: CatalogEntry[];
  };

  const butterchurnEntries = catalog.presets.filter(isButterchurnPreset);

  console.log(`Compiling ${butterchurnEntries.length} butterchurn presets...`);

  const results: PresetResult[] = [];
  const softUnknownKeyCounts = new Map<string, number>();
  const evidenceCodeCounts = new Map<string, number>();
  const unsupportedFeatureCounts = new Map<string, number>();
  let bothSupported = 0;
  let eitherSupported = 0;
  let presetsWithShaderBody = 0;
  let presetsWithoutShaderBody = 0;

  for (let i = 0; i < butterchurnEntries.length; i++) {
    const entry = butterchurnEntries[i];
    if ((i + 1) % 200 === 0) {
      console.log(`  ${i + 1}/${butterchurnEntries.length}...`);
    }

    const filePath = path.join(publicRoot, entry.file.replace(/^\//, ''));
    const source = fs.readFileSync(filePath, 'latin1');
    const hasShaderBody = /\bshader_body\b/i.test(source);

    let compiled: ReturnType<typeof compileMilkdropPresetSource>;
    try {
      compiled = compileMilkdropPresetSource(source, {
        id: entry.id,
        title: entry.title,
        origin: 'bundled',
      });
    } catch (error) {
      console.error(`  Compile error for ${entry.id}: ${error}`);
      results.push({
        id: entry.id,
        title: entry.title,
        file: entry.file,
        webglStatus: 'unsupported',
        webgpuStatus: 'unsupported',
        softUnknownKeys: [],
        evidenceCodes: ['compile-error'],
        unsupportedFeatures: [],
        hasShaderBody,
        diagnostics: 0,
      });
      continue;
    }

    const { compatibility } = compiled.ir;
    const webglStatus = compatibility.backends.webgl.status;
    const webgpuStatus = compatibility.backends.webgpu.status;
    const softUnknownKeys = compatibility.softUnknownKeys;
    const allEvidence = [
      ...compatibility.backends.webgl.evidence,
      ...compatibility.backends.webgpu.evidence,
    ];
    const evidenceCodes = [...new Set(allEvidence.map((e) => e.code))];
    const allUnsupportedFeatures = [
      ...compatibility.backends.webgl.unsupportedFeatures,
      ...compatibility.backends.webgpu.unsupportedFeatures,
    ];
    const unsupportedFeatures = [...new Set(allUnsupportedFeatures)];

    if (webglStatus === 'supported' && webgpuStatus === 'supported') {
      bothSupported++;
    }
    if (webglStatus === 'supported' || webgpuStatus === 'supported') {
      eitherSupported++;
    }
    if (hasShaderBody) {
      presetsWithShaderBody++;
    } else {
      presetsWithoutShaderBody++;
    }

    for (const key of softUnknownKeys) {
      softUnknownKeyCounts.set(key, (softUnknownKeyCounts.get(key) ?? 0) + 1);
    }
    for (const code of evidenceCodes) {
      evidenceCodeCounts.set(code, (evidenceCodeCounts.get(code) ?? 0) + 1);
    }
    for (const feature of unsupportedFeatures) {
      unsupportedFeatureCounts.set(
        feature,
        (unsupportedFeatureCounts.get(feature) ?? 0) + 1,
      );
    }

    results.push({
      id: entry.id,
      title: entry.title,
      file: entry.file,
      webglStatus,
      webgpuStatus,
      softUnknownKeys,
      evidenceCodes,
      unsupportedFeatures,
      hasShaderBody,
      diagnostics: compiled.diagnostics.length,
    });
  }

  const webgl = statusCounts();
  const webgpu = statusCounts();
  for (const r of results) {
    webgl[r.webglStatus]++;
    webgpu[r.webgpuStatus]++;
  }

  const softUnknownKeyFrequency = [...softUnknownKeyCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const evidenceCodeFrequency = [...evidenceCodeCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const unsupportedFeatureFrequency = [...unsupportedFeatureCounts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);

  const topBlockers = softUnknownKeyFrequency.slice(0, 50).map((entry) => ({
    key: entry.key,
    blockingCount: entry.count,
  }));

  const summary: SweepSummary = {
    total: results.length,
    webgl,
    webgpu,
    bothSupported,
    eitherSupported,
    softUnknownKeyFrequency,
    evidenceCodeFrequency,
    unsupportedFeatureFrequency,
    presetsWithShaderBody,
    presetsWithoutShaderBody,
    topBlockers,
    results,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );

  console.log('\n=== Butterchurn Support Sweep ===\n');
  console.log(`Total presets:     ${summary.total}`);
  console.log(
    `WebGL supported:   ${webgl.supported}  partial: ${webgl.partial}  unsupported: ${webgl.unsupported}`,
  );
  console.log(
    `WebGPU supported:  ${webgpu.supported}  partial: ${webgpu.partial}  unsupported: ${webgpu.unsupported}`,
  );
  console.log(`Both supported:    ${bothSupported}`);
  console.log(`Either supported:  ${eitherSupported}`);
  console.log(
    `Has shader_body:   ${presetsWithShaderBody}  No shader_body: ${presetsWithoutShaderBody}`,
  );

  console.log('\n--- Evidence Code Frequency ---');
  for (const { code, count } of evidenceCodeFrequency) {
    console.log(`  ${code}: ${count}`);
  }

  console.log('\n--- Unsupported Feature Frequency ---');
  for (const { feature, count } of unsupportedFeatureFrequency) {
    console.log(`  ${feature}: ${count}`);
  }

  console.log('\n--- Top 50 Unknown Fields (softUnknownKeys) ---');
  for (const entry of topBlockers) {
    console.log(`  ${entry.key}: ${entry.blockingCount}`);
  }

  console.log(`\nFull summary: ${path.join(outputDir, 'summary.json')}`);
}

main();
