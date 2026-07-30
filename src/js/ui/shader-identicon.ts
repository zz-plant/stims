/**
 * WebGL 2D/3D Signed Distance Field (SDF) Parametric Icon Renderer
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

void main() {
  vec2 st = (v_uv - 0.5) * 2.0;

  float sides = floor(3.0 + mod(u_seed_hash * 100.0, 5.0));
  float hue = mod(u_seed_hash * 360.0, 360.0);
  float rotateSpeed = (mod(u_seed_hash * 10.0, 2.0) - 1.0) * 0.4;

  float angle = u_time * rotateSpeed + u_audio_mid * 0.8;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 rotatedSt = rot * st;

  float d = 0.0;
  if (u_mode > 0.5) {
    // 3D Raymarched Polyhedron Mode
    vec3 ro = vec3(0.0, 0.0, 2.2);
    vec3 rd = normalize(vec3(st, -1.5));
    vec3 p = ro + rd * 1.2;
    vec3 pRot = vec3(rot * p.xy, p.z);
    d = sdIcosahedron(pRot, 0.45 + u_audio_bass * 0.15);
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

  vec3 baseColor = 0.5 + 0.5 * cos(6.28318 * (hue / 360.0 + vec3(0.0, 0.33, 0.67)));
  vec3 finalColor = baseColor * (alpha + glow);

  gl_FragColor = vec4(finalColor, clamp(alpha + glow, 0.0, 1.0));
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

export class ShaderIdenticonRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private seedHashLocation: WebGLUniformLocation | null = null;
  private audioBassLocation: WebGLUniformLocation | null = null;
  private audioMidLocation: WebGLUniformLocation | null = null;
  private audioTrebleLocation: WebGLUniformLocation | null = null;
  private modeLocation: WebGLUniformLocation | null = null;
  private timeLocation: WebGLUniformLocation | null = null;
  private resolutionLocation: WebGLUniformLocation | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.initWebGL();
  }

  private initWebGL() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
    });
    if (!gl) return;
    this.gl = gl;

    const vertShader = this.compileShader(
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    );
    const fragShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );
    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }

    this.program = program;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method call gl.useProgram, not a React hook
    gl.useProgram(program);

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

    this.seedHashLocation = gl.getUniformLocation(program, 'u_seed_hash');
    this.audioBassLocation = gl.getUniformLocation(program, 'u_audio_bass');
    this.audioMidLocation = gl.getUniformLocation(program, 'u_audio_mid');
    this.audioTrebleLocation = gl.getUniformLocation(program, 'u_audio_treble');
    this.modeLocation = gl.getUniformLocation(program, 'u_mode');
    this.timeLocation = gl.getUniformLocation(program, 'u_time');
    this.resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
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

  public render(state: ShaderIdenticonRenderState) {
    const gl = this.gl;
    if (!gl || !this.program) return;

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

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API method call gl.useProgram, not a React hook
    gl.useProgram(this.program);
    gl.uniform1f(this.seedHashLocation, normalizedHash);
    gl.uniform1f(this.audioBassLocation, bass);
    gl.uniform1f(this.audioMidLocation, mid);
    gl.uniform1f(this.audioTrebleLocation, treble);
    gl.uniform1f(this.modeLocation, mode);
    gl.uniform1f(this.timeLocation, state.timeSec);
    gl.uniform2f(
      this.resolutionLocation,
      this.canvas.width,
      this.canvas.height,
    );

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public destroy() {
    this.gl = null;
    this.program = null;
  }
}
