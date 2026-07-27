import type {
  MilkdropRenderBackend,
  MilkdropShaderProgramPayload,
} from '../types.ts';

export type MilkdropShaderProgramExecutionKind =
  | 'backend-executable'
  | 'backend-executable-with-control-fallback'
  | 'control-fallback-required';

export type MilkdropShaderProgramExecutionClassification = {
  kind: MilkdropShaderProgramExecutionKind;
  backends: MilkdropRenderBackend[];
  preservesRawGlsl: boolean;
  requiresControlFallback: boolean;
};

export function classifyMilkdropShaderProgramExecution(
  program: MilkdropShaderProgramPayload,
): MilkdropShaderProgramExecutionClassification {
  const backends = [...program.execution.supportedBackends];
  const preservesRawGlsl = Boolean(program.rawGlsl);
  const requiresControlFallback = program.execution.requiresControlFallback;

  if (backends.length > 0) {
    return {
      kind: requiresControlFallback
        ? 'backend-executable-with-control-fallback'
        : 'backend-executable',
      backends,
      preservesRawGlsl,
      requiresControlFallback,
    };
  }

  if (preservesRawGlsl) {
    return {
      kind: 'backend-executable',
      backends: ['webgl'],
      preservesRawGlsl,
      requiresControlFallback,
    };
  }
  return {
    kind: 'control-fallback-required',
    backends,
    preservesRawGlsl,
    requiresControlFallback,
  };
}

export function isMilkdropShaderProgramBackendExecutable(
  program: MilkdropShaderProgramPayload | null | undefined,
  backend?: MilkdropRenderBackend,
) {
  if (!program) {
    return false;
  }
  const classification = classifyMilkdropShaderProgramExecution(program);
  if (!classification.kind.startsWith('backend-executable')) {
    return false;
  }
  return backend ? classification.backends.includes(backend) : true;
}
