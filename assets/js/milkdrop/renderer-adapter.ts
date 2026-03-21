import type { Camera, Scene } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropFeedbackSetRenderTarget,
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropGpuFieldSignalInputs,
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionTransform,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralFieldTransformVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
  MilkdropWebGpuDescriptorPlan,
} from './types';

type RendererLike = {
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: RendererSetRenderTarget;
};

type RendererSetRenderTarget = {
  bivarianceHack: MilkdropFeedbackSetRenderTarget;
}['bivarianceHack'];

export type MilkdropRendererAdapterConfig = {
  scene: Scene;
  camera: Camera;
  renderer?: RendererLike | null;
  backend: 'webgl' | 'webgpu';
  preset?: MilkdropCompiledPreset | null;
  behavior?: MilkdropBackendBehavior;
  createFeedbackManager?: MilkdropFeedbackManagerFactory;
  batcher?: MilkdropRendererBatcher | null;
};

export type MilkdropRendererBatcher = {
  attach: (root: Group) => void;
  dispose: () => void;
  renderWaveGroup?: (
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier: number,
  ) => boolean;
  renderProceduralWaveGroup?: (
    target: 'main-wave' | 'trail-waves',
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
  ) => boolean;
  renderProceduralCustomWaveGroup?: (
    group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
  ) => boolean;
  renderShapeGroup?: (
    target: 'shapes' | 'blend-shapes',
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier: number,
  ) => boolean;
  renderBorderGroup?: (
    target: 'borders' | 'blend-borders',
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier: number,
  ) => boolean;
  renderLineVisualGroup?: (
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier: number,
  ) => boolean;
};

export type FeedbackBackendProfile = {
  currentFrameBoost: number;
  feedbackSoftness: number;
  sceneResolutionScale: number;
  feedbackResolutionScale: number;
  samples: number;
};

export type MilkdropFeedbackManagerFactory = (
  width: number,
  height: number,
) => MilkdropFeedbackManager;

export type MilkdropBackendBehavior = {
  feedbackProfile: FeedbackBackendProfile;
  useHalfFloatFeedback: boolean;
  closeLinesManually: boolean;
  useLineLoopPrimitives: boolean;
  supportsShapeGradient: boolean;
  supportsFeedbackPass: boolean;
};

export const WEBGL_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0,
    feedbackSoftness: 0,
    sceneResolutionScale: 0.72,
    feedbackResolutionScale: 0.72,
    samples: 0,
  },
  useHalfFloatFeedback: false,
  closeLinesManually: false,
  useLineLoopPrimitives: true,
  supportsShapeGradient: true,
  supportsFeedbackPass: true,
};

export const WEBGPU_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.65,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 0.85,
    samples: 0,
  },
  useHalfFloatFeedback: true,
  closeLinesManually: true,
  useLineLoopPrimitives: false,
  supportsShapeGradient: false,
  supportsFeedbackPass: true,
};

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const PROCEDURAL_MESH_BOUNDS_RADIUS = Math.SQRT2 * 2;
const PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS = Math.SQRT2 * 2.35;
const PROCEDURAL_WAVE_BOUNDS_RADIUS = Math.SQRT2 * 2.2;
const BACKGROUND_GEOMETRY = markSharedGeometry(new PlaneGeometry(6.4, 6.4));
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<string, BufferGeometry>();
const proceduralMeshGeometryCache = new Map<number, BufferGeometry>();
const proceduralMotionVectorGeometryCache = new Map<string, BufferGeometry>();
const proceduralWaveGeometryCache = new Map<number, BufferGeometry>();

type ProceduralFieldUniformState = {
  zoom: { value: number };
  zoomExponent: { value: number };
  rotation: { value: number };
  warp: { value: number };
  warpAnimSpeed: { value: number };
  centerX: { value: number };
  centerY: { value: number };
  scaleX: { value: number };
  scaleY: { value: number };
  translateX: { value: number };
  translateY: { value: number };
  time: { value: number };
  trebleAtt: { value: number };
  tint: { value: Color };
  alpha: { value: number };
  signalTime: { value: number };
  signalFrame: { value: number };
  signalFps: { value: number };
  signalBass: { value: number };
  signalMid: { value: number };
  signalMids: { value: number };
  signalTreble: { value: number };
  signalBassAtt: { value: number };
  signalMidAtt: { value: number };
  signalMidsAtt: { value: number };
  signalTrebleAtt: { value: number };
  signalBeat: { value: number };
  signalBeatPulse: { value: number };
  signalRms: { value: number };
  signalVol: { value: number };
  signalMusic: { value: number };
  signalWeightedEnergy: { value: number };
};

type ProceduralFieldVisualWithSignals =
  MilkdropProceduralFieldTransformVisual & {
    signals: MilkdropGpuFieldSignalInputs;
  };

type ProceduralInteractionUniformState = {
  interactionOffsetX: { value: number };
  interactionOffsetY: { value: number };
  interactionRotation: { value: number };
  interactionScale: { value: number };
  interactionAlpha: { value: number };
};

function createProceduralFieldUniformState() {
  return {
    zoom: { value: 1 },
    zoomExponent: { value: 1 },
    rotation: { value: 0 },
    warp: { value: 0 },
    warpAnimSpeed: { value: 1 },
    centerX: { value: 0 },
    centerY: { value: 0 },
    scaleX: { value: 1 },
    scaleY: { value: 1 },
    translateX: { value: 0 },
    translateY: { value: 0 },
    time: { value: 0 },
    trebleAtt: { value: 0 },
    tint: { value: new Color(1, 1, 1) },
    alpha: { value: 1 },
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
  } satisfies ProceduralFieldUniformState;
}

function createProceduralInteractionUniformState() {
  return {
    interactionOffsetX: { value: 0 },
    interactionOffsetY: { value: 0 },
    interactionRotation: { value: 0 },
    interactionScale: { value: 1 },
    interactionAlpha: { value: 1 },
  } satisfies ProceduralInteractionUniformState;
}

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
      float fieldCenterX = paramCenterX;
      float fieldCenterY = paramCenterY;
      float fieldScaleX = paramScaleX;
      float fieldScaleY = paramScaleY;
      float fieldTranslateX = paramTranslateX * 0.5;
      float fieldTranslateY = paramTranslateY * 0.5;
      ${temporaryDeclarations}
      ${statementCode}

      float angle = field_ang + fieldRotation;
      float translatedX =
        (field_x - fieldCenterX) * fieldScaleX +
        fieldCenterX +
        fieldTranslateX * 2.0;
      float translatedY =
        (field_y - fieldCenterY) * fieldScaleY +
        fieldCenterY +
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

