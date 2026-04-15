import type {
  MilkdropRenderBackend,
  MilkdropShaderExpressionNode,
  MilkdropShaderProgramPayload,
  MilkdropShaderProgramStage,
  MilkdropShaderStatement,
} from '../types';
import {
  evaluateShaderScalarResult,
  extractScaledShaderSampleExpression,
  extractShaderInvertedSampleExpression,
  getShaderSampleInfo,
  isAuxShaderSamplerName,
  isKnownShaderScalarKey,
  isShaderMainSampleExpression,
  isShaderSampleRgbExpression,
  isUnsupportedVolumeSampleSource,
  normalizeShaderSamplerName,
  normalizeShaderTextureBlendMode,
  parseShaderSamplerSource,
  parseShaderTextureBlendMode,
  resolveShaderExpressionIdentifiers,
  type ShaderExpressionEnv,
  type ShaderRuntimeEnv,
} from './shader-analysis-helpers';

export function buildShaderProgramPayload({
  stage,
  statements,
  normalizedLines,
  requiresControlFallback,
  supportedBackends,
}: {
  stage: MilkdropShaderProgramStage;
  statements: MilkdropShaderStatement[];
  normalizedLines: string[];
  requiresControlFallback: boolean;
  supportedBackends: MilkdropRenderBackend[];
}): MilkdropShaderProgramPayload {
  const hasTranslatedControlFallback = statements.some((statement) =>
    shouldUseTranslatedControlsForDirectAuxSample(statement),
  );
  const entryTarget = stage === 'warp' ? 'uv' : 'ret';
  const programStatements = statements.map((statement) => ({
    ...statement,
    target:
      statement.target.toLowerCase() === 'shader_body'
        ? entryTarget
        : statement.target,
  }));
  return {
    stage,
    source: normalizedLines.join('; '),
    normalizedLines,
    statements: programStatements,
    execution: {
      kind: 'direct-feedback-program',
      stage,
      entryTarget,
      supportedBackends,
      requiresControlFallback:
        requiresControlFallback || hasTranslatedControlFallback,
      statementTargets: programStatements.map((statement) => statement.target),
    },
  };
}

export function shouldUseTranslatedControlsForDirectAuxSample(
  statement: MilkdropShaderStatement,
) {
  const key = statement.target.toLowerCase();
  if (key !== 'ret' && key !== 'return' && key !== 'shader_body') {
    return false;
  }

  const directSample = getShaderSampleInfo(statement.expression);
  if (!directSample || directSample.source === 'none') {
    const expression = statement.expression;

    if (
      expression.type === 'call' &&
      expression.name.toLowerCase() === 'mix' &&
      expression.args.length >= 3 &&
      isShaderSampleRgbExpression(
        expression.args[0] as MilkdropShaderExpressionNode,
      )
    ) {
      const baseSample = getShaderSampleInfo(
        expression.args[0] as MilkdropShaderExpressionNode,
      );
      if (baseSample?.source !== 'main') {
        return false;
      }

      const targetNode = expression.args[1] as MilkdropShaderExpressionNode;
      const auxSample = getShaderSampleInfo(targetNode);
      if (
        auxSample &&
        auxSample.source !== 'main' &&
        auxSample.source !== 'none'
      ) {
        return true;
      }

      const invertedSample = extractShaderInvertedSampleExpression(targetNode);
      return Boolean(invertedSample && invertedSample !== 'main');
    }

    if (
      expression.type === 'binary' &&
      ['+', '*'].includes(expression.operator) &&
      (isShaderMainSampleExpression(expression.left) ||
        isShaderMainSampleExpression(expression.right))
    ) {
      const auxNode = isShaderMainSampleExpression(expression.left)
        ? expression.right
        : expression.left;
      const auxSample = extractScaledShaderSampleExpression(auxNode);
      return Boolean(
        auxSample &&
          auxSample.sample.source !== 'main' &&
          auxSample.sample.source !== 'none',
      );
    }

    return false;
  }

  return directSample.source !== 'main';
}

