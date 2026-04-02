import { Color, ShaderMaterial } from 'three';
import {
  createProceduralFieldUniformState,
  createProceduralInteractionUniformState,
} from '../renderer-helpers/procedural-field-uniforms';
import type {
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
} from '../types';

const PROCEDURAL_INTERACTION_SHADER_CHUNK = `
  vec2 applyMilkdropInteraction(vec2 point) {
    vec2 scaled = point * interactionScale;
    float cosRot = cos(interactionRotation);
    float sinRot = sin(interactionRotation);
    return vec2(
      scaled.x * cosRot - scaled.y * sinRot + interactionOffsetX,
      scaled.x * sinRot + scaled.y * cosRot + interactionOffsetY
    );
  }
`;

const PROCEDURAL_FIELD_PROGRAM_SIGNAL_PARAMETERS = `
  float signalTimeValue,
  float signalFrameValue,
  float signalFpsValue,
  float signalBassValue,
  float signalMidValue,
  float signalMidsValue,
  float signalTrebleValue,
  float signalBassAttValue,
  float signalMidAttValue,
  float signalMidsAttValue,
  float signalTrebleAttValue,
  float signalBeatValue,
  float signalBeatPulseValue,
  float signalRmsValue,
  float signalVolValue,
  float signalMusicValue,
  float signalWeightedEnergyValue
`;

const PROCEDURAL_FIELD_PROGRAM_SHADER_HELPERS = `
  float milkdropBool(float value) {
    return abs(value) > 0.000001 ? 1.0 : 0.0;
  }

  float milkdropSelect(bool condition, float whenTrue, float whenFalse) {
    return condition ? whenTrue : whenFalse;
  }

  float milkdropBitOr(float left, float right) {
    return float(int(left) | int(right));
  }

  float milkdropBitAnd(float left, float right) {
    return float(int(left) & int(right));
  }

  float milkdropBitNot(float value) {
    return float(~int(value));
  }

  float milkdropFrac(float value) {
    return value - floor(value);
  }

  float milkdropSigmoid(float value, float slope) {
    return 1.0 / (1.0 + exp(-value * slope));
  }

  float milkdropIf(float condition, float whenTrue, float whenFalse) {
    return abs(condition) > 0.000001 ? whenTrue : whenFalse;
  }

  float milkdropAbove(float left, float right) {
    return left > right ? 1.0 : 0.0;
  }

  float milkdropBelow(float left, float right) {
    return left < right ? 1.0 : 0.0;
  }

  float milkdropEqual(float left, float right) {
    return abs(left - right) <= 0.000001 ? 1.0 : 0.0;
  }

  float milkdropNormalizeTransformCenterX(float value) {
    return value >= 0.0 && value <= 1.0 ? (value - 0.5) * 2.0 : value;
  }

  float milkdropNormalizeTransformCenterY(float value) {
    return value >= 0.0 && value <= 1.0 ? (0.5 - value) * 2.0 : value;
  }

  float milkdropDenormalizeTransformCenterX(float value) {
    return value * 0.5 + 0.5;
  }

  float milkdropDenormalizeTransformCenterY(float value) {
    return 0.5 - value * 0.5;
  }
`;

function gpuFieldVarName(name: string) {
  switch (name) {
    case 'zoom':
      return 'fieldZoom';
    case 'zoomexp':
      return 'fieldZoomExponent';
    case 'rot':
      return 'fieldRotation';
    case 'warp':
      return 'fieldWarp';
    case 'cx':
      return 'fieldCenterX';
    case 'cy':
      return 'fieldCenterY';
    case 'sx':
      return 'fieldScaleX';
    case 'sy':
      return 'fieldScaleY';
    case 'dx':
      return 'fieldTranslateX';
    case 'dy':
      return 'fieldTranslateY';
    default:
      return `field_${name}`;
  }
}

function gpuFieldIdentifierToShaderSource(name: string) {
  switch (name) {
    case 'pi':
      return '3.141592653589793';
    case 'e':
      return '2.718281828459045';
    case 'time':
      return 'signalTimeValue';
    case 'frame':
      return 'signalFrameValue';
    case 'fps':
      return 'signalFpsValue';
    case 'bass':
      return 'signalBassValue';
    case 'mid':
      return 'signalMidValue';
    case 'mids':
      return 'signalMidsValue';
    case 'treble':
      return 'signalTrebleValue';
    case 'bassAtt':
      return 'signalBassAttValue';
    case 'midAtt':
      return 'signalMidAttValue';
    case 'midsAtt':
      return 'signalMidsAttValue';
    case 'trebleAtt':
      return 'signalTrebleAttValue';
    case 'beat':
      return 'signalBeatValue';
    case 'beatPulse':
      return 'signalBeatPulseValue';
    case 'rms':
      return 'signalRmsValue';
    case 'vol':
      return 'signalVolValue';
    case 'music':
      return 'signalMusicValue';
    case 'weightedEnergy':
      return 'signalWeightedEnergyValue';
    default:
      return gpuFieldVarName(name);
  }
}

