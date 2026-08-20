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
    // When raw GLSL is also preserved, WebGL can execute it natively even if
    // the supportedBackends list only carries WebGPU (which uses TSL nodes).
    const effectiveBackends: MilkdropRenderBackend[] = preservesRawGlsl
      ? [...new Set<MilkdropRenderBackend>([...backends, 'webgl'])]
      : backends;
    return {
      kind: requiresControlFallback
        ? 'backend-executable-with-control-fallback'
        : 'backend-executable',
      backends: effectiveBackends,
      preservesRawGlsl,
      requiresControlFallback,
    };
  }

  if (preservesRawGlsl) {
    return {
      // Same rule as the branch above: raw GLSL makes the program executable,
      // but it does not remove a control-fallback requirement. Hardcoding the
      // plain kind here made the returned object contradict its own
      // `requiresControlFallback` field.
      kind: requiresControlFallback
        ? 'backend-executable-with-control-fallback'
        : 'backend-executable',
      backends: ['webgl' as MilkdropRenderBackend],
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
