import * as THREE from 'three';

export const WarpShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uZoom: { value: 1.0 },
    uRotation: { value: 0.0 },
    uWarp: { value: 0.01 },
    uAudioIntensity: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uZoom;
    uniform float uRotation;
    uniform float uWarp;
    uniform float uAudioIntensity;
    
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      
      // Center coordinates
      vec2 p = uv - 0.5;
      
      // Apply rotation
      float angle = uRotation + uAudioIntensity * 0.1;
      float s = sin(angle);
      float c = cos(angle);
      p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      
      // Apply zoom
      p *= 1.0 / (uZoom + uAudioIntensity * 0.05);
      
      // Apply warping/distortion
      p += vec2(
        sin(p.y * 10.0 + uTime) * uWarp,
        cos(p.x * 10.0 + uTime) * uWarp
      ) * (1.0 + uAudioIntensity);
      
      // Restore coordinates
      uv = p + 0.5;
      
      // Sample previous frame with slight decay/fade
      vec4 color = texture2D(tDiffuse, uv);
      
      // Clamp and output
      gl_FragColor = color * 0.98; // Gradual fade-out
    }
  `
};

export default WarpShader;