function buildGpuFieldExpressionShaderSource(
  expression: MilkdropGpuFieldExpression,
): string {
  switch (expression.type) {
    case 'literal':
      return Number.isFinite(expression.value)
        ? expression.value.toString()
        : '0.0';
    case 'identifier':
      return gpuFieldIdentifierToShaderSource(expression.name);
    case 'unary': {
      const operand = buildGpuFieldExpressionShaderSource(expression.operand);
      if (expression.operator === '!') {
        return `(milkdropBool(${operand}) > 0.5 ? 0.0 : 1.0)`;
      }
      return `(${expression.operator}${operand})`;
    }
    case 'binary': {
      const left = buildGpuFieldExpressionShaderSource(expression.left);
      const right = buildGpuFieldExpressionShaderSource(expression.right);
      switch (expression.operator) {
        case '^':
          return `pow(${left}, ${right})`;
        case '%':
          return `(abs(${right}) <= 0.000001 ? 0.0 : mod(${left}, ${right}))`;
        case '|':
          return `milkdropBitOr(${left}, ${right})`;
        case '&':
          return `milkdropBitAnd(${left}, ${right})`;
        case '<':
        case '<=':
        case '>':
        case '>=':
        case '==':
        case '!=':
          return `(${left} ${expression.operator} ${right} ? 1.0 : 0.0)`;
        case '&&':
          return `((milkdropBool(${left}) > 0.5 && milkdropBool(${right}) > 0.5) ? 1.0 : 0.0)`;
        case '||':
          return `((milkdropBool(${left}) > 0.5 || milkdropBool(${right}) > 0.5) ? 1.0 : 0.0)`;
        default:
          return `(${left} ${expression.operator} ${right})`;
      }
    }
    case 'call': {
      const args = expression.args.map(buildGpuFieldExpressionShaderSource);
      switch (expression.name) {
        case 'mod':
        case 'fmod':
          return `(abs(${args[1]}) <= 0.000001 ? 0.0 : mod(${args[0]}, ${args[1]}))`;
        case 'mix':
        case 'lerp':
          return `mix(${args[0]}, ${args[1]}, ${args[2]})`;
        case 'int':
          return `floor(${args[0]})`;
        case 'sqr':
          return `((${args[0]}) * (${args[0]}))`;
        case 'sigmoid':
          return `milkdropSigmoid(${args[0]}, ${args[1]})`;
        case 'sign':
          return `sign(${args[0]})`;
        case 'bor':
          return `milkdropBitOr(${args[0]}, ${args[1]})`;
        case 'band':
          return `milkdropBitAnd(${args[0]}, ${args[1]})`;
        case 'bnot':
          return `milkdropBitNot(${args[0]})`;
        case 'atan2':
          return `atan(${args[0]}, ${args[1]})`;
        case 'frac':
          return `milkdropFrac(${args[0]})`;
        case 'if':
          return `milkdropIf(${args[0]}, ${args[1]}, ${args[2]})`;
        case 'above':
          return `milkdropAbove(${args[0]}, ${args[1]})`;
        case 'below':
          return `milkdropBelow(${args[0]}, ${args[1]})`;
        case 'equal':
          return `milkdropEqual(${args[0]}, ${args[1]})`;
        default:
          return `${expression.name}(${args.join(', ')})`;
      }
    }
  }
}

