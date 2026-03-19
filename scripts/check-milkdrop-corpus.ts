import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type CorpusTier = 'bundled' | 'certified' | 'exploratory';
type FidelityClass = 'exact' | 'near-exact' | 'partial' | 'fallback';
type VisualEvidenceTier = 'none' | 'compile' | 'runtime' | 'visual';

type CorpusDefaults = {
  provenance?: string;
  license?: string;
  usage?: string;
  corpusTier?: CorpusTier;
  expectedFidelityClass?: FidelityClass;
  visualEvidenceTier?: VisualEvidenceTier;
};

type CorpusWaiver = {
  blockedConstruct: string;
  owner: string;
  expiry: string;
  note?: string;
};

type CorpusEntry = {
  id: string;
  title: string;
  file: string;
  strata: string[];
  allowlisted?: boolean;
  provenance?: string;
  license?: string;
  usage?: string;
  corpusTier?: CorpusTier;
  expectedFidelityClass?: FidelityClass;
  visualEvidenceTier?: VisualEvidenceTier;
  visualFixtures?: string[];
  waivers?: CorpusWaiver[];
};

type CorpusManifest = {
  version: number;
  minimumPresetCount: number;
  presetCount: number;
  presets: CorpusEntry[];
  canonicalVisualSuite: string[];
  defaults?: CorpusDefaults;
};

function readJson<T>(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

export function validateMilkdropCorpusManifest(manifest: CorpusManifest) {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();

  if (manifest.presetCount !== manifest.presets.length) {
    issues.push(
      `presetCount ${manifest.presetCount} does not match presets.length ${manifest.presets.length}.`,
    );
  }

  if (manifest.presets.length < manifest.minimumPresetCount) {
    issues.push(
      `preset corpus has ${manifest.presets.length} presets, below minimumPresetCount ${manifest.minimumPresetCount}.`,
    );
  }

  manifest.presets.forEach((entry) => {
    if (!entry.id.trim()) {
      issues.push('preset entry is missing id.');
    }
    if (!entry.title.trim()) {
      issues.push(`preset ${entry.id} is missing title.`);
    }
    if (!entry.file.endsWith('.milk')) {
      issues.push(`preset ${entry.id} has non-.milk file ${entry.file}.`);
    }
    if (entry.strata.length === 0) {
      issues.push(`preset ${entry.id} must declare at least one stratum.`);
    }
    if (seenIds.has(entry.id)) {
      issues.push(`duplicate preset id ${entry.id}.`);
    }
    if (seenFiles.has(entry.file)) {
      issues.push(`duplicate preset file ${entry.file}.`);
    }
    seenIds.add(entry.id);
    seenFiles.add(entry.file);

    const resolvedProvenance = entry.provenance ?? manifest.defaults?.provenance;
    const resolvedLicense = entry.license ?? manifest.defaults?.license;
    const resolvedUsage = entry.usage ?? manifest.defaults?.usage;
    const resolvedTier = entry.corpusTier ?? manifest.defaults?.corpusTier;
    const resolvedFidelity =
      entry.expectedFidelityClass ?? manifest.defaults?.expectedFidelityClass;
    const resolvedVisualTier =
      entry.visualEvidenceTier ?? manifest.defaults?.visualEvidenceTier;

    if (!resolvedProvenance) {
      issues.push(`preset ${entry.id} is missing provenance.`);
    }
    if (!resolvedLicense) {
      issues.push(`preset ${entry.id} is missing license.`);
    }
    if (!resolvedUsage) {
      issues.push(`preset ${entry.id} is missing usage status.`);
    }
    if (!resolvedTier) {
      issues.push(`preset ${entry.id} is missing corpusTier.`);
    }
    if (!resolvedFidelity) {
      issues.push(`preset ${entry.id} is missing expectedFidelityClass.`);
    }
    if (!resolvedVisualTier) {
      issues.push(`preset ${entry.id} is missing visualEvidenceTier.`);
    }

    entry.waivers?.forEach((waiver, index) => {
      if (!waiver.blockedConstruct.trim()) {
        issues.push(`preset ${entry.id} waiver ${index} is missing blockedConstruct.`);
      }
      if (!waiver.owner.trim()) {
        issues.push(`preset ${entry.id} waiver ${index} is missing owner.`);
      }
      if (!isIsoDate(waiver.expiry)) {
        issues.push(`preset ${entry.id} waiver ${index} has invalid expiry ${waiver.expiry}.`);
      }
    });
  });

  manifest.canonicalVisualSuite.forEach((id) => {
    if (!seenIds.has(id)) {
      issues.push(`canonicalVisualSuite references unknown preset ${id}.`);
    }
  });

  return issues;
}

export function runMilkdropCorpusCheck(root = process.cwd()) {
  const manifestPath = join(
    root,
    'assets',
    'data',
    'milkdrop-parity',
    'corpus-manifest.json',
  );
  const manifest = readJson<CorpusManifest>(manifestPath);
  const issues = validateMilkdropCorpusManifest(manifest);
  return { manifestPath, issues };
}

if (import.meta.main) {
  const { issues } = runMilkdropCorpusCheck();
  if (issues.length > 0) {
    console.error('MilkDrop corpus check failed:\n');
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log('MilkDrop corpus check passed.');
}
