#version 100
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

// Mobile-safe hash — avoids sin() precision artifacts on Mali / Adreno.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewDir);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), fresnelPower);
  float rim = smoothstep(0.0, 1.0, fresnel);

  // Thin-film shimmer using layered noise.
  float shimmer = hash(vUv * 8.0 + time * 0.25);
  float swirl = hash((vUv + shimmer) * 3.5 + time * 0.15);
  float refraction = refractionStrength * (shimmer * 0.5 + swirl * 0.5);

  // refraction: adds color variation through the highlight blend
  //           + a subtle overall brightness boost from the thin film.
  vec3 color = mix(baseColor, highlightColor, clamp(rim + refraction * 0.25, 0.0, 1.0));
  color += vec3(refraction * 0.4);

  // Clamp the rim-shimmer term so alpha never overshoots opacity.
  float alpha = opacity * mix(0.35, 1.0, clamp(rim + shimmer * 0.2, 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);
}