function buildProceduralFieldProgramShaderChunk(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  if (!program) {
    return `
      ${PROCEDURAL_FIELD_PROGRAM_SHADER_HELPERS}

      vec2 milkdropTransformPointWithParams(
        vec2 source,
        float paramZoom,
        float paramZoomExponent,
        float paramRotation,
        float paramWarp,
        float paramWarpAnimSpeed,
        float paramCenterX,
        float paramCenterY,
        float paramScaleX,
        float paramScaleY,
        float paramTranslateX,
        float paramTranslateY,
        ${PROCEDURAL_FIELD_PROGRAM_SIGNAL_PARAMETERS}
      ) {
        float radius = length(source);
        float angle = atan(source.y, source.x) + paramRotation;
        float transformedX =
          (source.x - paramCenterX) * paramScaleX + paramCenterX + paramTranslateX;
        float transformedY =
          (source.y - paramCenterY) * paramScaleY + paramCenterY + paramTranslateY;
        float ripple = sin(
          radius * 12.0 +
          signalTimeValue * (0.6 + signalTrebleAttValue) * (0.35 + paramWarpAnimSpeed)
        ) * paramWarp * 0.08;
        float radiusNormalized = clamp(radius / 1.41421356237, 0.0, 1.0);
        float zoomScale = pow(
          max(paramZoom, 0.0001),
          pow(max(paramZoomExponent, 0.0001), radiusNormalized * 2.0 - 1.0)
        );
        vec2 warped = vec2(
          (transformedX + cos(angle * 3.0) * ripple) * zoomScale,
          (transformedY + sin(angle * 4.0) * ripple) * zoomScale
        );
        float cosRot = cos(paramRotation);
        float sinRot = sin(paramRotation);
        return vec2(
          warped.x * cosRot - warped.y * sinRot,
          warped.x * sinRot + warped.y * cosRot
        );
      }
    `;
  }

  const temporaryDeclarations = program.temporaries
    .map((temporary) => `float ${gpuFieldVarName(temporary)} = 0.0;`)
    .join('\n        ');
  const statementCode = program.statements
    .map(
      (statement) =>
        `${gpuFieldVarName(statement.target)} = ${buildGpuFieldExpressionShaderSource(
          statement.expression,
        )};`,
    )
    .join('\n        ');
  return `
    ${PROCEDURAL_FIELD_PROGRAM_SHADER_HELPERS}

    vec2 milkdropTransformPointWithParams(
      vec2 source,
      float paramZoom,
      float paramZoomExponent,
      float paramRotation,
      float paramWarp,
      float paramWarpAnimSpeed,
      float paramCenterX,
      float paramCenterY,
      float paramScaleX,
      float paramScaleY,
      float paramTranslateX,
      float paramTranslateY,
      ${PROCEDURAL_FIELD_PROGRAM_SIGNAL_PARAMETERS}
    ) {
      float field_x = source.x;
      float field_y = source.y;
      float field_rad = length(source);
      float field_ang = atan(source.y, source.x);
      float fieldZoom = paramZoom;
      float fieldZoomExponent = paramZoomExponent;
      float fieldRotation = paramRotation;
      float fieldWarp = paramWarp;
      float fieldCenterX = milkdropDenormalizeTransformCenterX(paramCenterX);
      float fieldCenterY = milkdropDenormalizeTransformCenterY(paramCenterY);
      float fieldScaleX = paramScaleX;
      float fieldScaleY = paramScaleY;
      float fieldTranslateX = paramTranslateX * 0.5;
      float fieldTranslateY = paramTranslateY * 0.5;
      ${temporaryDeclarations}
      ${statementCode}

      float normalizedCenterX = milkdropNormalizeTransformCenterX(fieldCenterX);
      float normalizedCenterY = milkdropNormalizeTransformCenterY(fieldCenterY);
      float angle = field_ang + fieldRotation;
      float translatedX =
        (field_x - normalizedCenterX) * fieldScaleX +
        normalizedCenterX +
        fieldTranslateX * 2.0;
      float translatedY =
        (field_y - normalizedCenterY) * fieldScaleY +
        normalizedCenterY +
        fieldTranslateY * 2.0;
      float ripple = sin(
        field_rad * 12.0 +
        signalTimeValue * (0.6 + signalTrebleAttValue) * (0.35 + paramWarpAnimSpeed)
      ) * fieldWarp * 0.08;
      float radiusNormalized = clamp(field_rad / 1.41421356237, 0.0, 1.0);
      float zoomScale = pow(
        max(fieldZoom, 0.0001),
        pow(max(fieldZoomExponent, 0.0001), radiusNormalized * 2.0 - 1.0)
      );
      float px = (translatedX + cos(angle * 3.0) * ripple) * zoomScale;
      float py = (translatedY + sin(angle * 4.0) * ripple) * zoomScale;
      float cosRot = cos(fieldRotation);
      float sinRot = sin(fieldRotation);
      return vec2(
        px * cosRot - py * sinRot,
        px * sinRot + py * cosRot
      );
    }
  `;
}

function buildGpuFieldTemporaryDeclarations(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return (program?.temporaries ?? [])
    .map((temporary) => `float ${gpuFieldVarName(temporary)} = 0.0;`)
    .join('\n        ');
}

function buildGpuFieldStatementCode(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return (program?.statements ?? [])
    .map(
      (statement) =>
        `${gpuFieldVarName(statement.target)} = ${buildGpuFieldExpressionShaderSource(
          statement.expression,
        )};`,
    )
    .join('\n        ');
}

function buildProceduralCustomWaveProgramShaderChunk(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  if (!program) {
    return '';
  }

  const temporaryDeclarations = buildGpuFieldTemporaryDeclarations(program);
  const statementCode = buildGpuFieldStatementCode(program);
  return `
    ${PROCEDURAL_FIELD_PROGRAM_SHADER_HELPERS}

    vec2 milkdropCustomWavePointWithProgram(
      float sampleTValue,
      float sampleValue1,
      float sampleValue2,
      float paramCenterX,
      float paramCenterY,
      float paramScaling,
      float paramMystery,
      float paramSpectrum,
      float paramSamples,
      ${PROCEDURAL_FIELD_PROGRAM_SIGNAL_PARAMETERS}
    ) {
      float field_sample = sampleTValue;
      float field_value = sampleValue1;
      float field_value1 = sampleValue1;
      float field_value2 = sampleValue2;
      float field_samples = paramSamples;
      float field_spectrum = paramSpectrum;
      float field_scaling = paramScaling;
      float field_mystery = paramMystery;
      float baseY =
        paramCenterY +
        (sampleValue1 - 0.5) * 0.55 * paramScaling * (1.0 + paramMystery * 0.25);
      float orbitalY =
        paramCenterY +
        sin(
          sampleTValue * 3.141592653589793 * 2.0 * (1.0 + paramMystery) +
            signalTimeValue
        ) *
          0.18 *
          paramScaling;
      float field_x = paramCenterX + (-1.0 + sampleTValue * 2.0) * 0.85;
      float field_y = mix(orbitalY, baseY, paramSpectrum);
      float field_rad = length(vec2(field_x, field_y));
      float field_ang = atan(field_y, field_x);
      ${temporaryDeclarations}
      ${statementCode}
      return vec2(field_x, field_y);
    }
  `;
}

