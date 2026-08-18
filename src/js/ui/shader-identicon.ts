/**
 * WebGL 2D/3D Signed Distance Field (SDF) Parametric Icon Renderer
 *
 * Every identicon draws through ONE shared offscreen WebGL context and blits
 * the frame into its own 2D canvas. Browsers cap concurrent WebGL contexts
 * per page (~8–16) and silently evict the oldest, so per-identicon contexts
 * could evict the main visualizer's context; 2D canvases have no such cap.
 */

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_seed_hash;
uniform float u_audio_bass;
uniform float u_audio_mid;
uniform float u_audio_treble;
uniform float u_time;
uniform float u_mode; // 0.0 = 2D Multi-band SDF, 1.0 = 3D Raymarched Polyhedron

float sdIcosahedron(vec3 p, float r) {
  const float q = 1.6180339887;
  vec3 n = normalize(vec3(q, 1.0, 0.0));
  p = abs(p);
  float a = dot(p, n);
  float b = dot(p, n.yzx);
  float c = dot(p, n.zxy);
  return max(max(a, b), c) - r;
}

float sdfNgon(vec2 p, float r, float n) {
  float a = atan(p.x, p.y) + 3.14159265;
  float b = 6.2831853 / n;
  return cos(floor(0.5 + a / b) * b - a) * length(p) - r;
}

float sdfRing(vec2 p, float r, float thickness) {
  return abs(length(p) - r) - thickness;
}

