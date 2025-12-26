precision highp float;

uniform float time;
uniform vec3 baseColor;
uniform vec3 highlightColor;
uniform float opacity;
uniform float refractionStrength;
uniform float fresnelPower;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;

float noise(vec2 uv) {
  return fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewDir);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), fresnelPower);
  float rim = smoothstep(0.0, 1.0, fresnel);

  // Thin-film shimmer using layered noise.
  float shimmer = noise(vUv * 8.0 + time * 0.25);
  float swirl = noise((vUv + shimmer) * 3.5 + time * 0.15);
  float refraction = refractionStrength * (shimmer * 0.5 + swirl * 0.5);

  vec3 color = mix(baseColor, highlightColor, rim + refraction * 0.25);
  color += vec3(refraction * 0.4);

  float alpha = opacity * mix(0.35, 1.0, rim + shimmer * 0.2);
  gl_FragColor = vec4(color, alpha);
}