export function createProceduralMeshMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const uniforms = {
    ...createProceduralFieldUniformState(),
    ...createProceduralInteractionUniformState(),
  };
  const fieldProgramShader = buildProceduralFieldProgramShaderChunk(program);
  return new ShaderMaterial({
    uniforms,
    userData: {
      fieldProgramSignature: program?.signature ?? 'default',
    },
    transparent: true,
    vertexShader: `
      attribute vec3 sourcePosition;
      uniform float zoom;
      uniform float zoomExponent;
      uniform float rotation;
      uniform float warp;
      uniform float warpAnimSpeed;
      uniform float time;
      uniform float trebleAtt;
      uniform float interactionOffsetX;
      uniform float interactionOffsetY;
      uniform float interactionRotation;
      uniform float interactionScale;
      uniform float signalTime;
      uniform float signalFrame;
      uniform float signalFps;
      uniform float signalBass;
      uniform float signalMid;
      uniform float signalMids;
      uniform float signalTreble;
      uniform float signalBassAtt;
      uniform float signalMidAtt;
      uniform float signalMidsAtt;
      uniform float signalTrebleAtt;
      uniform float signalBeat;
      uniform float signalBeatPulse;
      uniform float signalRms;
      uniform float signalVol;
      uniform float signalMusic;
      uniform float signalWeightedEnergy;
      ${fieldProgramShader}
      ${PROCEDURAL_INTERACTION_SHADER_CHUNK}

      void main() {
        vec2 transformed = applyMilkdropInteraction(
          milkdropTransformPointWithParams(
            sourcePosition.xy,
            zoom,
            zoomExponent,
            rotation,
            warp,
            warpAnimSpeed,
            centerX,
            centerY,
            scaleX,
            scaleY,
            translateX,
            translateY,
            signalTime,
            signalFrame,
            signalFps,
            signalBass,
            signalMid,
            signalMids,
            signalTreble,
            signalBassAtt,
            signalMidAtt,
            signalMidsAtt,
            signalTrebleAtt,
            signalBeat,
            signalBeatPulse,
            signalRms,
            signalVol,
            signalMusic,
            signalWeightedEnergy
          )
        );
        gl_Position = projectionMatrix * modelViewMatrix * vec4(
          transformed.xy,
          sourcePosition.z,
          1.0
        );
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float alpha;
      uniform float interactionAlpha;

      void main() {
        gl_FragColor = vec4(tint, alpha * interactionAlpha);
      }
    `,
  });
}

