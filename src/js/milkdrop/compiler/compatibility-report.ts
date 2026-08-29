import type {
  MilkdropBlockingConstruct,
  MilkdropDegradationReason,
  MilkdropParityReport,
  MilkdropSemanticSupport,
  MilkdropVisualCertification,
} from '../types';

export type BuildParityReportOptions = {
  ignoredFields: string[];
  approximatedShaderLines: string[];
  missingAliasesOrFunctions: string[];
  backendDivergence: string[];
  visualFallbacks: string[];
  blockedConstructs: string[];
  blockingConstructDetails: MilkdropBlockingConstruct[];
  degradationReasons: MilkdropDegradationReason[];
  fidelityClass: MilkdropParityReport['fidelityClass'];
  evidence: MilkdropParityReport['evidence'];
  visualEvidenceTier: MilkdropParityReport['visualEvidenceTier'];
  semanticSupport: MilkdropSemanticSupport;
  visualCertification: MilkdropVisualCertification;
};

export function buildParityReport(
  options: BuildParityReportOptions,
): MilkdropParityReport {
  return {
    ignoredFields: options.ignoredFields,
    approximatedShaderLines: options.approximatedShaderLines,
    missingAliasesOrFunctions: options.missingAliasesOrFunctions,
    backendDivergence: options.backendDivergence,
    visualFallbacks: options.visualFallbacks,
    blockedConstructs: options.blockedConstructs,
    blockingConstructDetails: options.blockingConstructDetails,
    degradationReasons: options.degradationReasons,
    fidelityClass: options.fidelityClass,
    evidence: options.evidence,
    visualEvidenceTier: options.visualEvidenceTier,
    semanticSupport: options.semanticSupport,
    visualCertification: options.visualCertification,
  };
}