function createProceduralMeshMaterial(
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

function createProceduralMotionVectorMaterial(
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

function createProceduralWaveMaterial() {
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

function createProceduralCustomWaveMaterial() {
  return new ShaderMaterial({
    uniforms: {
      centerX: { value: 0 },
      centerY: { value: 0 },
      scaling: { value: 1 },
      mystery: { value: 0 },
      signalTime: { value: 0 },
      spectrum: { value: 0 },
      tint: { value: new Color(1, 1, 1) },
      alpha: { value: 1 },
      previousCenterX: { value: 0 },
      previousCenterY: { value: 0 },
      previousScaling: { value: 1 },
      previousMystery: { value: 0 },
      previousSignalTime: { value: 0 },
      previousSpectrum: { value: 0 },
      blendMix: { value: 1 },
      ...createProceduralInteractionUniformState(),
    },
    transparent: true,
    vertexShader: `
      attribute float sampleT;
      attribute float sampleValue;
      attribute float previousSampleValue;
      uniform float centerX;
      uniform float centerY;
      uniform float scaling;
      uniform float mystery;
      uniform float signalTime;
      uniform float spectrum;
      uniform float previousCenterX;
      uniform float previousCenterY;
      uniform float previousScaling;
      uniform float previousMystery;
      uniform float previousSignalTime;
      uniform float previousSpectrum;
      uniform float blendMix;
      uniform float interactionOffsetX;
      uniform float interactionOffsetY;
      uniform float interactionRotation;
      uniform float interactionScale;
      ${PROCEDURAL_INTERACTION_SHADER_CHUNK}

      void main() {
        float blendedSampleValue = mix(
          previousSampleValue,
          sampleValue,
          blendMix
        );
        float blendedCenterX = mix(previousCenterX, centerX, blendMix);
        float blendedCenterY = mix(previousCenterY, centerY, blendMix);
        float blendedScaling = mix(previousScaling, scaling, blendMix);
        float blendedMystery = mix(previousMystery, mystery, blendMix);
        float blendedSignalTime = mix(previousSignalTime, signalTime, blendMix);
        float blendedSpectrum = mix(previousSpectrum, spectrum, blendMix);
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
        float y = mix(orbitalY, baseY, blendedSpectrum);
        vec2 point = applyMilkdropInteraction(vec2(x, y));
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
function getShaderTextureSourceId(source: string) {
  switch (source) {
    case 'noise':
    case 'perlin':
      return 1;
    case 'simplex':
      return 2;
    case 'voronoi':
      return 3;
    case 'aura':
      return 4;
    case 'caustics':
      return 5;
    case 'pattern':
      return 6;
    case 'fractal':
      return 7;
    default:
      return 0;
  }
}

function getShaderTextureBlendModeId(mode: string) {
  switch (mode) {
    case 'replace':
      return 1;
    case 'mix':
      return 2;
    case 'add':
      return 3;
    case 'multiply':
      return 4;
    default:
      return 0;
  }
}

function getShaderSampleDimensionId(dimension: '2d' | '3d') {
  return dimension === '3d' ? 1 : 0;
}

export function getFeedbackBackendProfile(
  backend: 'webgl' | 'webgpu',
): FeedbackBackendProfile {
  return backend === 'webgpu'
    ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile
    : WEBGL_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
}

function markSharedGeometry<T extends BufferGeometry>(geometry: T) {
  geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  return geometry;
}

function isSharedGeometry(geometry: BufferGeometry) {
  return geometry.userData[SHARED_GEOMETRY_FLAG] === true;
}

function setGeometryBoundingSphere(
  geometry: BufferGeometry,
  center: Vector3,
  radius: number,
) {
  if (!geometry.boundingSphere) {
    geometry.boundingSphere = new Sphere(center.clone(), radius);
    return geometry.boundingSphere;
  }
  geometry.boundingSphere.center.copy(center);
  geometry.boundingSphere.radius = radius;
  return geometry.boundingSphere;
}

function setSharedGeometryBounds(
  geometry: BufferGeometry,
  {
    center = new Vector3(0, 0, 0),
    radius,
  }: {
    center?: Vector3;
    radius: number;
  },
) {
  setGeometryBoundingSphere(geometry, center, radius);
  return geometry;
}

function setGeometryBoundsFromPositions(
  geometry: BufferGeometry,
  positions: number[],
) {
  if (positions.length < 3) {
    return setGeometryBoundingSphere(geometry, new Vector3(0, 0, 0), 0);
  }

  let minX = positions[0] ?? 0;
  let maxX = minX;
  let minY = positions[1] ?? 0;
  let maxY = minY;
  let minZ = positions[2] ?? 0;
  let maxZ = minZ;

  for (let index = 3; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const center = new Vector3(
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  );
  let radiusSq = 0;

  for (let index = 0; index < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - center.x;
    const dy = (positions[index + 1] ?? 0) - center.y;
    const dz = (positions[index + 2] ?? 0) - center.z;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }

  return setGeometryBoundingSphere(geometry, center, Math.sqrt(radiusSq));
}

function markAlwaysOnscreen<
  T extends Group | Mesh | Line | LineSegments | Points,
>(object: T) {
  object.frustumCulled = false;
  return object;
}

function getUnitPolygonVertices(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  return Array.from({ length: safeSides }, (_, index) => {
    const theta =
      (index / safeSides) * Math.PI * 2 + Math.PI / Math.max(3, safeSides);
    return new Vector2(Math.cos(theta), Math.sin(theta));
  });
}

function getUnitPolygonFillGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  const cached = polygonFillGeometryCache.get(safeSides);
  if (cached) {
    return cached;
  }

  const vertices = getUnitPolygonVertices(safeSides);
  const firstVertex = vertices[0] ?? new Vector2(1, 0);
  const fillShape = new Shape();
  fillShape.moveTo(firstVertex.x, firstVertex.y);
  vertices.slice(1).forEach((vertex) => fillShape.lineTo(vertex.x, vertex.y));
  fillShape.lineTo(firstVertex.x, firstVertex.y);

  const geometry = markSharedGeometry(new ShapeGeometry(fillShape));
  setSharedGeometryBounds(geometry, { radius: 1 });
  polygonFillGeometryCache.set(safeSides, geometry);
  return geometry;
}

function getUnitPolygonOutlineGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  const cached = polygonOutlineGeometryCache.get(`open:${safeSides}`);
  if (cached) {
    return cached;
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  const positions = getUnitPolygonVertices(safeSides).flatMap((vertex) => [
    vertex.x,
    vertex.y,
    0,
  ]);
  ensureGeometryPositions(geometry, positions);
  polygonOutlineGeometryCache.set(`open:${safeSides}`, geometry);
  return geometry;
}

function getUnitPolygonClosedLineGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  const cached = polygonOutlineGeometryCache.get(`closed:${safeSides}`);
  if (cached) {
    return cached;
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  const positions = closeLinePositions(
    getUnitPolygonVertices(safeSides).flatMap((vertex) => [
      vertex.x,
      vertex.y,
      0,
    ]),
  );
  ensureGeometryPositions(geometry, positions);
  polygonOutlineGeometryCache.set(`closed:${safeSides}`, geometry);
  return geometry;
}

function getProceduralMeshGeometry(density: number) {
  const safeDensity = Math.max(2, Math.round(density));
  const cached = proceduralMeshGeometryCache.get(safeDensity);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  for (let row = 0; row < safeDensity; row += 1) {
    for (let col = 0; col < safeDensity; col += 1) {
      const x = (col / Math.max(1, safeDensity - 1)) * 2 - 1;
      const y = (row / Math.max(1, safeDensity - 1)) * 2 - 1;

      if (col + 1 < safeDensity) {
        const nextX = ((col + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, nextX, y, -0.25);
      }

      if (row + 1 < safeDensity) {
        const nextY = ((row + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, x, nextY, -0.25);
      }
    }
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'sourcePosition',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  setSharedGeometryBounds(geometry, { radius: PROCEDURAL_MESH_BOUNDS_RADIUS });
  proceduralMeshGeometryCache.set(safeDensity, geometry);
  return geometry;
}

function getProceduralMotionVectorGeometry(countX: number, countY: number) {
  const safeCountX = Math.max(1, Math.round(countX));
  const safeCountY = Math.max(1, Math.round(countY));
  const cacheKey = `${safeCountX}x${safeCountY}`;
  const cached = proceduralMotionVectorGeometryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  const endpointWeights: number[] = [];
  for (let row = 0; row < safeCountY; row += 1) {
    for (let col = 0; col < safeCountX; col += 1) {
      const sourceX = safeCountX === 1 ? 0 : (col / (safeCountX - 1)) * 2 - 1;
      const sourceY = safeCountY === 1 ? 0 : (row / (safeCountY - 1)) * 2 - 1;
      sourcePositions.push(sourceX, sourceY, 0.18, sourceX, sourceY, 0.18);
      endpointWeights.push(0, 1);
    }
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'sourcePosition',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'endpointWeight',
    new Float32BufferAttribute(endpointWeights, 1),
  );
  setSharedGeometryBounds(geometry, {
    radius: PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS,
  });
  proceduralMotionVectorGeometryCache.set(cacheKey, geometry);
  return geometry;
}

function getProceduralWaveGeometry(sampleCount: number) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const cached = proceduralWaveGeometryCache.get(safeCount);
  if (cached) {
    return cached;
  }

  const positions = new Array(safeCount * 3).fill(0);
  const sampleT = Array.from(
    { length: safeCount },
    (_, index) => index / Math.max(1, safeCount - 1),
  );

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sampleT', new Float32BufferAttribute(sampleT, 1));
  setSharedGeometryBounds(geometry, { radius: PROCEDURAL_WAVE_BOUNDS_RADIUS });
  proceduralWaveGeometryCache.set(safeCount, geometry);
  return geometry;
}

function createProceduralWaveObjectGeometry(sampleCount: number) {
  const geometry = getProceduralWaveGeometry(sampleCount).clone();
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_WAVE_BOUNDS_RADIUS,
  );
  return geometry;
}

function closeLinePositions(positions: number[]) {
  if (positions.length < 6) {
    return positions;
  }
  const firstX = positions[0];
  const firstY = positions[1];
  const firstZ = positions[2];
  const lastIndex = positions.length - 3;
  if (
    positions[lastIndex] === firstX &&
    positions[lastIndex + 1] === firstY &&
    positions[lastIndex + 2] === firstZ
  ) {
    return positions;
  }
  return [...positions, firstX, firstY, firstZ];
}

function getWaveLinePositions(
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
) {
  return wave.closed && behavior.closeLinesManually
    ? closeLinePositions(wave.positions)
    : wave.positions;
}

function getBorderLinePositions(
  border: MilkdropBorderVisual,
  z: number,
  behavior: MilkdropBackendBehavior,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const positions = [
    left,
    top,
    z,
    right,
    top,
    z,
    right,
    bottom,
    z,
    left,
    bottom,
    z,
  ];
  return behavior.closeLinesManually
    ? closeLinePositions(positions)
    : positions;
}

function getShapeFillFallbackColor(shape: MilkdropShapeVisual) {
  if (!shape.secondaryColor) {
    return shape.color;
  }
  return {
    r: (shape.color.r + shape.secondaryColor.r) * 0.5,
    g: (shape.color.g + shape.secondaryColor.g) * 0.5,
    b: (shape.color.b + shape.secondaryColor.b) * 0.5,
    a: Math.max(shape.color.a ?? 0.4, shape.secondaryColor.a ?? 0),
  };
}

function syncProceduralFieldUniforms(
  material: ShaderMaterial,
  {
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
    time,
    trebleAtt,
    signals,
    tint,
    alpha,
  }: ProceduralFieldVisualWithSignals & {
    time: number;
    trebleAtt: number;
    tint: { r: number; g: number; b: number };
    alpha: number;
  },
) {
  material.uniforms.zoom.value = zoom;
  material.uniforms.zoomExponent.value = zoomExponent;
  material.uniforms.rotation.value = rotation;
  material.uniforms.warp.value = warp;
  material.uniforms.warpAnimSpeed.value = warpAnimSpeed;
  material.uniforms.centerX.value = centerX;
  material.uniforms.centerY.value = centerY;
  material.uniforms.scaleX.value = scaleX;
  material.uniforms.scaleY.value = scaleY;
  material.uniforms.translateX.value = translateX;
  material.uniforms.translateY.value = translateY;
  material.uniforms.time.value = time;
  material.uniforms.trebleAtt.value = trebleAtt;
  material.uniforms.tint.value.setRGB(tint.r, tint.g, tint.b);
  material.uniforms.alpha.value = alpha;
  material.uniforms.signalTime.value = signals.time;
  material.uniforms.signalFrame.value = signals.frame;
  material.uniforms.signalFps.value = signals.fps;
  material.uniforms.signalBass.value = signals.bass;
  material.uniforms.signalMid.value = signals.mid;
  material.uniforms.signalMids.value = signals.mids;
  material.uniforms.signalTreble.value = signals.treble;
  material.uniforms.signalBassAtt.value = signals.bassAtt;
  material.uniforms.signalMidAtt.value = signals.midAtt;
  material.uniforms.signalMidsAtt.value = signals.midsAtt;
  material.uniforms.signalTrebleAtt.value = signals.trebleAtt;
  material.uniforms.signalBeat.value = signals.beat;
  material.uniforms.signalBeatPulse.value = signals.beatPulse;
  material.uniforms.signalRms.value = signals.rms;
  material.uniforms.signalVol.value = signals.vol;
  material.uniforms.signalMusic.value = signals.music;
  material.uniforms.signalWeightedEnergy.value = signals.weightedEnergy;
}

function syncProceduralInteractionUniforms(
  material: ShaderMaterial,
  transform: MilkdropGpuInteractionTransform | null | undefined,
) {
  material.uniforms.interactionOffsetX.value = transform?.offsetX ?? 0;
  material.uniforms.interactionOffsetY.value = transform?.offsetY ?? 0;
  material.uniforms.interactionRotation.value = transform?.rotation ?? 0;
  material.uniforms.interactionScale.value = transform?.scale ?? 1;
  material.uniforms.interactionAlpha.value = transform?.alphaMultiplier ?? 1;
}

function setOrUpdateScalarAttribute(
  geometry: BufferGeometry,
  name: string,
  values: number[],
) {
  const existing = geometry.getAttribute(name);
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === 1 &&
    existing.array.length === values.length
  ) {
    existing.array.set(values);
    existing.needsUpdate = true;
    return;
  }
  const attribute = new Float32BufferAttribute(values, 1);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
}

function resampleScalarValues(values: number[], targetLength: number) {
  if (values.length === targetLength) {
    return values;
  }
  if (targetLength <= 0) {
    return [];
  }
  if (values.length === 0) {
    return new Array<number>(targetLength).fill(0);
  }
  if (values.length === 1) {
    return new Array<number>(targetLength).fill(values[0] ?? 0);
  }

  const resampled = new Array<number>(targetLength);
  const sourceMaxIndex = values.length - 1;
  const targetMaxIndex = Math.max(1, targetLength - 1);
  for (let index = 0; index < targetLength; index += 1) {
    const position = (index / targetMaxIndex) * sourceMaxIndex;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(sourceMaxIndex, lowerIndex + 1);
    const mix = position - lowerIndex;
    const lowerValue = values[lowerIndex] ?? 0;
    const upperValue = values[upperIndex] ?? lowerValue;
    resampled[index] = lerpNumber(lowerValue, upperValue, mix);
  }
  return resampled;
}

function lerpNumber(previous: number, current: number, mix: number) {
  return previous + (current - previous) * mix;
}

function syncPreviousProceduralFieldUniforms(
  material: ShaderMaterial,
  field: ProceduralFieldVisualWithSignals,
) {
  material.uniforms.previousZoom.value = field.zoom;
  material.uniforms.previousZoomExponent.value = field.zoomExponent;
  material.uniforms.previousRotation.value = field.rotation;
  material.uniforms.previousWarp.value = field.warp;
  material.uniforms.previousWarpAnimSpeed.value = field.warpAnimSpeed;
  material.uniforms.previousCenterX.value = field.centerX;
  material.uniforms.previousCenterY.value = field.centerY;
  material.uniforms.previousScaleX.value = field.scaleX;
  material.uniforms.previousScaleY.value = field.scaleY;
  material.uniforms.previousTranslateX.value = field.translateX;
  material.uniforms.previousTranslateY.value = field.translateY;
  material.uniforms.previousSignalTime.value = field.signals.time;
  material.uniforms.previousSignalFrame.value = field.signals.frame;
  material.uniforms.previousSignalFps.value = field.signals.fps;
  material.uniforms.previousSignalBass.value = field.signals.bass;
  material.uniforms.previousSignalMid.value = field.signals.mid;
  material.uniforms.previousSignalMids.value = field.signals.mids;
  material.uniforms.previousSignalTreble.value = field.signals.treble;
  material.uniforms.previousSignalBassAtt.value = field.signals.bassAtt;
  material.uniforms.previousSignalMidAtt.value = field.signals.midAtt;
  material.uniforms.previousSignalMidsAtt.value = field.signals.midsAtt;
  material.uniforms.previousSignalTrebleAtt.value = field.signals.trebleAtt;
  material.uniforms.previousSignalBeat.value = field.signals.beat;
  material.uniforms.previousSignalBeatPulse.value = field.signals.beatPulse;
  material.uniforms.previousSignalRms.value = field.signals.rms;
  material.uniforms.previousSignalVol.value = field.signals.vol;
  material.uniforms.previousSignalMusic.value = field.signals.music;
  material.uniforms.previousSignalWeightedEnergy.value =
    field.signals.weightedEnergy;
}

function syncProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
  interaction?: MilkdropGpuInteractionTransform | null,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.samples.length),
      createProceduralWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    if ('material' in next) {
      disposeMaterial(next.material);
    }
    next.material = createProceduralWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.samples.length
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.samples.length);
  }

  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', wave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    wave.samples,
  );
  setOrUpdateScalarAttribute(next.geometry, 'sampleVelocity', wave.velocities);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleVelocity',
    wave.velocities,
  );

  const material = next.material as ShaderMaterial;
  material.uniforms.mode.value = wave.mode;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scale.value = wave.scale;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.beatPulse.value = wave.beatPulse;
  material.uniforms.trebleAtt.value = wave.trebleAtt;
  material.uniforms.previousCenterX.value = wave.centerX;
  material.uniforms.previousCenterY.value = wave.centerY;
  material.uniforms.previousScale.value = wave.scale;
  material.uniforms.previousMystery.value = wave.mystery;
  material.uniforms.previousSignalTime.value = wave.time;
  material.uniforms.previousBeatPulse.value = wave.beatPulse;
  material.uniforms.previousTrebleAtt.value = wave.trebleAtt;
  material.uniforms.blendMix.value = 1;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  syncProceduralInteractionUniforms(material, interaction);
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

function syncProceduralCustomWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralCustomWaveVisual,
  interaction?: MilkdropGpuInteractionTransform | null,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.samples.length),
      createProceduralCustomWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    if ('material' in next) {
      disposeMaterial(next.material);
    }
    next.material = createProceduralCustomWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.samples.length
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.samples.length);
  }

  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', wave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    wave.samples,
  );

  const material = next.material as ShaderMaterial;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scaling.value = wave.scaling;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.spectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.previousCenterX.value = wave.centerX;
  material.uniforms.previousCenterY.value = wave.centerY;
  material.uniforms.previousScaling.value = wave.scaling;
  material.uniforms.previousMystery.value = wave.mystery;
  material.uniforms.previousSignalTime.value = wave.time;
  material.uniforms.previousSpectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.blendMix.value = 1;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  syncProceduralInteractionUniforms(material, interaction);
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

function syncInterpolatedProceduralWaveObject(
  object: Line | undefined,
  previousWave: MilkdropProceduralWaveVisual,
  currentWave: MilkdropProceduralWaveVisual,
  mix: number,
  alphaMultiplier: number,
  interaction: MilkdropGpuInteractionTransform | null | undefined,
) {
  const next = syncProceduralWaveObject(object, currentWave, interaction);
  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', currentWave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    resampleScalarValues(previousWave.samples, currentWave.samples.length),
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'sampleVelocity',
    currentWave.velocities,
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleVelocity',
    resampleScalarValues(
      previousWave.velocities,
      currentWave.velocities.length,
    ),
  );
  const material = next.material as ShaderMaterial;
  material.uniforms.previousCenterX.value = previousWave.centerX;
  material.uniforms.previousCenterY.value = previousWave.centerY;
  material.uniforms.previousScale.value = previousWave.scale;
  material.uniforms.previousMystery.value = previousWave.mystery;
  material.uniforms.previousSignalTime.value = previousWave.time;
  material.uniforms.previousBeatPulse.value = previousWave.beatPulse;
  material.uniforms.previousTrebleAtt.value = previousWave.trebleAtt;
  material.uniforms.blendMix.value = mix;
  material.uniforms.tint.value.setRGB(
    lerpNumber(previousWave.color.r, currentWave.color.r, mix),
    lerpNumber(previousWave.color.g, currentWave.color.g, mix),
    lerpNumber(previousWave.color.b, currentWave.color.b, mix),
  );
  material.uniforms.alpha.value =
    lerpNumber(previousWave.alpha, currentWave.alpha, mix) * alphaMultiplier;
  material.blending =
    previousWave.additive || currentWave.additive
      ? AdditiveBlending
      : NormalBlending;
  syncProceduralInteractionUniforms(material, interaction);
  return next;
}

function syncInterpolatedProceduralCustomWaveObject(
  object: Line | undefined,
  previousWave: MilkdropProceduralCustomWaveVisual,
  currentWave: MilkdropProceduralCustomWaveVisual,
  mix: number,
  alphaMultiplier: number,
  interaction: MilkdropGpuInteractionTransform | null | undefined,
) {
  const next = syncProceduralCustomWaveObject(object, currentWave, interaction);
  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', currentWave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    resampleScalarValues(previousWave.samples, currentWave.samples.length),
  );
  const material = next.material as ShaderMaterial;
  material.uniforms.previousCenterX.value = previousWave.centerX;
  material.uniforms.previousCenterY.value = previousWave.centerY;
  material.uniforms.previousScaling.value = previousWave.scaling;
  material.uniforms.previousMystery.value = previousWave.mystery;
  material.uniforms.previousSignalTime.value = previousWave.time;
  material.uniforms.previousSpectrum.value = previousWave.spectrum ? 1 : 0;
  material.uniforms.blendMix.value = mix;
  material.uniforms.tint.value.setRGB(
    lerpNumber(previousWave.color.r, currentWave.color.r, mix),
    lerpNumber(previousWave.color.g, currentWave.color.g, mix),
    lerpNumber(previousWave.color.b, currentWave.color.b, mix),
  );
  material.uniforms.alpha.value =
    lerpNumber(previousWave.alpha, currentWave.alpha, mix) * alphaMultiplier;
  material.blending =
    previousWave.additive || currentWave.additive
      ? AdditiveBlending
      : NormalBlending;
  syncProceduralInteractionUniforms(material, interaction);
  return next;
}

function lerpColor(
  previousColor: MilkdropColor,
  currentColor: MilkdropColor,
  mix: number,
): MilkdropColor {
  return {
    r: lerpNumber(previousColor.r, currentColor.r, mix),
    g: lerpNumber(previousColor.g, currentColor.g, mix),
    b: lerpNumber(previousColor.b, currentColor.b, mix),
    ...(previousColor.a !== undefined || currentColor.a !== undefined
      ? {
          a: lerpNumber(previousColor.a ?? 0, currentColor.a ?? 0, mix),
        }
      : {}),
  };
}

function interpolateShapeVisual(
  previousShape: MilkdropShapeVisual,
  currentShape: MilkdropShapeVisual,
  mix: number,
): MilkdropShapeVisual {
  return {
    ...currentShape,
    x: lerpNumber(previousShape.x, currentShape.x, mix),
    y: lerpNumber(previousShape.y, currentShape.y, mix),
    radius: lerpNumber(previousShape.radius, currentShape.radius, mix),
    rotation: lerpNumber(previousShape.rotation, currentShape.rotation, mix),
    color: lerpColor(previousShape.color, currentShape.color, mix),
    secondaryColor:
      previousShape.secondaryColor || currentShape.secondaryColor
        ? lerpColor(
            previousShape.secondaryColor ?? previousShape.color,
            currentShape.secondaryColor ?? currentShape.color,
            mix,
          )
        : null,
    borderColor: lerpColor(
      previousShape.borderColor,
      currentShape.borderColor,
      mix,
    ),
    additive: previousShape.additive || currentShape.additive,
    thickOutline: previousShape.thickOutline || currentShape.thickOutline,
  };
}

function isFeedbackCapableRenderer(
  renderer: RendererLike | null,
): renderer is RendererLike & {
  getSize: (target: Vector2) => Vector2;
  setRenderTarget: RendererSetRenderTarget;
} {
  return !!renderer && !!renderer.getSize && !!renderer.setRenderTarget;
}

function setMaterialColor(
  material: LineBasicMaterial | MeshBasicMaterial | PointsMaterial,
  value: { r: number; g: number; b: number },
  opacity: number,
) {
  material.color.setRGB(value.r, value.g, value.b);
  material.opacity = opacity;
  material.transparent = opacity < 1 || material.blending === AdditiveBlending;
}

function ensureGeometryPositions(
  geometry: BufferGeometry,
  positions: number[],
) {
  const existing = geometry.getAttribute('position');
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === 3 &&
    existing.array.length === positions.length
  ) {
    existing.array.set(positions);
    existing.needsUpdate = true;
  } else {
    const attribute = new Float32BufferAttribute(positions, 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
  }
  setGeometryBoundsFromPositions(geometry, positions);
}

function clearGroup(group: Group) {
  for (let index = group.children.length - 1; index >= 0; index -= 1) {
    const child = group.children[index];
    disposeObject(child);
    group.remove(child);
  }
}

function disposeObject(object: { children?: unknown[] }) {
  if (
    'children' in object &&
    Array.isArray(object.children) &&
    object.children.length
  ) {
    object.children.forEach((child) =>
      disposeObject(child as { children?: unknown[] }),
    );
  }
  if ('geometry' in object) {
    const geometry = (object as Line | Mesh | Points).geometry;
    if (!isSharedGeometry(geometry)) {
      disposeGeometry(geometry);
    }
  }
  if ('material' in object) {
    disposeMaterial((object as Line | Mesh | Points).material);
  }
}

function trimGroupChildren(group: Group, keepCount: number) {
  for (let index = group.children.length - 1; index >= keepCount; index -= 1) {
    const child = group.children[index];
    disposeObject(child as { children?: unknown[] });
    group.remove(child);
  }
}

function createWaveObject(
  wave: MilkdropWaveVisual | null,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  if (!wave || wave.positions.length === 0) {
    return null;
  }

  if (wave.drawMode === 'dots') {
    const object = new Points(
      new BufferGeometry(),
      new PointsMaterial({
        size: wave.pointSize,
        transparent: true,
        opacity: wave.alpha * alphaMultiplier,
        ...(wave.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    ensureGeometryPositions(object.geometry, wave.positions);
    setMaterialColor(object.material, wave.color, wave.alpha * alphaMultiplier);
    object.position.z = 0.24;
    return object;
  }

  const ObjectType =
    wave.closed && behavior.useLineLoopPrimitives ? LineLoop : Line;
  const object = new ObjectType(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: wave.alpha * alphaMultiplier,
      ...(wave.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  ensureGeometryPositions(
    object.geometry,
    getWaveLinePositions(wave, behavior),
  );
  setMaterialColor(object.material, wave.color, wave.alpha * alphaMultiplier);
  object.position.z = 0.24;
  return object;
}

function createShapeObject(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  const group = new Group();
  const fillMaterial =
    shape.secondaryColor && behavior.supportsShapeGradient
      ? new ShaderMaterial({
          uniforms: {
            primaryColor: {
              value: new Color(shape.color.r, shape.color.g, shape.color.b),
            },
            secondaryColor: {
              value: new Color(
                shape.secondaryColor.r,
                shape.secondaryColor.g,
                shape.secondaryColor.b,
              ),
            },
            primaryAlpha: {
              value: (shape.color.a ?? 0.4) * alphaMultiplier,
            },
            secondaryAlpha: {
              value: (shape.secondaryColor.a ?? 0) * alphaMultiplier,
            },
          },
          transparent: true,
          side: DoubleSide,
          ...(shape.additive ? { blending: AdditiveBlending } : {}),
          vertexShader: `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
          fragmentShader: `
          uniform vec3 primaryColor;
          uniform vec3 secondaryColor;
          uniform float primaryAlpha;
          uniform float secondaryAlpha;
          varying vec2 vLocal;

          void main() {
            float blend = clamp(length(vLocal), 0.0, 1.0);
            vec3 color = mix(primaryColor, secondaryColor, blend);
            float alpha = mix(primaryAlpha, secondaryAlpha, blend);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        })
      : new MeshBasicMaterial({
          color: new Color(
            getShapeFillFallbackColor(shape).r,
            getShapeFillFallbackColor(shape).g,
            getShapeFillFallbackColor(shape).b,
          ),
          opacity:
            (getShapeFillFallbackColor(shape).a ?? 0.4) * alphaMultiplier,
          transparent: true,
          side: DoubleSide,
          ...(shape.additive ? { blending: AdditiveBlending } : {}),
        });

  const fill = new Mesh(getUnitPolygonFillGeometry(shape.sides), fillMaterial);
  fill.position.set(shape.x, shape.y, 0.14);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  group.add(fill);

  if (shape.thickOutline) {
    const accentBorder = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
      behavior.useLineLoopPrimitives
        ? getUnitPolygonOutlineGeometry(shape.sides)
        : getUnitPolygonClosedLineGeometry(shape.sides),
      new LineBasicMaterial({
        color: new Color(
          shape.borderColor.r,
          shape.borderColor.g,
          shape.borderColor.b,
        ),
        opacity:
          Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45) * alphaMultiplier,
        transparent: true,
        ...(shape.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    accentBorder.position.set(shape.x, shape.y, 0.15);
    accentBorder.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accentBorder.rotation.z = shape.rotation;
    group.add(accentBorder);
  }

  const border = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    behavior.useLineLoopPrimitives
      ? getUnitPolygonOutlineGeometry(shape.sides)
      : getUnitPolygonClosedLineGeometry(shape.sides),
    new LineBasicMaterial({
      color: new Color(
        shape.borderColor.r,
        shape.borderColor.g,
        shape.borderColor.b,
      ),
      opacity: (shape.borderColor.a ?? 1) * alphaMultiplier,
      transparent: true,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  border.position.set(shape.x, shape.y, 0.16);
  border.scale.set(shape.radius, shape.radius, 1);
  border.rotation.z = shape.rotation;
  group.add(border);

  return group;
}

function syncShapeFillMaterial(
  mesh: Mesh,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsGradient =
    Boolean(shape.secondaryColor) && behavior.supportsShapeGradient;
  const existingMaterial = mesh.material;

  if (wantsGradient) {
    if (!(existingMaterial instanceof ShaderMaterial)) {
      disposeMaterial(existingMaterial);
      mesh.material = new ShaderMaterial({
        uniforms: {
          primaryColor: {
            value: new Color(shape.color.r, shape.color.g, shape.color.b),
          },
          secondaryColor: {
            value: new Color(
              shape.secondaryColor?.r ?? 0,
              shape.secondaryColor?.g ?? 0,
              shape.secondaryColor?.b ?? 0,
            ),
          },
          primaryAlpha: {
            value: (shape.color.a ?? 0.4) * alphaMultiplier,
          },
          secondaryAlpha: {
            value: (shape.secondaryColor?.a ?? 0) * alphaMultiplier,
          },
        },
        transparent: true,
        side: DoubleSide,
        ...(shape.additive ? { blending: AdditiveBlending } : {}),
        vertexShader: `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 primaryColor;
          uniform vec3 secondaryColor;
          uniform float primaryAlpha;
          uniform float secondaryAlpha;
          varying vec2 vLocal;

          void main() {
            float blend = clamp(length(vLocal), 0.0, 1.0);
            vec3 color = mix(primaryColor, secondaryColor, blend);
            float alpha = mix(primaryAlpha, secondaryAlpha, blend);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      });
    }

    const material = mesh.material as ShaderMaterial;
    material.uniforms.primaryColor.value.setRGB(
      shape.color.r,
      shape.color.g,
      shape.color.b,
    );
    material.uniforms.secondaryColor.value.setRGB(
      shape.secondaryColor?.r ?? 0,
      shape.secondaryColor?.g ?? 0,
      shape.secondaryColor?.b ?? 0,
    );
    material.uniforms.primaryAlpha.value =
      (shape.color.a ?? 0.4) * alphaMultiplier;
    material.uniforms.secondaryAlpha.value =
      (shape.secondaryColor?.a ?? 0) * alphaMultiplier;
    material.blending = shape.additive ? AdditiveBlending : NormalBlending;
    return;
  }

  if (!(existingMaterial instanceof MeshBasicMaterial)) {
    disposeMaterial(existingMaterial);
    const fillColor = getShapeFillFallbackColor(shape);
    mesh.material = new MeshBasicMaterial({
      color: new Color(fillColor.r, fillColor.g, fillColor.b),
      opacity: (fillColor.a ?? 0.4) * alphaMultiplier,
      transparent: true,
      side: DoubleSide,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    });
  }

  const material = mesh.material as MeshBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  const fillColor = getShapeFillFallbackColor(shape);
  setMaterialColor(material, fillColor, (fillColor.a ?? 0.4) * alphaMultiplier);
}

function syncShapeOutline(
  object: Line | LineLoop,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
  opacity: number,
) {
  const nextGeometry = behavior.useLineLoopPrimitives
    ? getUnitPolygonOutlineGeometry(shape.sides)
    : getUnitPolygonClosedLineGeometry(shape.sides);
  if (object.geometry !== nextGeometry) {
    object.geometry = nextGeometry;
  }
  object.position.set(shape.x, shape.y, 0.16);
  object.scale.set(shape.radius, shape.radius, 1);
  object.rotation.z = shape.rotation;
  const material = object.material as LineBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  setMaterialColor(material, shape.borderColor, opacity * alphaMultiplier);
}

function syncShapeObject(
  existing: Group | undefined,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsAccent = shape.thickOutline;
  const fillZ = 0.14;
  const accentZ = 0.15;
  const borderZ = 0.16;

  if (!(existing instanceof Group)) {
    if (existing) {
      disposeObject(existing);
    }
    return createShapeObject(shape, behavior, alphaMultiplier);
  }

  const fill = existing.children[0];
  const accent = existing.children[1];
  const border = existing.children[wantsAccent ? 2 : 1];
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedBorder = expectsLoop
    ? border instanceof LineLoop
    : border instanceof Line;
  const hasSupportedAccent = expectsLoop
    ? accent instanceof LineLoop
    : accent instanceof Line;

  if (
    !(fill instanceof Mesh) ||
    !hasSupportedBorder ||
    (wantsAccent && !hasSupportedAccent)
  ) {
    disposeObject(existing);
    return createShapeObject(shape, behavior, alphaMultiplier);
  }

  if (fill.geometry !== getUnitPolygonFillGeometry(shape.sides)) {
    fill.geometry = getUnitPolygonFillGeometry(shape.sides);
  }
  fill.position.set(shape.x, shape.y, fillZ);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  syncShapeFillMaterial(fill, shape, behavior, alphaMultiplier);

  if (wantsAccent && (accent instanceof LineLoop || accent instanceof Line)) {
    syncShapeOutline(
      accent,
      shape,
      behavior,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    accent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accent.position.z = accentZ;
  }

  syncShapeOutline(
    border as Line | LineLoop,
    shape,
    behavior,
    alphaMultiplier,
    shape.borderColor.a ?? 1,
  );
  border.position.z = borderZ;

  if (!wantsAccent && accent) {
    disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  } else if (
    wantsAccent &&
    !(accent instanceof LineLoop) &&
    !(accent instanceof Line)
  ) {
    const nextAccent = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
      behavior.useLineLoopPrimitives
        ? getUnitPolygonOutlineGeometry(shape.sides)
        : getUnitPolygonClosedLineGeometry(shape.sides),
      new LineBasicMaterial({
        transparent: true,
      }),
    );
    existing.add(nextAccent);
    syncShapeOutline(
      nextAccent,
      shape,
      behavior,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    nextAccent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    nextAccent.position.z = accentZ;
  }

  return existing;
}

function createBorderObject(
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const group = markAlwaysOnscreen(new Group());
  const fillShape = new Shape();
  fillShape.moveTo(-1, 1);
  fillShape.lineTo(1, 1);
  fillShape.lineTo(1, -1);
  fillShape.lineTo(-1, -1);
  fillShape.lineTo(-1, 1);
  const hole = new Path();
  hole.moveTo(left, top);
  hole.lineTo(left, bottom);
  hole.lineTo(right, bottom);
  hole.lineTo(right, top);
  hole.lineTo(left, top);
  fillShape.holes.push(hole);

  const fill = markAlwaysOnscreen(
    new Mesh(
      new ShapeGeometry(fillShape),
      new MeshBasicMaterial({
        transparent: true,
        opacity: Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
        side: DoubleSide,
      }),
    ),
  );
  setMaterialColor(
    fill.material,
    border.color,
    Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
  );
  fill.position.z = 0.285;
  group.add(fill);

  const outline = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
    }),
  );
  outline.frustumCulled = false;
  ensureGeometryPositions(
    outline.geometry,
    getBorderLinePositions(border, 0.3, behavior),
  );
  setMaterialColor(
    outline.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  outline.position.z = 0.3;
  group.add(outline);

  if (!border.styled) {
    return group;
  }

  const accent = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: Math.max(0.15, border.alpha * 0.55) * alphaMultiplier,
    }),
  );
  accent.frustumCulled = false;
  ensureGeometryPositions(
    accent.geometry,
    getBorderLinePositions(border, 0.3, behavior),
  );
  setMaterialColor(
    accent.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  accent.scale.set(
    border.key === 'outer' ? 0.985 : 1.015,
    border.key === 'outer' ? 0.985 : 1.015,
    1,
  );
  accent.position.z = 0.31;
  group.add(accent);
  return group;
}

