export type MilkdropPresetOrigin = 'bundled' | 'imported' | 'user' | 'draft';

export type MilkdropDiagnosticSeverity = 'error' | 'warning' | 'info';

export type MilkdropCompatibilityIssueCategory =
  | 'unsupported-syntax'
  | 'unsupported-shader'
  | 'runtime-divergence'
  | 'backend-degradation'
  | 'acceptable-approximation';

export type MilkdropDiagnostic = {
  severity: MilkdropDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  field?: string;
};

export type MilkdropPresetSource = {
  id: string;
  title: string;
  raw: string;
  origin: MilkdropPresetOrigin;
  author?: string;
  fileName?: string;
  path?: string;
  updatedAt?: number;
};

export type MilkdropPresetField = {
  key: string;
  rawValue: string;
  line: number;
  section: string | null;
};

export type MilkdropPresetAST = {
  source: string;
  fields: MilkdropPresetField[];
  sections: string[];
};

export type MilkdropExpressionNode =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | {
      type: 'unary';
      operator: '+' | '-' | '!';
      operand: MilkdropExpressionNode;
    }
  | {
      type: 'binary';
      operator:
        | '+'
        | '-'
        | '*'
        | '/'
        | '%'
        | '^'
        | '|'
        | '&'
        | '<'
        | '<='
        | '>'
        | '>='
        | '=='
        | '!='
        | '&&'
        | '||';
      left: MilkdropExpressionNode;
      right: MilkdropExpressionNode;
    }
  | {
      type: 'call';
      name: string;
      args: MilkdropExpressionNode[];
    };

export type MilkdropCompiledStatement = {
  target: string;
  expression: MilkdropExpressionNode;
  line: number;
  source: string;
};

export type MilkdropProgramBlock = {
  statements: MilkdropCompiledStatement[];
  sourceLines: string[];
};

export type MilkdropFeatureKey =
  | 'base-globals'
  | 'per-frame-equations'
  | 'per-pixel-equations'
  | 'custom-waves'
  | 'custom-shapes'
  | 'shape-texture-controls'
  | 'borders'
  | 'motion-vectors'
  | 'video-echo'
  | 'post-effects'
  | 'unsupported-shader-text';

export type MilkdropCompatibilityFeatureKey =
  | MilkdropFeatureKey
  | 'video-echo-orientation';

export type MilkdropSupportStatus = 'supported' | 'partial' | 'unsupported';

export type MilkdropFidelityClass =
  | 'exact'
  | 'near-exact'
  | 'partial'
  | 'fallback';

export type MilkdropVisualEvidenceTier =
  | 'none'
  | 'compile'
  | 'runtime'
  | 'visual';

export type MilkdropParitySourceFamily =
  | 'bundled'
  | 'local-custom-shape'
  | 'parity-corpus'
  | 'projectm-fixture'
  | 'external-pack'
  | 'ad-hoc';

export type MilkdropParityToleranceProfile =
  | 'default'
  | 'strict'
  | 'loose'
  | (string & {});

export type MilkdropBlockingConstruct = {
  kind: 'field' | 'shader';
  value: string;
  system: 'preset-field' | 'shader-text';
  allowlisted: boolean;
  feature?: MilkdropCompatibilityFeatureKey;
  classification?: 'soft-unknown' | 'hard-unsupported';
};

export type MilkdropDegradationReason = {
  code:
    | 'unknown-field'
    | 'unsupported-field'
    | 'unsupported-hard-feature'
    | 'shader-approximation'
    | 'allowlisted-gap'
    | 'backend-divergence'
    | 'backend-partial'
    | 'backend-unsupported'
    | 'visual-fallback';
  category: MilkdropCompatibilityIssueCategory;
  message: string;
  system: 'compiler' | 'shader' | 'backend' | 'runtime';
  blocking: boolean;
};

export type MilkdropCompatibilityEvidence = {
  compile: 'verified' | 'issues';
  runtime: 'not-run' | 'smoke-tested';
  visual: 'not-captured' | 'reference-suite';
};

export type MilkdropRenderBackend = 'webgl' | 'webgpu';

export type MilkdropSemanticSupport = {
  fidelityClass: MilkdropFidelityClass;
  evidence: MilkdropCompatibilityEvidence;
  visualEvidenceTier: MilkdropVisualEvidenceTier;
};

export type MilkdropVisualCertification = {
  status: 'certified' | 'uncertified';
  measured: boolean;
  source: 'inferred' | 'reference-suite';
  fidelityClass: MilkdropFidelityClass;
  visualEvidenceTier: MilkdropVisualEvidenceTier;
  requiredBackend: MilkdropRenderBackend | null;
  actualBackend: MilkdropRenderBackend | null;
  reasons: string[];
};

export type MilkdropBackendSupportEvidenceCode =
  | 'unknown-field'
  | 'unsupported-hard-feature'
  | 'unsupported-shader-text-gap'
  | 'volume-sampler-gap'
  | 'shape-texture-gap'
  | 'video-echo-gap'
  | 'post-effects-gap';

export type MilkdropBackendSupportEvidence = {
  backend: MilkdropRenderBackend;
  scope: 'shared' | 'backend';
  status: Exclude<MilkdropSupportStatus, 'supported'>;
  code: MilkdropBackendSupportEvidenceCode;
  message: string;
  feature?: MilkdropCompatibilityFeatureKey;
};

export type MilkdropParityReport = {
  ignoredFields: string[];
  approximatedShaderLines: string[];
  missingAliasesOrFunctions: string[];
  backendDivergence: string[];
  visualFallbacks: string[];
  blockedConstructs: string[];
  blockingConstructDetails: MilkdropBlockingConstruct[];
  degradationReasons: MilkdropDegradationReason[];
  fidelityClass: MilkdropFidelityClass;
  evidence: MilkdropCompatibilityEvidence;
  visualEvidenceTier: MilkdropVisualEvidenceTier;
  semanticSupport: MilkdropSemanticSupport;
  visualCertification: MilkdropVisualCertification;
};

export type MilkdropCompileOptions = Record<string, never>;

export type MilkdropBackendSupport = {
  status: MilkdropSupportStatus;
  reasons: string[];
  evidence: MilkdropBackendSupportEvidence[];
  requiredFeatures: MilkdropFeatureKey[];
  unsupportedFeatures: MilkdropCompatibilityFeatureKey[];
  recommendedFallback?: MilkdropRenderBackend;
};

export type MilkdropFeatureAnalysis = {
  featuresUsed: MilkdropFeatureKey[];
  unsupportedShaderText: boolean;
  supportedShaderText: boolean;
  shaderTextExecution: Record<
    MilkdropRenderBackend,
    'none' | 'translated' | 'direct' | 'unsupported'
  >;
  registerUsage: {
    q: number;
    t: number;
  };
};