export function isUnsupportedParsedShaderStatement({
  statement,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
}: {
  statement: MilkdropShaderStatement;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
}) {
  const key = statement.target.toLowerCase();
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  if (key === 'texture_source' || key === 'warp_texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    return !source || !isAuxShaderSamplerName(source);
  }

  if (key === 'texture_mode') {
    const mode =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderTextureBlendMode(resolvedExpression.name)
        : parseShaderTextureBlendMode(statement.rawValue);
    return !mode;
  }

  if (key !== 'ret' && key !== 'shader_body') {
    return false;
  }

  const directSample = getShaderSampleInfo(resolvedExpression);
  if (
    directSample &&
    ((directSample.sampleDimension === '3d' &&
      isUnsupportedVolumeSampleSource(directSample.source)) ||
      (directSample.source !== 'main' &&
        directSample.source !== 'none' &&
        !isAuxShaderSamplerName(directSample.source)))
  ) {
    return true;
  }

  if (
    resolvedExpression.type !== 'call' ||
    resolvedExpression.name.toLowerCase() !== 'mix' ||
    resolvedExpression.args.length < 3 ||
    !isShaderSampleRgbExpression(
      resolvedExpression.args[0] as MilkdropShaderExpressionNode,
    )
  ) {
    return false;
  }

  const baseSample = getShaderSampleInfo(
    resolvedExpression.args[0] as MilkdropShaderExpressionNode,
  );
  const amount = evaluateShaderScalarResult(
    resolvedExpression.args[2] as MilkdropShaderExpressionNode,
    shaderValueEnv,
    shaderEnv,
    shaderExpressionEnv,
  );
  if (!amount || baseSample?.source !== 'main') {
    return false;
  }

  const targetNode = resolvedExpression.args[1] as MilkdropShaderExpressionNode;
  const auxSample = getShaderSampleInfo(targetNode);
  if (
    auxSample &&
    auxSample.source !== 'main' &&
    auxSample.source !== 'none' &&
    !isAuxShaderSamplerName(auxSample.source)
  ) {
    return true;
  }

  const invertedSample = extractShaderInvertedSampleExpression(targetNode);
  if (!invertedSample || invertedSample === 'main') {
    return false;
  }

  return !isAuxShaderSamplerName(invertedSample.source);
}

export function shouldEmitDirectProgramStatement(target: string) {
  const key = target.toLowerCase();
  const baseKey = key.split('.')[0] ?? key;
  return (
    baseKey === 'uv' ||
    baseKey === 'ret' ||
    baseKey === 'return' ||
    baseKey === 'shader_body'
  );
}

export function shouldRetainDirectProgramContextStatement(target: string) {
  const key = target.toLowerCase();
  if (shouldEmitDirectProgramStatement(key)) {
    return false;
  }
  return !(
    isKnownShaderScalarKey(key) ||
    key === 'tint' ||
    key === 'texture_source' ||
    key === 'texture_mode' ||
    key === 'warp_texture_source'
  );
}

export function shouldPreferDirectProgramExecution(
  target: string,
  expression: MilkdropShaderExpressionNode,
) {
  const key = target.toLowerCase();
  if (key !== 'ret' && key !== 'return' && key !== 'shader_body') {
    return false;
  }

  if (
    shouldUseTranslatedControlsForDirectAuxSample({
      declaration: null,
      target,
      operator: '=',
      rawValue: '',
      expression,
      source: '',
    })
  ) {
    return true;
  }

  const directSample = getShaderSampleInfo(expression);
  if (
    directSample &&
    directSample.source !== 'main' &&
    directSample.source !== 'none'
  ) {
    return true;
  }

  const scaledSample = extractScaledShaderSampleExpression(expression);
  return Boolean(
    scaledSample &&
      scaledSample.sample.sampleDimension === '3d' &&
      scaledSample.sample.source !== 'main' &&
      scaledSample.sample.source !== 'none',
  );
}
