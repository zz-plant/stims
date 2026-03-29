import fs from 'node:fs';
import path from 'node:path';
import type {
  MilkdropParitySourceFamily,
  MilkdropParityToleranceProfile,
  MilkdropRenderBackend,
} from '../assets/js/milkdrop/common-types.ts';

export const CERTIFICATION_CORPUS_MANIFEST_PATH =
  'assets/data/milkdrop-parity/certification-corpus.json';

export type CertificationCorpusGroup =
  | 'bundled-shipped'
  | 'local-custom-shape'
  | 'parity-corpus'
  | 'projectm-upstream';

export type CertificationCorpusEntry = {
  id: string;
  title: string;
  file: string;
  fixtureRoot: string;
  corpusGroup: CertificationCorpusGroup;
  sourceFamily: MilkdropParitySourceFamily;
  requiredBackend: MilkdropRenderBackend;
  toleranceProfile: MilkdropParityToleranceProfile;
  strata: string[];
  selectionReason: string;
};

export type CertificationCorpusManifest = {
  version: 1;
  parityTarget: 'projectm-webgpu-certification-v1';
  requiredBackend: MilkdropRenderBackend;
  presetCount: number;
  groups: Record<
    CertificationCorpusGroup,
    {
      minimumCount: number;
      description: string;
    }
  >;
  presets: CertificationCorpusEntry[];
};

export function createDefaultCertificationCorpusManifest(): CertificationCorpusManifest {
  return {
    version: 1,
    parityTarget: 'projectm-webgpu-certification-v1',
    requiredBackend: 'webgpu',
    presetCount: 0,
    groups: {
      'bundled-shipped': {
        minimumCount: 8,
        description:
          'Every shipped bundled preset, including curated Stims presets and bundled external-pack imports.',
      },
      'local-custom-shape': {
        minimumCount: 2,
        description:
          'Dedicated local fixtures that cover custom-shape behavior absent from the vendored upstream slice.',
      },
      'parity-corpus': {
        minimumCount: 8,
        description:
          'Representative parity-corpus presets chosen to maximize subsystem coverage and currently observed divergence.',
      },
      'projectm-upstream': {
        minimumCount: 6,
        description:
          'Representative vendored projectM upstream fixtures covering parser/runtime semantics with upstream provenance.',
      },
    },
    presets: [],
  };
}

export function loadCertificationCorpusManifest(
  repoRoot: string,
): CertificationCorpusManifest {
  const manifestPath = path.join(repoRoot, CERTIFICATION_CORPUS_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    return createDefaultCertificationCorpusManifest();
  }

  const parsed = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as Partial<CertificationCorpusManifest>;
  return {
    ...createDefaultCertificationCorpusManifest(),
    ...parsed,
    groups: {
      ...createDefaultCertificationCorpusManifest().groups,
      ...(parsed.groups ?? {}),
    },
    presets: Array.isArray(parsed.presets) ? parsed.presets : [],
    presetCount: Array.isArray(parsed.presets)
      ? parsed.presets.length
      : (parsed.presetCount ?? 0),
  };
}
