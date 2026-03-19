import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type {
  MilkdropFidelityClass,
  MilkdropParityAllowlistEntry,
  MilkdropVisualEvidenceTier,
} from '../assets/js/milkdrop/types.ts';

type CorpusTier = 'bundled' | 'certified' | 'exploratory';

type CorpusDefaults = {
  provenance?: string;
  license?: string;
  usage?: string;
  corpusTier?: CorpusTier;
  expectedFidelityClass?: MilkdropFidelityClass;
  visualEvidenceTier?: MilkdropVisualEvidenceTier;
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
  expectedFidelityClass?: MilkdropFidelityClass;
  visualEvidenceTier?: MilkdropVisualEvidenceTier;
  visualFixtures?: string[];
  waivers?: CorpusWaiver[];
};

type CorpusManifest = {
  version: number;
  parityTarget?: string;
  backendTarget?: 'webgl' | 'webgpu';
  fallbackBackend?: 'webgl' | 'webgpu';
  minimumPresetCount: number;
  presetCount: number;
  presets: CorpusEntry[];
  canonicalVisualSuite: string[];
  defaults?: CorpusDefaults;
};

type AllowlistDocument = {
  entries?: MilkdropParityAllowlistEntry[];
};

export type MilkdropParityPresetReport = {
  id: string;
  title: string;
  expectedFidelityClass: MilkdropFidelityClass;
  actualFidelityClass: MilkdropFidelityClass;
  parityReady: boolean;
  blockedConstructs: string[];
  allowlistedBlockedConstructs: string[];
  degradationCategories: string[];
  backendStatuses: {
    webgl: string;
    webgpu: string;
  };
};

export type MilkdropParityAggregateReport = {
  manifestPath: string;
  issues: string[];
  fidelityCounts: Record<MilkdropFidelityClass, number>;
  canonicalVisualSuite: {
    total: number;
    regressions: MilkdropParityPresetReport[];
  };
  blockedConstructFrequency: Array<{
    blockedConstruct: string;
    count: number;
    presetIds: string[];
  }>;
  expiredWaivers: Array<{
    presetId: string;
    blockedConstruct: string;
    owner: string;
    expiry: string;
    source: 'manifest' | 'allowlist';
  }>;
  presets: MilkdropParityPresetReport[];
};