function updateWaveObject(
  object: Line | LineLoop | Points,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  ensureGeometryPositions(
    object.geometry,
    getWaveLinePositions(wave, behavior),
  );
  if (object instanceof Points) {
    const material = object.material as PointsMaterial;
    material.size = wave.pointSize;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    setMaterialColor(material, wave.color, wave.alpha * alphaMultiplier);
  } else {
    const material = object.material as LineBasicMaterial;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    setMaterialColor(material, wave.color, wave.alpha * alphaMultiplier);
  }
  object.position.z = 0.24;
}

function syncWaveObject(
  existing: Line | LineLoop | Points | undefined,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsPoints = wave.drawMode === 'dots';
  const wantsLoop =
    wave.closed && !wantsPoints && behavior.useLineLoopPrimitives;
  const matches =
    !!existing &&
    ((wantsPoints && existing instanceof Points) ||
      (wantsLoop && existing instanceof LineLoop) ||
      (!wantsPoints && !wantsLoop && existing instanceof Line));

  if (!matches) {
    if (existing) {
      disposeObject(existing);
    }
    const created = createWaveObject(wave, behavior, alphaMultiplier);
    return created;
  }

  updateWaveObject(existing, wave, behavior, alphaMultiplier);
  return existing;
}

function createLineObject(
  positions: number[],
  color: MilkdropColor,
  alpha: number,
  additive: boolean,
) {
  const object = markAlwaysOnscreen(
    new Line(
      new BufferGeometry(),
      new LineBasicMaterial({
        transparent: true,
        opacity: alpha,
        ...(additive ? { blending: AdditiveBlending } : {}),
      }),
    ),
  );
  ensureGeometryPositions(object.geometry, positions);
  setMaterialColor(object.material, color, alpha);
  object.position.z = 0.24;
  return object;
}

