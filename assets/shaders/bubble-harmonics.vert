precision highp float;

uniform float time;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * worldPosition;
  vViewDir = -viewPosition.xyz;
  vUv = uv;

  // Subtle breathing on the shell.
  float inflate = 1.0 + sin(time * 0.7 + position.y * 0.5) * 0.05;
  vec3 displaced = position * inflate;

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(displaced, 1.0);
}