function readJson<T>(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function resolveExpectedFidelity(
  entry: CorpusEntry,
  defaults?: CorpusDefaults,
): MilkdropFidelityClass | null {
  return entry.expectedFidelityClass ?? defaults?.expectedFidelityClass ?? null;
}

function fidelityRank(value: MilkdropFidelityClass) {
  switch (value) {
    case 'exact':
      return 4;
    case 'near-exact':
      return 3;
    case 'partial':
      return 2;
    default:
      return 1;
  }
}

function loadCorpusManifest(root: string) {
  const manifestPath = join(
    root,
    'assets',
    'data',
    'milkdrop-parity',
    'corpus-manifest.json',
  );
  return {
    manifestPath,
    manifest: readJson<CorpusManifest>(manifestPath),
  };
}

function loadParityAllowlist(root: string) {
  const allowlistPath = join(
    root,
    'assets',
    'data',
    'milkdrop-parity',
    'allowlist.json',
  );
  const allowlist = readJson<AllowlistDocument>(allowlistPath);
  return {
    allowlistPath,
    allowlist: allowlist.entries ?? [],
  };
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

    const resolvedProvenance =
      entry.provenance ?? manifest.defaults?.provenance;
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
        issues.push(
          `preset ${entry.id} waiver ${index} is missing blockedConstruct.`,
        );
      }
      if (!waiver.owner.trim()) {
        issues.push(`preset ${entry.id} waiver ${index} is missing owner.`);
      }
      if (!isIsoDate(waiver.expiry)) {
        issues.push(
          `preset ${entry.id} waiver ${index} has invalid expiry ${waiver.expiry}.`,
        );
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

export function generateMilkdropParityReport(root = process.cwd()) {
  const { manifestPath, manifest } = loadCorpusManifest(root);
  const issues = validateMilkdropCorpusManifest(manifest);
  const { allowlist } = loadParityAllowlist(root);
  const corpusDir = join(
    root,
    'tests',
    'fixtures',
    'milkdrop',
    'parity-corpus',
  );
  const fidelityCounts: Record<MilkdropFidelityClass, number> = {
    exact: 0,
    'near-exact': 0,
    partial: 0,
    fallback: 0,
  };
  const blockedConstructMap = new Map<
    string,
    { blockedConstruct: string; count: number; presetIds: string[] }
  >();
  const today = new Date().toISOString().slice(0, 10);
  const expiredWaivers: MilkdropParityAggregateReport['expiredWaivers'] = [];

  manifest.presets.forEach((entry) => {
    entry.waivers?.forEach((waiver) => {
      if (waiver.expiry < today) {
        expiredWaivers.push({
          presetId: entry.id,
          blockedConstruct: waiver.blockedConstruct,
          owner: waiver.owner,
          expiry: waiver.expiry,
          source: 'manifest',
        });
      }
    });
  });

  allowlist.forEach((entry) => {
    if (entry.expiry < today) {
      expiredWaivers.push({
        presetId: entry.presetId,
        blockedConstruct: entry.blockedConstruct,
        owner: entry.owner,
        expiry: entry.expiry,
        source: 'allowlist',
      });
    }
  });

  const presets = manifest.presets.map((entry) => {
    const raw = readFileSync(join(corpusDir, entry.file), 'utf8');
    const compiled = compileMilkdropPresetSource(
      raw,
      {
        id: entry.id,
        title: entry.title,
        origin: 'user',
      },
      {
        fidelityMode: 'compat',
        parityAllowlist: allowlist,
      },
    );
    const parity = compiled.ir.compatibility.parity;
    fidelityCounts[parity.fidelityClass] += 1;

    parity.blockedConstructs.forEach((blockedConstruct) => {
      const existing = blockedConstructMap.get(blockedConstruct);
      if (existing) {
        existing.count += 1;
        existing.presetIds.push(entry.id);
        return;
      }
      blockedConstructMap.set(blockedConstruct, {
        blockedConstruct,
        count: 1,
        presetIds: [entry.id],
      });
    });

    return {
      id: entry.id,
      title: entry.title,
      expectedFidelityClass:
        resolveExpectedFidelity(entry, manifest.defaults) ?? 'near-exact',
      actualFidelityClass: parity.fidelityClass,
      parityReady: parity.parityReady,
      blockedConstructs: parity.blockedConstructs,
      allowlistedBlockedConstructs: parity.allowlistedBlockedConstructs,
      degradationCategories: [
        ...new Set(parity.degradationReasons.map((reason) => reason.category)),
      ],
      backendStatuses: {
        webgl: compiled.ir.compatibility.backends.webgl.status,
        webgpu: compiled.ir.compatibility.backends.webgpu.status,
      },
    } satisfies MilkdropParityPresetReport;
  });

  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const regressions = manifest.canonicalVisualSuite.flatMap((id) => {
    const preset = byId.get(id);
    if (!preset) {
      return [];
    }
    return fidelityRank(preset.actualFidelityClass) <
      fidelityRank(preset.expectedFidelityClass)
      ? [preset]
      : [];
  });

  return {
    manifestPath,
    issues,
    fidelityCounts,
    canonicalVisualSuite: {
      total: manifest.canonicalVisualSuite.length,
      regressions,
    },
    blockedConstructFrequency: [...blockedConstructMap.values()].sort(
      (left, right) => {
        if (left.count !== right.count) {
          return right.count - left.count;
        }
        return left.blockedConstruct.localeCompare(right.blockedConstruct);
      },
    ),
    expiredWaivers,
    presets,
  } satisfies MilkdropParityAggregateReport;
}

export function runMilkdropCorpusCheck(root = process.cwd()) {
  const report = generateMilkdropParityReport(root);
  return {
    manifestPath: report.manifestPath,
    issues: report.issues,
    report,
  };
}

function printReport(report: MilkdropParityAggregateReport) {
  console.log('MilkDrop parity report');
  console.log(`Manifest: ${report.manifestPath}`);
  console.log(
    `Fidelity: exact ${report.fidelityCounts.exact}, near-exact ${report.fidelityCounts['near-exact']}, partial ${report.fidelityCounts.partial}, fallback ${report.fidelityCounts.fallback}`,
  );
  console.log(
    `Canonical suite: ${report.canonicalVisualSuite.total} presets, ${report.canonicalVisualSuite.regressions.length} regression${report.canonicalVisualSuite.regressions.length === 1 ? '' : 's'}`,
  );

  if (report.blockedConstructFrequency.length > 0) {
    console.log('Top blocked constructs:');
    report.blockedConstructFrequency.slice(0, 5).forEach((entry) => {
      console.log(
        `- ${entry.blockedConstruct}: ${entry.count} preset${entry.count === 1 ? '' : 's'}`,
      );
    });
  } else {
    console.log('Top blocked constructs: none');
  }

  if (report.expiredWaivers.length > 0) {
    console.log('Expired waivers:');
    report.expiredWaivers.forEach((waiver) => {
      console.log(
        `- ${waiver.presetId} ${waiver.blockedConstruct} (${waiver.owner}, ${waiver.expiry}, ${waiver.source})`,
      );
    });
  } else {
    console.log('Expired waivers: none');
  }

  if (report.canonicalVisualSuite.regressions.length > 0) {
    console.log('Canonical suite regressions:');
    report.canonicalVisualSuite.regressions.forEach((preset) => {
      console.log(
        `- ${preset.id}: expected ${preset.expectedFidelityClass}, got ${preset.actualFidelityClass}`,
      );
    });
  }
}

if (import.meta.main) {
  const reportOnly = process.argv.includes('--report');
  const json = process.argv.includes('--json');
  const result = runMilkdropCorpusCheck();

  if (json) {
    console.log(JSON.stringify(result.report, null, 2));
  } else if (reportOnly) {
    printReport(result.report);
  }

  if (result.issues.length > 0) {
    if (!json && !reportOnly) {
      console.error('MilkDrop corpus check failed:\n');
      result.issues.forEach((issue) => console.error(`- ${issue}`));
    }
    process.exit(1);
  }

  if (!json && !reportOnly) {
    console.log('MilkDrop corpus check passed.');
  }
}