function syncLineObject(
  existing: Line | undefined,
  {
    positions,
    color,
    alpha,
    additive,
  }: {
    positions: number[];
    color: MilkdropColor;
    alpha: number;
    additive: boolean;
  },
  alphaMultiplier: number,
) {
  if (!(existing instanceof Line) || existing instanceof LineLoop) {
    if (existing) {
      disposeObject(existing);
    }
    return createLineObject(
      positions,
      color,
      alpha * alphaMultiplier,
      additive,
    );
  }

  ensureGeometryPositions(existing.geometry, positions);
  const material = existing.material as LineBasicMaterial;
  material.blending = additive ? AdditiveBlending : NormalBlending;
  setMaterialColor(material, color, alpha * alphaMultiplier);
  existing.position.z = 0.24;
  return existing;
}

function updateBorderLine(
  object: Line | LineLoop,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    ensureGeometryPositions(
      object.geometry,
      getBorderLinePositions(border, 0.3, behavior),
    );
    object.userData.borderInset = inset;
  }
  setMaterialColor(
    object.material as LineBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
}

function updateBorderFill(
  object: Mesh,
  border: MilkdropBorderVisual,
  alphaMultiplier: number,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    const left = -1 + inset * 2;
    const right = 1 - inset * 2;
    const top = 1 - inset * 2;
    const bottom = -1 + inset * 2;
    const fillShape = new Shape();
    fillShape.moveTo(-1, 1);
    fillShape.lineTo(1, 1);
    fillShape.lineTo(1, -1);
    fillShape.lineTo(-1, -1);
    fillShape.lineTo(-1, 1);
    const hole = new Path();
    hole.moveTo(left, top);
    hole.lineTo(left, bottom);
    hole.lineTo(right, bottom);
    hole.lineTo(right, top);
    hole.lineTo(left, top);
    fillShape.holes.push(hole);

    if (!isSharedGeometry(object.geometry)) {
      disposeGeometry(object.geometry);
    }
    object.geometry = new ShapeGeometry(fillShape);
    object.userData.borderInset = inset;
  }
  setMaterialColor(
    object.material as MeshBasicMaterial,
    border.color,
    Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
  );
  object.position.z = 0.285;
}