export function createProceduralMotionVectorMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const uniforms = {
    ...createProceduralFieldUniformState(),
    ...createProceduralInteractionUniformState(),
    sourceOffsetX: { value: 0 },
    sourceOffsetY: { value: 0 },
    explicitLength: { value: 0 },
    legacyControls: { value: 0 },
    previousZoom: { value: 1 },
    previousZoomExponent: { value: 1 },
    previousRotation: { value: 0 },
    previousWarp: { value: 0 },
    previousWarpAnimSpeed: { value: 1 },
    previousCenterX: { value: 0 },
    previousCenterY: { value: 0 },
    previousScaleX: { value: 1 },
    previousScaleY: { value: 1 },
    previousTranslateX: { value: 0 },
    previousTranslateY: { value: 0 },
    previousSourceOffsetX: { value: 0 },
    previousSourceOffsetY: { value: 0 },
    previousExplicitLength: { value: 0 },
    blendMix: { value: 1 },
    previousSignalTime: { value: 0 },
    previousSignalFrame: { value: 0 },
    previousSignalFps: { value: 60 },
    previousSignalBass: { value: 0 },
    previousSignalMid: { value: 0 },
    previousSignalMids: { value: 0 },
    previousSignalTreble: { value: 0 },
    previousSignalBassAtt: { value: 0 },
    previousSignalMidAtt: { value: 0 },
    previousSignalMidsAtt: { value: 0 },
    previousSignalTrebleAtt: { value: 0 },
    previousSignalBeat: { value: 0 },
    previousSignalBeatPulse: { value: 0 },
    previousSignalRms: { value: 0 },
    previousSignalVol: { value: 0 },
    previousSignalMusic: { value: 0 },
    previousSignalWeightedEnergy: { value: 0 },
  };
  const fieldProgramShader = buildProceduralFieldProgramShaderChunk(program);
  return new ShaderMaterial({
    uniforms,
    userData: {
      fieldProgramSignature: program?.signature ?? 'default',
    },
    transparent: true,
    vertexShader: `
      attribute vec3 sourcePosition;
      attribute float endpointWeight;
      uniform float zoom;
      uniform float zoomExponent;
      uniform float rotation;
      uniform float warp;
      uniform float warpAnimSpeed;
      uniform float centerX;
      uniform float centerY;
      uniform float scaleX;
      uniform float scaleY;
      uniform float translateX;
      uniform float translateY;
      uniform float time;
      uniform float trebleAtt;
      uniform float sourceOffsetX;
      uniform float sourceOffsetY;
      uniform float explicitLength;
      uniform float interactionOffsetX;
      uniform float interactionOffsetY;
      uniform float interactionRotation;
      uniform float interactionScale;
      uniform float interactionAlpha;
      uniform float previousZoom;
      uniform float previousZoomExponent;
      uniform float previousRotation;
      uniform float previousWarp;
      uniform float previousWarpAnimSpeed;
      uniform float previousCenterX;
      uniform float previousCenterY;
      uniform float previousScaleX;
      uniform float previousScaleY;
      uniform float previousTranslateX;
      uniform float previousTranslateY;
      uniform float previousSourceOffsetX;
      uniform float previousSourceOffsetY;
      uniform float previousExplicitLength;
      uniform float blendMix;
      varying float vAlpha;
      uniform float signalTime;
      uniform float signalFrame;
      uniform float signalFps;
      uniform float signalBass;
      uniform float signalMid;
      uniform float signalMids;
      uniform float signalTreble;
      uniform float signalBassAtt;
      uniform float signalMidAtt;
      uniform float signalMidsAtt;
      uniform float signalTrebleAtt;
      uniform float signalBeat;
      uniform float signalBeatPulse;
      uniform float signalRms;
      uniform float signalVol;
      uniform float signalMusic;
      uniform float signalWeightedEnergy;
      uniform float previousSignalTime;
      uniform float previousSignalFrame;
      uniform float previousSignalFps;
      uniform float previousSignalBass;
      uniform float previousSignalMid;
      uniform float previousSignalMids;
      uniform float previousSignalTreble;
      uniform float previousSignalBassAtt;
      uniform float previousSignalMidAtt;
      uniform float previousSignalMidsAtt;
      uniform float previousSignalTrebleAtt;
      uniform float previousSignalBeat;
      uniform float previousSignalBeatPulse;
      uniform float previousSignalRms;
      uniform float previousSignalVol;
      uniform float previousSignalMusic;
      uniform float previousSignalWeightedEnergy;
      ${fieldProgramShader}
      ${PROCEDURAL_INTERACTION_SHADER_CHUNK}

      void main() {
        vec2 currentSource = clamp(
          sourcePosition.xy + vec2(sourceOffsetX, sourceOffsetY),
          vec2(-1.0),
          vec2(1.0)
        );
        vec2 previousSource = clamp(
          sourcePosition.xy + vec2(previousSourceOffsetX, previousSourceOffsetY),
          vec2(-1.0),
          vec2(1.0)
        );
        vec2 current = milkdropTransformPointWithParams(
          currentSource,
          zoom,
          zoomExponent,
          rotation,
          warp,
          warpAnimSpeed,
          centerX,
          centerY,
          scaleX,
          scaleY,
          translateX,
          translateY,
          signalTime,
          signalFrame,
          signalFps,
          signalBass,
          signalMid,
          signalMids,
          signalTreble,
          signalBassAtt,
          signalMidAtt,
          signalMidsAtt,
          signalTrebleAtt,
          signalBeat,
          signalBeatPulse,
          signalRms,
          signalVol,
          signalMusic,
          signalWeightedEnergy
        );
        vec2 previous = milkdropTransformPointWithParams(
          previousSource,
          previousZoom,
          previousZoomExponent,
          previousRotation,
          previousWarp,
          previousWarpAnimSpeed,
          previousCenterX,
          previousCenterY,
          previousScaleX,
          previousScaleY,
          previousTranslateX,
          previousTranslateY,
          previousSignalTime,
          previousSignalFrame,
          previousSignalFps,
          previousSignalBass,
          previousSignalMid,
          previousSignalMids,
          previousSignalTreble,
          previousSignalBassAtt,
          previousSignalMidAtt,
          previousSignalMidsAtt,
          previousSignalTrebleAtt,
          previousSignalBeat,
          previousSignalBeatPulse,
          previousSignalRms,
          previousSignalVol,
          previousSignalMusic,
          previousSignalWeightedEnergy
        );
        vec2 blendedCurrent = mix(previous, current, blendMix);
        vec2 blendedSource = mix(previousSource, currentSource, blendMix);
        vec2 delta = clamp(
          (blendedCurrent - blendedSource) * 1.35,
          vec2(-0.24),
          vec2(0.24)
        );
        float explicitLengthMixed = mix(
          previousExplicitLength,
          explicitLength,
          blendMix
        );
        float magnitude = length(delta);
        if (explicitLengthMixed > 0.0001 && magnitude > 0.0001) {
          delta = delta / magnitude * explicitLengthMixed;
          magnitude = length(delta);
        }
        vec2 renderPoint = mix(
          blendedCurrent - delta * 0.45,
          blendedCurrent + delta,
          endpointWeight
        );
        renderPoint = applyMilkdropInteraction(renderPoint);
        vAlpha =
          alpha *
          interactionAlpha *
          clamp(0.75 + magnitude * 2.2, 0.0, 1.0) *
          step(0.002, magnitude);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(
          renderPoint.xy,
          sourcePosition.z,
          1.0
        );
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.0) {
          discard;
        }
        gl_FragColor = vec4(tint, vAlpha);
      }
    `,
  });
}