mat3 rotate3dX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotate3dY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotate3dZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec2 st = (v_uv - 0.5) * 2.0;

  float sides = floor(3.0 + mod(u_seed_hash * 100.0, 5.0));
  float hue = mod(u_seed_hash * 360.0, 360.0);
  float rotateSpeed = (mod(u_seed_hash * 10.0, 2.0) - 1.0) * 0.4;

  float angle = u_time * rotateSpeed + u_audio_mid * 0.8;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 rotatedSt = rot * st;

  float d = 0.0;
  float specular3d = 0.0;

  if (u_mode > 0.5) {
    // 3D Raymarched Polyhedron Mode
    float rx = u_time * rotateSpeed * 0.7 + u_audio_bass * 0.5;
    float ry = u_time * rotateSpeed * 1.1 + u_audio_mid * 0.6;
    float rz = u_time * rotateSpeed * 0.4 + u_audio_treble * 0.4;
    mat3 rot3d = rotate3dZ(rz) * rotate3dY(ry) * rotate3dX(rx);

    vec3 ro = vec3(0.0, 0.0, 2.2);
    vec3 rd = normalize(vec3(st, -1.6));
    float t = 0.6;
    float rad = 0.45 + u_audio_bass * 0.15;
    float h = 0.0;
    for (int i = 0; i < 16; i++) {
      vec3 p = rot3d * (ro + rd * t);
      h = sdIcosahedron(p, rad);
      t += h;
      if (abs(h) < 0.002 || t > 3.5) break;
    }
    vec3 hitPos = rot3d * (ro + rd * t);
    d = sdIcosahedron(hitPos, rad);

    vec2 eps = vec2(0.003, 0.0);
    vec3 n = normalize(vec3(
      sdIcosahedron(hitPos + eps.xyy, rad) - sdIcosahedron(hitPos - eps.xyy, rad),
      sdIcosahedron(hitPos + eps.yxy, rad) - sdIcosahedron(hitPos - eps.yxy, rad),
      sdIcosahedron(hitPos + eps.yyx, rad) - sdIcosahedron(hitPos - eps.yyx, rad)
    ));
    vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
    vec3 viewDir = normalize(-rd);
    vec3 halfDir = normalize(lightDir + viewDir);
    specular3d = pow(max(0.0, dot(n, halfDir)), 12.0) * 0.5;
  } else {
    // 2D Multi-band SDF Mode
    float bassRadius = 0.65 + u_audio_bass * 0.15;
    float bassRing = sdfRing(st, bassRadius, 0.02);
    float ngonRadius = 0.38 + u_audio_mid * 0.1;
    float ngonDist = sdfNgon(rotatedSt, ngonRadius, sides);
    d = min(bassRing, ngonDist);
  }

  float edgeWidth = 0.04;
  float alpha = smoothstep(edgeWidth, -edgeWidth, d);
  float totalPeak = (u_audio_bass + u_audio_mid + u_audio_treble) / 3.0;
  float glow = 0.025 / (abs(d) + 0.012) * (0.7 + totalPeak * 0.8);

  vec3 baseColor = 0.5 + 0.5 * cos(6.28318 * (hue / 360.0 + vec3(0.0, 0.33, 0.67))) + vec3(specular3d);

  // Historical note: this shader originally wrote straight alpha into a
  // premultiplied-alpha canvas, so the compositor contributed color (not
  // color * alpha) — a brightness boost the identicon look depends on. The
  // shared-context blit composites correctly, so reproduce that exact
  // contribution algebraically: color' * alpha' == baseColor * (alpha + glow).
  float intensity = alpha + glow;
  gl_FragColor = vec4(baseColor * max(intensity, 1.0), clamp(intensity, 0.0, 1.0));
}
`;

export interface ShaderIdenticonRenderState {
  seed: string;
  audioPeak: number;
  mode?: '2d-sdf' | '3d-polyhedron';
  multiBand?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  timeSec: number;
}

type SharedIdenticonGl = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  seedHashLocation: WebGLUniformLocation | null;
  audioBassLocation: WebGLUniformLocation | null;
  audioMidLocation: WebGLUniformLocation | null;
  audioTrebleLocation: WebGLUniformLocation | null;
  modeLocation: WebGLUniformLocation | null;
  timeLocation: WebGLUniformLocation | null;
  resolutionLocation: WebGLUniformLocation | null;
};

/** undefined = not yet attempted, null = attempted and unavailable. */
let sharedGl: SharedIdenticonGl | null | undefined;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createSharedGl(): SharedIdenticonGl | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    // The shader writes straight (non-premultiplied) alpha, and glow lets
    // color exceed alpha. A premultiplied buffer clamps that on the 2D-canvas
    // blit and unpremultiplies into blown-out white — request straight alpha
    // so drawImage carries the shader's output through unchanged.
    premultipliedAlpha: false,
  });
  if (!gl) return null;

  const vertShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  if (!vertShader || !fragShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null;
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method call gl.useProgram, not a React hook
  gl.useProgram(program);

  // The quad geometry binds once and persists — this context runs only this
  // program, so no per-draw rebinding is needed.
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const posAttr = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posAttr);
  gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

  return {
    canvas,
    gl,
    program,
    seedHashLocation: gl.getUniformLocation(program, 'u_seed_hash'),
    audioBassLocation: gl.getUniformLocation(program, 'u_audio_bass'),
    audioMidLocation: gl.getUniformLocation(program, 'u_audio_mid'),
    audioTrebleLocation: gl.getUniformLocation(program, 'u_audio_treble'),
    modeLocation: gl.getUniformLocation(program, 'u_mode'),
    timeLocation: gl.getUniformLocation(program, 'u_time'),
    resolutionLocation: gl.getUniformLocation(program, 'u_resolution'),
  };
}

function getSharedGl(): SharedIdenticonGl | null {
  if (sharedGl === undefined) {
    sharedGl = createSharedGl();
  } else if (sharedGl?.gl.isContextLost()) {
    // The browser reclaimed the shared context (context-cap pressure or GPU
    // reset). Rebuild on a fresh canvas; the old one is unrecoverable.
    sharedGl = createSharedGl();
  }
  return sharedGl;
}

export class ShaderIdenticonRenderer {
  private ctx2d: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx2d = this.canvas.getContext('2d');
  }

  public render(state: ShaderIdenticonRenderState) {
    const ctx2d = this.ctx2d;
    if (!ctx2d) return;
    const shared = getSharedGl();
    if (!shared) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === 0 || height === 0) return;

    let hash = 0;
    for (let i = 0; i < state.seed.length; i++) {
      hash = (hash << 5) - hash + state.seed.charCodeAt(i);
      hash |= 0;
    }
    const normalizedHash = (Math.abs(hash) % 10000) / 10000.0;

    const bass = state.multiBand?.bass ?? state.audioPeak;
    const mid = state.multiBand?.mid ?? state.audioPeak;
    const treble = state.multiBand?.treble ?? state.audioPeak;
    const mode = state.mode === '3d-polyhedron' ? 1.0 : 0.0;

    const { gl, canvas: glCanvas, program } = shared;
    // Grow-only: the canvas is shared by every identicon on screen, and
    // several render at different sizes on interleaved rAF ticks. An exact
    // size match would reallocate the drawing buffer multiple times per
    // frame, so keep the largest size seen and draw into a sub-viewport.
    if (glCanvas.width < width || glCanvas.height < height) {
      glCanvas.width = Math.max(glCanvas.width, width);
      glCanvas.height = Math.max(glCanvas.height, height);
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method call gl.useProgram, not a React hook
    gl.useProgram(program);
    gl.uniform1f(shared.seedHashLocation, normalizedHash);
    gl.uniform1f(shared.audioBassLocation, bass);
    gl.uniform1f(shared.audioMidLocation, mid);
    gl.uniform1f(shared.audioTrebleLocation, treble);
    gl.uniform1f(shared.modeLocation, mode);
    gl.uniform1f(shared.timeLocation, state.timeSec);
    gl.uniform2f(shared.resolutionLocation, width, height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Blit synchronously in the same task as the draw — once control returns
    // to the browser, the shared drawing buffer may be cleared.
    // The viewport sits at the bottom-left of the (possibly larger) shared
    // buffer, which is the top of the canvas' flipped coordinate space.
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.drawImage(
      glCanvas,
      0,
      glCanvas.height - height,
      width,
      height,
      0,
      0,
      width,
      height,
    );
  }

  public destroy() {
    this.ctx2d = null;
  }
}
