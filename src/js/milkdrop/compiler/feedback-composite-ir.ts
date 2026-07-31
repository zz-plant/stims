/**
 * Declarative Composite Shader Intermediate Representation (IR)
 *
 * Provides a single source of truth for post-processing, feedback loops,
 * video echo, and color space modulation across WebGL and WebGPU renderers.
 */

export interface CompositeValueNode {
  type: 'constant' | 'variable' | 'binary' | 'call';
  name?: string;
  value?: number;
  left?: CompositeValueNode;
  right?: CompositeValueNode;
  operator?: string;
  args?: CompositeValueNode[];
}

export interface CompositePassIR {
  version: 1;
  videoEcho: {
    enabled: boolean;
    zoom: CompositeValueNode;
    alpha: CompositeValueNode;
    orientation: 0 | 1 | 2 | 3;
  };
  warp: {
    decay: CompositeValueNode;
    scale: CompositeValueNode;
    wrapMode: 'clamp' | 'wrap';
  };
  colorModulation: {
    brighten: boolean;
    darken: boolean;
    invert: boolean;
    hueShift: CompositeValueNode;
  };
}

/**
 * Creates a default, neutral Composite Shader IR state.
 */
export function createDefaultCompositePassIR(): CompositePassIR {
  return {
    version: 1,
    videoEcho: {
      enabled: false,
      zoom: { type: 'constant', value: 1.0 },
      alpha: { type: 'constant', value: 0.0 },
      orientation: 0,
    },
    warp: {
      decay: { type: 'constant', value: 0.98 },
      scale: { type: 'constant', value: 1.0 },
      wrapMode: 'wrap',
    },
    colorModulation: {
      brighten: false,
      darken: false,
      invert: false,
      hueShift: { type: 'constant', value: 0.0 },
    },
  };
}

/**
 * Compiles a CompositePassIR into a GLSL fragment shader source string.
 */
export function compileCompositeIRToGlsl(ir: CompositePassIR): string {
  const echoZoom = ir.videoEcho.enabled ? 'u_echo_zoom' : '1.0';
  const echoAlpha = ir.videoEcho.enabled ? 'u_echo_alpha' : '0.0';
  const decay = 'u_decay';

  return `
precision mediump float;
uniform sampler2D u_main_texture;
uniform float u_echo_zoom;
uniform float u_echo_alpha;
uniform float u_decay;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec4 mainColor = texture2D(u_main_texture, uv);
  vec4 feedbackColor = mainColor * ${decay};
  
  if (${ir.videoEcho.enabled ? 'true' : 'false'}) {
    vec2 echoUv = (uv - 0.5) / ${echoZoom} + 0.5;
    vec4 echoColor = texture2D(u_main_texture, echoUv);
    feedbackColor = mix(feedbackColor, echoColor, ${echoAlpha});
  }
  
  gl_FragColor = feedbackColor;
}
`.trim();
}