export function createProceduralWaveMaterial() {
  return new ShaderMaterial({
    uniforms: {
      mode: { value: 0 },
      centerX: { value: 0 },
      centerY: { value: 0 },
      scale: { value: 0.34 },
      mystery: { value: 0 },
      signalTime: { value: 0 },
      beatPulse: { value: 0 },
      trebleAtt: { value: 0 },
      tint: { value: new Color(1, 1, 1) },
      alpha: { value: 1 },
      previousCenterX: { value: 0 },
      previousCenterY: { value: 0 },
      previousScale: { value: 0.34 },
      previousMystery: { value: 0 },
      previousSignalTime: { value: 0 },
      previousBeatPulse: { value: 0 },
      previousTrebleAtt: { value: 0 },
      blendMix: { value: 1 },
      ...createProceduralInteractionUniformState(),
    },
    transparent: true,
    vertexShader: `
      attribute float sampleT;
      attribute float sampleValue;
      attribute float sampleVelocity;
      attribute float previousSampleValue;
      attribute float previousSampleVelocity;
      uniform float mode;
      uniform float centerX;
      uniform float centerY;
      uniform float scale;
      uniform float mystery;
      uniform float signalTime;
      uniform float beatPulse;
      uniform float trebleAtt;
      uniform float previousCenterX;
      uniform float previousCenterY;
      uniform float previousScale;
      uniform float previousMystery;
      uniform float previousSignalTime;
      uniform float previousBeatPulse;
      uniform float previousTrebleAtt;
      uniform float blendMix;
      uniform float interactionOffsetX;
      uniform float interactionOffsetY;
      uniform float interactionRotation;
      uniform float interactionScale;
      ${PROCEDURAL_INTERACTION_SHADER_CHUNK}

      vec2 milkdropWavePoint(
        float t,
        float sampleValue,
        float velocity,
        float pointCenterX,
        float pointCenterY,
        float pointScale,
        float pointMystery,
        float pointSignalTime,
        float pointBeatPulse,
        float pointTrebleAtt
      ) {
        float centeredSample = sampleValue - 0.5;
        float mysteryPhase = pointMystery * 3.141592653589793;
        float x = 0.0;
        float y = 0.0;

        if (mode < 0.5) {
          x = -1.1 + t * 2.2;
          y =
            pointCenterY +
            sin(
              t * 3.141592653589793 * 2.0 +
                pointSignalTime * (0.55 + pointMystery)
            ) * (0.06 + pointTrebleAtt * 0.08) +
            centeredSample * pointScale * 1.7 +
            velocity * 0.12;
        } else if (mode < 1.5) {
          float angle =
            t * 3.141592653589793 * 2.0 +
            pointSignalTime * 0.32 +
            centeredSample * 0.8 +
            velocity * 2.5;
          float radius =
            0.22 +
            sampleValue * pointScale +
            pointBeatPulse * 0.08 +
            sin(t * 3.141592653589793 * 4.0 + pointSignalTime) * 0.015;
          x = pointCenterX + cos(angle) * radius;
          y = pointCenterY + sin(angle) * radius;
        } else if (mode < 2.5) {
          float angle =
            t * 3.141592653589793 * 5.0 +
            pointSignalTime * (0.4 + pointMystery * 0.2) +
            centeredSample * 0.65;
          float radius =
            0.08 + t * 0.6 + sampleValue * pointScale * 0.6 + velocity * 0.12;
          x = pointCenterX + cos(angle) * radius;
          y = pointCenterY + sin(angle) * radius;
        } else if (mode < 3.5) {
          float angle = t * 3.141592653589793 * 2.0 + pointSignalTime * 0.22;
          float spoke =
            0.2 +
            sampleValue * pointScale * 1.05 +
            sin(t * 3.141592653589793 * 12.0 + mysteryPhase) * 0.05 +
            velocity * 0.09;
          float pinch =
            0.55 + cos(t * 3.141592653589793 * 6.0 + pointSignalTime) * 0.2;
          x = pointCenterX + cos(angle) * spoke;
          y = pointCenterY + sin(angle) * spoke * pinch;
        } else if (mode < 4.5) {
          x =
            pointCenterX +
            (sampleValue - 0.5) * pointScale * 1.85 +
            sin(t * 3.141592653589793 * 10.0 + pointSignalTime * 0.5) * 0.04;
          y = 1.08 - t * 2.16 + velocity * 0.22;
        } else if (mode < 5.5) {
          float angle = t * 3.141592653589793 * 2.0 + pointSignalTime * 0.18;
          float xAmp = 0.26 + sampleValue * pointScale * 0.75;
          float yAmp = 0.18 + sampleValue * pointScale;
          x =
            pointCenterX +
            sin(angle * (2.0 + pointMystery * 0.6)) * xAmp +
            cos(angle * 4.0 + mysteryPhase) * 0.04 +
            velocity * 0.16;
          y =
            pointCenterY +
            sin(angle * (3.0 + pointMystery * 0.5) + 3.141592653589793 / 2.0) *
              yAmp;
        } else if (mode < 6.5) {
          float band = (sampleValue - 0.5) * pointScale * 1.4;
          x = -1.05 + t * 2.1;
          y =
            pointCenterY +
            (mod(floor(t * 512.0), 2.0) < 0.5 ? band : -band) +
            sin(t * 3.141592653589793 * 8.0 + pointSignalTime * 0.55) * 0.03 +
            velocity * 0.18;
        } else {
          float angle =
            t * 3.141592653589793 * 2.0 +
            pointSignalTime * (0.24 + pointMystery * 0.1);
          float petals =
            3.0 + floor(clamp(pointMystery * 3.0, 0.0, 3.0) + 0.5);
          float radius =
            0.12 +
            (0.2 + sampleValue * pointScale * 0.9) *
              cos(petals * angle + mysteryPhase) +
            velocity * 0.14;
          x = pointCenterX + cos(angle) * radius;
          y = pointCenterY + sin(angle) * radius;
        }

        return vec2(x, y);
      }

      void main() {
        float blendedSampleValue = mix(
          previousSampleValue,
          sampleValue,
          blendMix
        );
        float blendedVelocity = mix(
          previousSampleVelocity,
          sampleVelocity,
          blendMix
        );
        vec2 point = milkdropWavePoint(
          sampleT,
          blendedSampleValue,
          blendedVelocity,
          mix(previousCenterX, centerX, blendMix),
          mix(previousCenterY, centerY, blendMix),
          mix(previousScale, scale, blendMix),
          mix(previousMystery, mystery, blendMix),
          mix(previousSignalTime, signalTime, blendMix),
          mix(previousBeatPulse, beatPulse, blendMix),
          mix(previousTrebleAtt, trebleAtt, blendMix)
        );
        point = applyMilkdropInteraction(point);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 0.24, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float alpha;
      uniform float interactionAlpha;

      void main() {
        gl_FragColor = vec4(tint, alpha * interactionAlpha);
      }
    `,
  });
}