function syncBorderObject(
  existing: Group | undefined,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  if (!(existing instanceof Group)) {
    if (existing) {
      disposeObject(existing);
    }
    return createBorderObject(border, behavior, alphaMultiplier);
  }

  const fill = existing.children[0];
  const outline = existing.children[1];
  const accent = existing.children[2];
  const wantsAccent = border.styled;
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedOutline = expectsLoop
    ? outline instanceof LineLoop
    : outline instanceof Line;
  const hasSupportedAccent = expectsLoop
    ? accent instanceof LineLoop
    : accent instanceof Line;
  if (
    !(fill instanceof Mesh) ||
    !hasSupportedOutline ||
    (wantsAccent && !hasSupportedAccent)
  ) {
    disposeObject(existing);
    return createBorderObject(border, behavior, alphaMultiplier);
  }

  updateBorderFill(fill, border, alphaMultiplier);
  updateBorderLine(
    outline as Line | LineLoop,
    border,
    behavior,
    alphaMultiplier,
  );
  outline.position.z = 0.3;
  if (wantsAccent && (accent instanceof LineLoop || accent instanceof Line)) {
    updateBorderLine(accent, border, behavior, alphaMultiplier);
    accent.scale.set(
      border.key === 'outer' ? 0.985 : 1.015,
      border.key === 'outer' ? 0.985 : 1.015,
      1,
    );
    accent.position.z = 0.31;
    (accent.material as LineBasicMaterial).opacity =
      Math.max(0.15, border.alpha * 0.55) * alphaMultiplier;
  }
  if (!wantsAccent && accent) {
    disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  }
  return existing;
}

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  private readonly behavior: MilkdropBackendBehavior;
  private readonly createFeedbackManager: MilkdropFeedbackManagerFactory | null;
  private readonly batcher: MilkdropRendererBatcher | null;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly renderer: RendererLike | null;
  private readonly root = new Group();
  private readonly background = markAlwaysOnscreen(
    new Mesh(
      BACKGROUND_GEOMETRY,
      new MeshBasicMaterial({
        color: 0x000000,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        depthTest: false,
      }),
    ),
  );
  private readonly meshLines: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0x4d66f2,
        transparent: true,
        opacity: 0.24,
      }),
    ),
  );
  private readonly mainWaveGroup = new Group();
  private readonly customWaveGroup = new Group();
  private readonly trailGroup = new Group();
  private readonly shapesGroup = new Group();
  private readonly borderGroup = markAlwaysOnscreen(new Group());
  private readonly motionVectorGroup = markAlwaysOnscreen(new Group());
  private readonly motionVectorCpuGroup = markAlwaysOnscreen(new Group());
  private readonly proceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    ),
  );
  private readonly blendWaveGroup = new Group();
  private readonly blendCustomWaveGroup = new Group();
  private readonly blendShapeGroup = new Group();
  private readonly blendBorderGroup = markAlwaysOnscreen(new Group());
  private readonly blendMotionVectorGroup = markAlwaysOnscreen(new Group());
  private readonly blendMotionVectorCpuGroup = markAlwaysOnscreen(new Group());
  private readonly blendProceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    ),
  );
  private readonly feedback: MilkdropFeedbackManager | null;
  private webgpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null = null;

  constructor({
    scene,
    camera,
    renderer,
    backend,
    behavior,
    createFeedbackManager,
    batcher,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
    behavior: MilkdropBackendBehavior;
    createFeedbackManager: MilkdropFeedbackManagerFactory | null;
    batcher: MilkdropRendererBatcher | null;
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;
    this.behavior = behavior;
    this.createFeedbackManager = createFeedbackManager;
    this.batcher = batcher;
    this.root.frustumCulled = false;

    this.background.position.z = -1.2;
    this.meshLines.position.z = -0.3;
    this.root.add(this.background);
    this.root.add(this.meshLines);
    this.root.add(this.mainWaveGroup);
    this.root.add(this.customWaveGroup);
    this.root.add(this.trailGroup);
    this.root.add(this.shapesGroup);
    this.root.add(this.borderGroup);
    this.motionVectorGroup.add(this.motionVectorCpuGroup);
    this.proceduralMotionVectors.visible = false;
    this.motionVectorGroup.add(this.proceduralMotionVectors);
    this.root.add(this.motionVectorGroup);
    this.root.add(this.blendWaveGroup);
    this.root.add(this.blendCustomWaveGroup);
    this.root.add(this.blendShapeGroup);
    this.root.add(this.blendBorderGroup);
    this.blendMotionVectorGroup.add(this.blendMotionVectorCpuGroup);
    this.blendProceduralMotionVectors.visible = false;
    this.blendMotionVectorGroup.add(this.blendProceduralMotionVectors);
    this.root.add(this.blendMotionVectorGroup);
    this.batcher?.attach(this.root);

    if (
      this.behavior.supportsFeedbackPass &&
      isFeedbackCapableRenderer(renderer) &&
      this.createFeedbackManager
    ) {
      const size = renderer.getSize(new Vector2());
      this.feedback = this.createFeedbackManager(
        Math.max(1, Math.round(size.x)),
        Math.max(1, Math.round(size.y)),
      );
    } else {
      this.feedback = null;
    }
  }

  attach() {
    if (!this.scene.children.includes(this.root)) {
      this.scene.add(this.root);
    }
  }

  setPreset(preset: MilkdropCompiledPreset) {
    this.webgpuDescriptorPlan =
      this.backend === 'webgpu'
        ? preset.ir.compatibility.gpuDescriptorPlans.webgpu
        : null;
  }

  assessSupport(preset: MilkdropCompiledPreset) {
    return preset.ir.compatibility.backends[this.backend];
  }

  resize(width: number, height: number) {
    this.feedback?.resize(width, height);
  }

  private renderWaveGroup(
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier = 1,
  ) {
    if (
      this.batcher?.renderWaveGroup?.(target, group, waves, alphaMultiplier)
    ) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropWaveVisual;
      const existing = group.children[index] as
        | Line
        | LineLoop
        | Points
        | undefined;
      const synced = syncWaveObject(
        existing,
        wave,
        this.behavior,
        alphaMultiplier,
      );
      if (!synced) {
        return;
      }
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderProceduralWaveGroup(
    target: 'main-wave' | 'trail-waves',
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralWaveGroup?.(target, group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralWaveObject(existing, wave, interaction);
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderProceduralCustomWaveGroup(
    group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralCustomWaveGroup?.(group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralCustomWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralCustomWaveObject(
        existing,
        wave,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralWaveVisual;
      current: MilkdropProceduralWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralWaveVisual;
        current: MilkdropProceduralWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralCustomWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralCustomWaveVisual;
      current: MilkdropProceduralCustomWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralCustomWaveVisual;
        current: MilkdropProceduralCustomWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralCustomWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderShapeGroup(
    target: 'shapes' | 'blend-shapes',
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    if (
      this.batcher?.renderShapeGroup?.(target, group, shapes, alphaMultiplier)
    ) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < shapes.length; index += 1) {
      const shape = shapes[index] as MilkdropShapeVisual;
      const existing = group.children[index] as Group | undefined;
      const synced = syncShapeObject(
        existing,
        shape,
        this.behavior,
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, shapes.length);
  }

  private renderBorderGroup(
    target: 'borders' | 'blend-borders',
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    if (
      this.batcher?.renderBorderGroup?.(target, group, borders, alphaMultiplier)
    ) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < borders.length; index += 1) {
      const border = borders[index] as MilkdropBorderVisual;
      const existing = group.children[index] as Group | undefined;
      const synced = syncBorderObject(
        existing,
        border,
        this.behavior,
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, borders.length);
  }

  private renderInterpolatedShapeGroup(
    group: Group,
    previousShapes: MilkdropShapeVisual[],
    currentShapes: MilkdropShapeVisual[],
    mix: number,
    alphaMultiplier = 1,
  ) {
    const interpolatedShapes = currentShapes.map((shape, index) => {
      const previousShape = previousShapes[index];
      return previousShape
        ? interpolateShapeVisual(previousShape, shape, mix)
        : shape;
    });
    this.renderShapeGroup(
      'blend-shapes',
      group,
      interpolatedShapes,
      alphaMultiplier,
    );
  }

  private renderLineVisualGroup(
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier = 1,
  ) {
    if (
      this.batcher?.renderLineVisualGroup?.(
        target,
        group,
        lines,
        alphaMultiplier,
      )
    ) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as {
        positions: number[];
        color: MilkdropColor;
        alpha: number;
        additive?: boolean;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncLineObject(
        existing,
        {
          positions: line.positions,
          color: line.color,
          alpha: line.alpha,
          additive: line.additive ?? false,
        },
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, lines.length);
  }

  private renderMesh(
    mesh: MilkdropRenderPayload['frameState']['mesh'],
    gpuGeometry: MilkdropGpuGeometryHints,
    signals: MilkdropRenderPayload['frameState']['signals'],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    const proceduralMesh =
      this.backend === 'webgpu' &&
      this.webgpuDescriptorPlan?.proceduralMesh !== null
        ? gpuGeometry.meshField
        : null;
    if (proceduralMesh) {
      const fieldProgramSignature =
        proceduralMesh.program?.signature ?? 'default';
      if (
        !(this.meshLines.material instanceof ShaderMaterial) ||
        this.meshLines.material.userData.fieldProgramSignature !==
          fieldProgramSignature
      ) {
        disposeMaterial(this.meshLines.material);
        this.meshLines.material = createProceduralMeshMaterial(
          proceduralMesh.program,
        );
      }
      this.meshLines.geometry = getProceduralMeshGeometry(
        proceduralMesh.density,
      );
      syncProceduralFieldUniforms(this.meshLines.material as ShaderMaterial, {
        ...proceduralMesh,
        time: signals.time,
        trebleAtt: signals.trebleAtt,
        tint: mesh.color,
        alpha: mesh.alpha,
      });
      syncProceduralInteractionUniforms(
        this.meshLines.material as ShaderMaterial,
        interaction,
      );
      this.meshLines.visible = mesh.alpha > 0.001;
      return;
    }

    if (!(this.meshLines.material instanceof LineBasicMaterial)) {
      disposeMaterial(this.meshLines.material);
      this.meshLines.material = new LineBasicMaterial({
        color: 0x4d66f2,
        transparent: true,
        opacity: 0.24,
      });
    }

    const meshMaterial = this.meshLines.material as LineBasicMaterial;
    ensureGeometryPositions(this.meshLines.geometry, mesh.positions);
    setMaterialColor(meshMaterial, mesh.color, mesh.alpha);
    this.meshLines.visible = mesh.positions.length > 0;
  }

  private renderMotionVectors(
    payload: MilkdropRenderPayload['frameState'],
    alphaMultiplier = 1,
    previousFrame?: MilkdropRenderPayload['frameState'] | null,
    blendMix = 1,
    cpuGroup: Group = this.motionVectorCpuGroup,
    proceduralObject: LineSegments<
      BufferGeometry,
      LineBasicMaterial | ShaderMaterial
    > = this.proceduralMotionVectors,
  ) {
    const proceduralField =
      this.backend === 'webgpu' &&
      this.webgpuDescriptorPlan?.proceduralMesh?.supportsMotionVectors
        ? payload.gpuGeometry.motionVectorField
        : null;
    if (proceduralField) {
      clearGroup(cpuGroup);
      proceduralObject.visible = true;
      const fieldProgramSignature =
        proceduralField.program?.signature ?? 'default';
      if (
        !(proceduralObject.material instanceof ShaderMaterial) ||
        proceduralObject.material.userData.fieldProgramSignature !==
          fieldProgramSignature
      ) {
        disposeMaterial(proceduralObject.material);
        proceduralObject.material = createProceduralMotionVectorMaterial(
          proceduralField.program,
        );
      }
      proceduralObject.geometry = getProceduralMotionVectorGeometry(
        proceduralField.countX,
        proceduralField.countY,
      );
      syncProceduralFieldUniforms(proceduralObject.material as ShaderMaterial, {
        ...proceduralField,
        time: payload.signals.time,
        trebleAtt: payload.signals.trebleAtt,
        tint: {
          r: Math.min(Math.max(payload.variables.mv_r ?? 1, 0), 1),
          g: Math.min(Math.max(payload.variables.mv_g ?? 1, 0), 1),
          b: Math.min(Math.max(payload.variables.mv_b ?? 1, 0), 1),
        },
        alpha:
          Math.min(
            Math.max(
              payload.variables.mv_a ?? 0.35,
              proceduralField.legacyControls ? 0 : 0.02,
            ),
            1,
          ) * alphaMultiplier,
      });
      const proceduralMaterial = proceduralObject.material as ShaderMaterial;
      syncProceduralInteractionUniforms(
        proceduralMaterial,
        payload.interaction?.motionVectors,
      );
      proceduralMaterial.uniforms.sourceOffsetX.value =
        proceduralField.sourceOffsetX;
      proceduralMaterial.uniforms.sourceOffsetY.value =
        proceduralField.sourceOffsetY;
      proceduralMaterial.uniforms.explicitLength.value =
        proceduralField.explicitLength;
      proceduralMaterial.uniforms.legacyControls.value =
        proceduralField.legacyControls ? 1 : 0;
      const previousField =
        previousFrame?.gpuGeometry.motionVectorField ?? proceduralField;
      syncPreviousProceduralFieldUniforms(proceduralMaterial, previousField);
      proceduralMaterial.uniforms.previousSourceOffsetX.value =
        previousField.sourceOffsetX;
      proceduralMaterial.uniforms.previousSourceOffsetY.value =
        previousField.sourceOffsetY;
      proceduralMaterial.uniforms.previousExplicitLength.value =
        previousField.explicitLength;
      proceduralMaterial.uniforms.blendMix.value = blendMix;
      return;
    }

    proceduralObject.visible = false;
    this.renderLineVisualGroup(
      'motion-vectors',
      this.motionVectorCpuGroup,
      payload.motionVectors,
      alphaMultiplier,
    );
  }

  private buildFeedbackCompositeState(
    frameState: MilkdropRenderPayload['frameState'],
  ): MilkdropFeedbackCompositeState {
    const controls = frameState.post.shaderControls;
    const shaderPrograms = {
      warp: frameState.post.shaderPrograms.warp?.execution.supportedBackends.includes(
        this.backend,
      )
        ? frameState.post.shaderPrograms.warp
        : null,
      comp: frameState.post.shaderPrograms.comp?.execution.supportedBackends.includes(
        this.backend,
      )
        ? frameState.post.shaderPrograms.comp
        : null,
    };
    const plannedShaderExecution =
      this.backend === 'webgpu'
        ? this.webgpuDescriptorPlan?.feedback?.shaderExecution
        : null;
    const usesDirectShaderPrograms =
      plannedShaderExecution === 'direct'
        ? true
        : plannedShaderExecution === 'controls'
          ? false
          : shaderPrograms.warp !== null || shaderPrograms.comp !== null;
    return {
      shaderExecution: usesDirectShaderPrograms ? 'direct' : 'controls',
      shaderPrograms,
      mixAlpha: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoAlpha + controls.mixAlpha
        : controls.mixAlpha,
      zoom: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoZoom + controls.warpScale * 0.04
        : 1,
      videoEchoOrientation: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoOrientation
        : 0,
      brighten: frameState.post.brighten ? 1 : 0,
      darken: frameState.post.darken ? 1 : 0,
      darkenCenter: frameState.post.darkenCenter ? 1 : 0,
      solarize: frameState.post.solarize ? 1 : 0,
      invert: frameState.post.invert ? 1 : 0,
      gammaAdj: frameState.post.gammaAdj,
      textureWrap: frameState.post.textureWrap ? 1 : 0,
      feedbackTexture: frameState.post.feedbackTexture ? 1 : 0,
      warpScale: controls.warpScale,
      offsetX: controls.offsetX,
      offsetY: controls.offsetY,
      rotation: controls.rotation,
      zoomMul: controls.zoom,
      saturation: controls.saturation,
      contrast: controls.contrast,
      colorScale: {
        r: controls.colorScale.r,
        g: controls.colorScale.g,
        b: controls.colorScale.b,
      },
      hueShift: controls.hueShift,
      brightenBoost: controls.brightenBoost,
      invertBoost: controls.invertBoost,
      solarizeBoost: controls.solarizeBoost,
      tint: {
        r: controls.tint.r,
        g: controls.tint.g,
        b: controls.tint.b,
      },
      overlayTextureSource: getShaderTextureSourceId(
        controls.textureLayer.source,
      ),
      overlayTextureMode: getShaderTextureBlendModeId(
        controls.textureLayer.mode,
      ),
      overlayTextureSampleDimension: getShaderSampleDimensionId(
        controls.textureLayer.sampleDimension,
      ),
      overlayTextureInvert: controls.textureLayer.inverted ? 1 : 0,
      overlayTextureAmount: controls.textureLayer.amount,
      overlayTextureScale: {
        x: controls.textureLayer.scaleX,
        y: controls.textureLayer.scaleY,
      },
      overlayTextureOffset: {
        x: controls.textureLayer.offsetX,
        y: controls.textureLayer.offsetY,
      },
      overlayTextureVolumeSliceZ: controls.textureLayer.volumeSliceZ ?? 0,
      warpTextureSource: getShaderTextureSourceId(controls.warpTexture.source),
      warpTextureSampleDimension: getShaderSampleDimensionId(
        controls.warpTexture.sampleDimension,
      ),
      warpTextureAmount: controls.warpTexture.amount,
      warpTextureScale: {
        x: controls.warpTexture.scaleX,
        y: controls.warpTexture.scaleY,
      },
      warpTextureOffset: {
        x: controls.warpTexture.offsetX,
        y: controls.warpTexture.offsetY,
      },
      warpTextureVolumeSliceZ: controls.warpTexture.volumeSliceZ ?? 0,
      signalBass: frameState.signals.bass,
      signalMid: frameState.signals.mid,
      signalTreb: frameState.signals.treb,
      signalBeat: frameState.signals.beatPulse,
      signalEnergy: frameState.signals.weightedEnergy,
      signalTime: frameState.signals.time,
    };
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    this.renderMesh(
      payload.frameState.mesh,
      payload.frameState.gpuGeometry,
      payload.frameState.signals,
      payload.frameState.interaction?.mesh,
    );

    const proceduralWavePlans =
      this.webgpuDescriptorPlan?.proceduralWaves ?? [];
    const canUseProceduralMainWave =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'main-wave');
    const canUseProceduralCustomWaves =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'custom-wave');
    const canUseProceduralTrailWaves =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'trail-waves');

    if (canUseProceduralMainWave && payload.frameState.gpuGeometry.mainWave) {
      this.renderProceduralWaveGroup('main-wave', this.mainWaveGroup, [
        payload.frameState.gpuGeometry.mainWave,
      ]);
    } else {
      this.renderWaveGroup('main-wave', this.mainWaveGroup, [
        payload.frameState.mainWave,
      ]);
    }
    if (
      canUseProceduralCustomWaves &&
      payload.frameState.gpuGeometry.customWaves.length > 0
    ) {
      this.renderProceduralCustomWaveGroup(
        this.customWaveGroup,
        payload.frameState.gpuGeometry.customWaves,
        payload.frameState.interaction?.waves,
      );
    } else {
      this.renderWaveGroup(
        'custom-wave',
        this.customWaveGroup,
        payload.frameState.customWaves,
      );
    }
    if (
      canUseProceduralTrailWaves &&
      payload.frameState.gpuGeometry.trailWaves.length > 0
    ) {
      this.renderProceduralWaveGroup(
        'trail-waves',
        this.trailGroup,
        payload.frameState.gpuGeometry.trailWaves,
        payload.frameState.interaction?.waves,
      );
    } else {
      this.renderLineVisualGroup(
        'trails',
        this.trailGroup,
        payload.frameState.trails,
      );
    }
    this.renderShapeGroup(
      'shapes',
      this.shapesGroup,
      payload.frameState.shapes,
    );
    this.renderBorderGroup(
      'borders',
      this.borderGroup,
      payload.frameState.borders,
    );
    this.renderMotionVectors(payload.frameState);

    const blend = payload.blendState;
    if (blend?.mode === 'gpu' && this.backend === 'webgpu') {
      const previousFrame = blend.previousFrame;
      const blendMix = 1 - blend.alpha;
      if (
        canUseProceduralMainWave &&
        previousFrame.gpuGeometry.mainWave &&
        payload.frameState.gpuGeometry.mainWave
      ) {
        this.renderInterpolatedProceduralWaveGroup(
          this.blendWaveGroup,
          [
            {
              previous: previousFrame.gpuGeometry.mainWave,
              current: payload.frameState.gpuGeometry.mainWave,
            },
          ],
          blendMix,
          blend.alpha,
          {
            offsetX: lerpNumber(
              previousFrame.interaction?.waves.offsetX ?? 0,
              payload.frameState.interaction?.waves.offsetX ?? 0,
              blendMix,
            ),
            offsetY: lerpNumber(
              previousFrame.interaction?.waves.offsetY ?? 0,
              payload.frameState.interaction?.waves.offsetY ?? 0,
              blendMix,
            ),
            rotation: lerpNumber(
              previousFrame.interaction?.waves.rotation ?? 0,
              payload.frameState.interaction?.waves.rotation ?? 0,
              blendMix,
            ),
            scale: lerpNumber(
              previousFrame.interaction?.waves.scale ?? 1,
              payload.frameState.interaction?.waves.scale ?? 1,
              blendMix,
            ),
            alphaMultiplier: lerpNumber(
              previousFrame.interaction?.waves.alphaMultiplier ?? 1,
              payload.frameState.interaction?.waves.alphaMultiplier ?? 1,
              blendMix,
            ),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-main-wave',
          this.blendWaveGroup,
          [previousFrame.mainWave],
          blend.alpha,
        );
      }
      if (
        canUseProceduralCustomWaves &&
        previousFrame.gpuGeometry.customWaves.length > 0 &&
        payload.frameState.gpuGeometry.customWaves.length > 0
      ) {
        const interpolatedCustomWaves = previousFrame.gpuGeometry.customWaves
          .map((wave, index) => {
            const current = payload.frameState.gpuGeometry.customWaves[index];
            return current ? { previous: wave, current } : null;
          })
          .filter((wave): wave is NonNullable<typeof wave> => wave !== null);
        this.renderInterpolatedProceduralCustomWaveGroup(
          this.blendCustomWaveGroup,
          interpolatedCustomWaves,
          blendMix,
          blend.alpha,
          {
            offsetX: lerpNumber(
              previousFrame.interaction?.waves.offsetX ?? 0,
              payload.frameState.interaction?.waves.offsetX ?? 0,
              blendMix,
            ),
            offsetY: lerpNumber(
              previousFrame.interaction?.waves.offsetY ?? 0,
              payload.frameState.interaction?.waves.offsetY ?? 0,
              blendMix,
            ),
            rotation: lerpNumber(
              previousFrame.interaction?.waves.rotation ?? 0,
              payload.frameState.interaction?.waves.rotation ?? 0,
              blendMix,
            ),
            scale: lerpNumber(
              previousFrame.interaction?.waves.scale ?? 1,
              payload.frameState.interaction?.waves.scale ?? 1,
              blendMix,
            ),
            alphaMultiplier: lerpNumber(
              previousFrame.interaction?.waves.alphaMultiplier ?? 1,
              payload.frameState.interaction?.waves.alphaMultiplier ?? 1,
              blendMix,
            ),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-custom-wave',
          this.blendCustomWaveGroup,
          previousFrame.customWaves,
          blend.alpha,
        );
      }
      this.renderInterpolatedShapeGroup(
        this.blendShapeGroup,
        previousFrame.shapes,
        payload.frameState.shapes,
        blendMix,
        blend.alpha,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        previousFrame.borders,
        blend.alpha,
      );
      this.renderMotionVectors(
        payload.frameState,
        blend.alpha,
        previousFrame,
        blendMix,
        this.blendMotionVectorCpuGroup,
        this.blendProceduralMotionVectors,
      );
      if (
        !this.blendProceduralMotionVectors.visible &&
        previousFrame.motionVectors.length === 0
      ) {
        clearGroup(this.blendMotionVectorCpuGroup);
      }
    } else {
      this.renderWaveGroup(
        'blend-main-wave',
        this.blendWaveGroup,
        blend?.mode === 'cpu' ? [blend.mainWave] : [],
        blend?.alpha ?? 0,
      );
      this.renderWaveGroup(
        'blend-custom-wave',
        this.blendCustomWaveGroup,
        blend?.mode === 'cpu' ? blend.customWaves : [],
        blend?.alpha ?? 0,
      );
      this.renderShapeGroup(
        'blend-shapes',
        this.blendShapeGroup,
        blend?.mode === 'cpu' ? blend.shapes : [],
        blend?.alpha ?? 0,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        blend?.mode === 'cpu' ? blend.borders : [],
        blend?.alpha ?? 0,
      );
      this.blendProceduralMotionVectors.visible = false;
      this.renderLineVisualGroup(
        'blend-motion-vectors',
        this.blendMotionVectorCpuGroup,
        blend?.mode === 'cpu' ? blend.motionVectors : [],
        blend?.alpha ?? 0,
      );
    }

    if (
      !isFeedbackCapableRenderer(this.renderer) ||
      !this.feedback ||
      !payload.frameState.post.shaderEnabled
    ) {
      return false;
    }

    this.feedback.applyCompositeState(
      this.buildFeedbackCompositeState(payload.frameState),
    );
    return this.feedback.render(this.renderer, this.scene, this.camera);
  }

  dispose() {
    clearGroup(this.mainWaveGroup);
    clearGroup(this.customWaveGroup);
    clearGroup(this.trailGroup);
    clearGroup(this.shapesGroup);
    clearGroup(this.borderGroup);
    clearGroup(this.motionVectorGroup);
    clearGroup(this.blendWaveGroup);
    clearGroup(this.blendCustomWaveGroup);
    clearGroup(this.blendShapeGroup);
    clearGroup(this.blendBorderGroup);
    clearGroup(this.blendMotionVectorGroup);
    if (!isSharedGeometry(this.background.geometry)) {
      disposeGeometry(this.background.geometry);
    }
    disposeMaterial(this.background.material);
    if (!isSharedGeometry(this.meshLines.geometry)) {
      disposeGeometry(this.meshLines.geometry);
    }
    disposeMaterial(this.meshLines.material);
    this.batcher?.dispose();
    this.feedback?.dispose();
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapterCore({
  scene,
  camera,
  renderer,
  backend,
  preset,
  behavior,
  createFeedbackManager,
  batcher,
}: MilkdropRendererAdapterConfig) {
  const adapter = new ThreeMilkdropAdapter({
    scene,
    camera,
    renderer: renderer ?? null,
    backend,
    behavior:
      behavior ??
      (backend === 'webgpu'
        ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR
        : WEBGL_MILKDROP_BACKEND_BEHAVIOR),
    createFeedbackManager: createFeedbackManager ?? null,
    batcher: batcher ?? null,
  });
  if (preset) {
    adapter.setPreset(preset);
  }
  return adapter;
}

export const createMilkdropRendererAdapter = createMilkdropRendererAdapterCore;

export const __milkdropRendererAdapterTestUtils = {
  syncInterpolatedProceduralWaveObject,
  syncInterpolatedProceduralCustomWaveObject,
};
