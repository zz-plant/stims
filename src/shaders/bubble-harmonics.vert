#version 100

uniform float time;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;

void main() {
  // Subtle breathing on the shell.
  float inflate = 1.0 + sin(time * 0.7 + position.y * 0.5) * 0.05;
  vec3 displaced = position * inflate;

  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vec4 viewPosition = viewMatrix * worldPosition;

  vNormal = normalize(normalMatrix * normal);
  vViewDir = -viewPosition.xyz;
  vUv = uv;

  gl_Position = projectionMatrix * viewPosition;
}