export function createProceduralCustomWaveMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const customWaveProgramShader =
    buildProceduralCustomWaveProgramShaderChunk(program);
  return new ShaderMaterial({
    uniforms: {
      centerX: { value: 0 },
      centerY: { value: 0 },
      scaling: { value: 1 },
      mystery: { value: 0 },
      signalTime: { value: 0 },
      signalFrame: { value: 0 },
      signalFps: { value: 60 },
      signalBass: { value: 0 },
      signalMid: { value: 0 },
      signalMids: { value: 0 },
      signalTreble: { value: 0 },
      signalBassAtt: { value: 0 },
      signalMidAtt: { value: 0 },
      signalMidsAtt: { value: 0 },
      signalTrebleAtt: { value: 0 },
      signalBeat: { value: 0 },
      signalBeatPulse: { value: 0 },
      signalRms: { value: 0 },
      signalVol: { value: 0 },
      signalMusic: { value: 0 },
      signalWeightedEnergy: { value: 0 },
      spectrum: { value: 0 },
      sampleCount: { value: 64 },
      tint: { value: new Color(1, 1, 1) },
      alpha: { value: 1 },
      previousCenterX: { value: 0 },
      previousCenterY: { value: 0 },
      previousScaling: { value: 1 },
      previousMystery: { value: 0 },
      previousSignalTime: { value: 0 },
      previousSignalFrame: { value: 0 },
      previousSignalFps: { value: 60 },
      previousSignalBass: { value: 0 },
      previousSignalMid: { value: 0 },
      previousSignalMids: { value: 0 },
      previousSignalTreble: { value: 0 },
      previousSignalBassAtt: { value: 0 },
      previousSignalMidAtt: { value: 0 },
      previousSignalMidsAtt: { value: 0 },
      previousSignalTrebleAtt: { value: 0 },
      previousSignalBeat: { value: 0 },
      previousSignalBeatPulse: { value: 0 },
      previousSignalRms: { value: 0 },
      previousSignalVol: { value: 0 },
      previousSignalMusic: { value: 0 },
      previousSignalWeightedEnergy: { value: 0 },
      previousSpectrum: { value: 0 },
      previousSampleCount: { value: 64 },
      blendMix: { value: 1 },
      ...createProceduralInteractionUniformState(),
    },
    userData: {
      fieldProgramSignature: program?.signature ?? 'default',
    },
    transparent: true,
    vertexShader: `
      attribute float sampleT;
      attribute float sampleValue;
      attribute float sampleValue2;
      attribute float previousSampleValue;
      attribute float previousSampleValue2;
      uniform float centerX;
      uniform float centerY;
      uniform float scaling;
      uniform float mystery;
      uniform float signalTime;
      uniform float signalFrame;
      uniform float signalFps;
      uniform float signalBass;
      uniform float signalMid;
      uniform float signalMids;
      uniform float signalTreble;
      uniform float signalBassAtt;
      uniform float signalMidAtt;
      uniform float signalMidsAtt;
      uniform float signalTrebleAtt;
      uniform float signalBeat;
      uniform float signalBeatPulse;
      uniform float signalRms;
      uniform float signalVol;
      uniform float signalMusic;
      uniform float signalWeightedEnergy;
      uniform float spectrum;
      uniform float sampleCount;
      uniform float previousCenterX;
      uniform float previousCenterY;
      uniform float previousScaling;
      uniform float previousMystery;
      uniform float previousSignalTime;
      uniform float previousSignalFrame;
      uniform float previousSignalFps;
      uniform float previousSignalBass;
      uniform float previousSignalMid;
      uniform float previousSignalMids;
      uniform float previousSignalTreble;
      uniform float previousSignalBassAtt;
      uniform float previousSignalMidAtt;
      uniform float previousSignalMidsAtt;
      uniform float previousSignalTrebleAtt;
      uniform float previousSignalBeat;
      uniform float previousSignalBeatPulse;
      uniform float previousSignalRms;
      uniform float previousSignalVol;
      uniform float previousSignalMusic;
      uniform float previousSignalWeightedEnergy;
      uniform float previousSpectrum;
      uniform float previousSampleCount;
      uniform float blendMix;
      uniform float interactionOffsetX;
      uniform float interactionOffsetY;
      uniform float interactionRotation;
      uniform float interactionScale;
      ${customWaveProgramShader}
      ${PROCEDURAL_INTERACTION_SHADER_CHUNK}

      void main() {
        float blendedSampleValue = mix(
          previousSampleValue,
          sampleValue,
          blendMix
        );
        float blendedSampleValue2 = mix(
          previousSampleValue2,
          sampleValue2,
          blendMix
        );
        float blendedCenterX = mix(previousCenterX, centerX, blendMix);
        float blendedCenterY = mix(previousCenterY, centerY, blendMix);
        float blendedScaling = mix(previousScaling, scaling, blendMix);
        float blendedMystery = mix(previousMystery, mystery, blendMix);
        float blendedSignalTime = mix(previousSignalTime, signalTime, blendMix);
        float blendedSpectrum = mix(previousSpectrum, spectrum, blendMix);
        float blendedSampleCount = mix(
          previousSampleCount,
          sampleCount,
          blendMix
        );
        vec2 point = vec2(0.0);
        ${
          /* This branch is compile-time constant because the helper chunk only exists when a program is present. */
          ''
        }
        ${
          program
            ? `
        point = milkdropCustomWavePointWithProgram(
          sampleT,
          blendedSampleValue,
          blendedSampleValue2,
          blendedCenterX,
          blendedCenterY,
          blendedScaling,
          blendedMystery,
          blendedSpectrum,
          blendedSampleCount,
          blendedSignalTime,
          mix(previousSignalFrame, signalFrame, blendMix),
          mix(previousSignalFps, signalFps, blendMix),
          mix(previousSignalBass, signalBass, blendMix),
          mix(previousSignalMid, signalMid, blendMix),
          mix(previousSignalMids, signalMids, blendMix),
          mix(previousSignalTreble, signalTreble, blendMix),
          mix(previousSignalBassAtt, signalBassAtt, blendMix),
          mix(previousSignalMidAtt, signalMidAtt, blendMix),
          mix(previousSignalMidsAtt, signalMidsAtt, blendMix),
          mix(previousSignalTrebleAtt, signalTrebleAtt, blendMix),
          mix(previousSignalBeat, signalBeat, blendMix),
          mix(previousSignalBeatPulse, signalBeatPulse, blendMix),
          mix(previousSignalRms, signalRms, blendMix),
          mix(previousSignalVol, signalVol, blendMix),
          mix(previousSignalMusic, signalMusic, blendMix),
          mix(previousSignalWeightedEnergy, signalWeightedEnergy, blendMix)
        );`
            : `
        float x = blendedCenterX + (-1.0 + sampleT * 2.0) * 0.85;
        float baseY =
          blendedCenterY +
          (blendedSampleValue - 0.5) *
            0.55 *
            blendedScaling *
            (1.0 + blendedMystery * 0.25);
        float orbitalY =
          blendedCenterY +
          sin(
            sampleT * 3.141592653589793 * 2.0 * (1.0 + blendedMystery) +
              blendedSignalTime
          ) *
            0.18 *
            blendedScaling;
        point = vec2(x, mix(orbitalY, baseY, blendedSpectrum));`
        }
        point = applyMilkdropInteraction(point);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 0.28, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float alpha;
      uniform float interactionAlpha;

      void main() {
        gl_FragColor = vec4(tint, alpha * interactionAlpha);
      }
    `,
  });
}
