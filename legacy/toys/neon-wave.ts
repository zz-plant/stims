import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
} from '../core/performance-panel';
import {
  createBloomComposer,
  type PostprocessingPipeline,
  resolveWebGLRenderer,
} from '../core/postprocessing';
import { PersistentSettingsPanel } from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createBeatTracker } from '../utils/audio-beat';
import type { FrequencyAnalyser } from '../utils/audio-handler';
import { createPerformanceSettingsHandler } from '../utils/performance-settings';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import {
  buildToySettingsPanelWithPerformance,
  createToyQualityControls,
} from '../utils/toy-settings';

type NeonTheme = 'synthwave' | 'cyberpunk' | 'arctic' | 'sunset';

interface ThemePalette {
  primary: number;
  secondary: number;
  accent: number;
  background: number;
  bloomStrength: number;
}

const THEMES: Record<NeonTheme, ThemePalette> = {
  synthwave: {
    primary: 0xff00ff,
    secondary: 0x00ffff,
    accent: 0xff6600,
    background: 0x0a0015,
    bloomStrength: 1.5,
  },
  cyberpunk: {
    primary: 0x00ff88,
    secondary: 0xff0066,
    accent: 0xffff00,
    background: 0x050505,
    bloomStrength: 1.8,
  },
  arctic: {
    primary: 0x00d4ff,
    secondary: 0x8080ff,
    accent: 0xffffff,
    background: 0x001020,
    bloomStrength: 1.2,
  },
  sunset: {
    primary: 0xff4400,
    secondary: 0xff0088,
    accent: 0xffcc00,
    background: 0x100005,
    bloomStrength: 1.6,
  },
};

export function start({ container }: ToyStartOptions = {}) {
  const settingsPanel = new PersistentSettingsPanel(container || undefined);
  const { quality } = createToyQualityControls({
    title: 'Neon Wave',
    description: 'Retro-wave visualizer with bloom effects. Pick a theme!',
    panel: settingsPanel,
    getRuntime: () => runtimeRef,
    getRendererSettings: (preset) => ({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    }),
    onChange: () => {
      createWaveMesh();
      createParticles();
    },
  });
  let performanceSettings = getActivePerformanceSettings();
  let performanceSettingsHandler: ReturnType<
    typeof createPerformanceSettingsHandler
  > | null = null;
  let currentTheme: NeonTheme = 'synthwave';
  let glowProfile: 'vivid' | 'soft' = 'vivid';
  let palette = THEMES[currentTheme];
  let runtime: ToyRuntimeInstance;
  let runtimeRef: ToyRuntimeInstance | null = null;

  // Post-processing
  let postprocessing: PostprocessingPipeline | null = null;

  // Scene elements
  const waveGroup = new Group();
  const gridGroup = new Group();
  const particleGroup = new Group();
  const horizonGroup = new Group();

  waveGroup.clear();
  gridGroup.clear();
  particleGroup.clear();
  horizonGroup.clear();

  // Audio smoothing
  let smoothedBass = 0;
  let smoothedMids = 0;
  let smoothedHighs = 0;
  let beatIntensity = 0;
  const beatTracker = createBeatTracker({
    threshold: 0.45,
    minIntervalMs: 150,
    smoothing: { bass: 0.85, mid: 0.9, treble: 0.92 },
    beatDecay: 0.92,
  });

  // Wave mesh
  let waveMesh: Mesh | null = null;
  let waveGeometry: PlaneGeometry | null = null;
  let waveMaterial: ShaderMaterial | null = null;

  // Grid lines
  const gridLines: Line[] = [];

  // Particles
  let particles: Points | null = null;
  let particleGeometry: BufferGeometry | null = null;
  let particleMaterial: PointsMaterial | null = null;
  let particleVelocities: Float32Array | null = null;
  let particleBaseColors: Float32Array | null = null;

  // Horizon sun/moon
  let horizonMesh: Mesh | null = null;
  let horizonMaskTexture: Texture | null = null;

  function getWaveSegments() {
    const scale =
      (quality.activeQuality.particleScale ?? 1) *
      performanceSettings.particleBudget;
    return {
      widthSegments: Math.max(32, Math.round(96 * scale)),
      heightSegments: Math.max(32, Math.round(96 * scale)),
    };
  }

  function getParticleCount() {
    const scale =
      (quality.activeQuality.particleScale ?? 1) *
      performanceSettings.particleBudget;
    return Math.max(800, Math.round(2500 * scale));
  }

  // Custom wave shader
  const waveVertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uMids;
    uniform float uHighs;
    uniform float uBeat;
    
    varying vec2 vUv;
    varying float vElevation;
    
    void main() {
      vUv = uv;
      
      vec3 pos = position;
      
      // Multi-layered wave pattern
      float wave1 = sin(pos.x * 0.15 + uTime * 0.5) * uBass * 8.0;
      float wave2 = sin(pos.y * 0.1 + uTime * 0.3) * uMids * 5.0;
      float wave3 = sin((pos.x + pos.y) * 0.08 - uTime * 0.7) * uHighs * 4.0;
      float ripple = sin(length(pos.xy) * 0.1 - uTime * 1.5) * uBeat * 6.0;
      
      float elevation = wave1 + wave2 + wave3 + ripple;
      pos.z += elevation;
      
      vElevation = elevation;
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const waveFragmentShader = `
    uniform vec3 uColorPrimary;
    uniform vec3 uColorSecondary;
    uniform vec3 uColorAccent;
    uniform float uTime;
    uniform float uBass;
    
    varying vec2 vUv;
    varying float vElevation;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345);
      return fract(p.x * p.y);
    }

    float noise2d(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));

      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    
    void main() {
      // Gradient based on elevation and position
      float mixFactor = (vElevation + 10.0) / 20.0;
      mixFactor = clamp(mixFactor, 0.0, 1.0);
      
      vec3 color = mix(uColorPrimary, uColorSecondary, mixFactor);
      
      // Add accent glow on peaks
      if (vElevation > 5.0) {
        float peakGlow = (vElevation - 5.0) / 10.0;
        color = mix(color, uColorAccent, peakGlow * 0.6);
      }
      
      // Edge glow effect
      float edgeX = 1.0 - abs(vUv.x - 0.5) * 2.0;
      float edgeY = 1.0 - abs(vUv.y - 0.5) * 2.0;
      float edgeFade = edgeX * edgeY;
      
      // Grid lines effect
      float gridX = abs(sin(vUv.x * 40.0)) < 0.05 ? 1.2 : 1.0;
      float gridY = abs(sin(vUv.y * 40.0)) < 0.05 ? 1.2 : 1.0;
      
      color *= gridX * gridY;
      
      // Procedural shimmer ripples to avoid flat color bands
      float rippleNoise = noise2d(vUv * 8.0 + vec2(uTime * 0.2, -uTime * 0.08));
      float shimmer = 0.9 + rippleNoise * (0.18 + uBass * 0.2);
      color *= shimmer;

      // Pulsing glow
      float pulse = 0.8 + sin(uTime * 2.0) * 0.2 * uBass;

      // Depth-heavy vignette keeps focus near center where audio peaks are strongest
      float vignette = smoothstep(1.0, 0.15, distance(vUv, vec2(0.5)));

      gl_FragColor = vec4(color * pulse, edgeFade * (0.4 + vignette * 0.6));
    }
  `;

  const horizonVertexShader = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const horizonFragmentShader = `
    uniform sampler2D uMask;
    uniform vec3 uAccent;
    uniform vec3 uSecondary;
    uniform float uTime;
    uniform float uBass;
    uniform float uMids;
    uniform float uHighs;

    varying vec2 vUv;

    void main() {
      vec4 mask = texture2D(uMask, vUv);
      float ringPulse = 0.86 + sin(uTime * 2.6 + vUv.y * 12.0) * (0.08 + uBass * 0.1);
      float horizonScan = smoothstep(0.35, 0.95, sin((vUv.y + uTime * 0.06) * 54.0) * 0.5 + 0.5);
      float spectral = 0.2 + uMids * 0.4 + uHighs * 0.4;
      vec3 base = mix(uSecondary, uAccent, mask.r);
      vec3 color = mix(base, vec3(1.0), horizonScan * spectral * 0.45);
      color *= ringPulse;
      gl_FragColor = vec4(color, mask.a * (0.68 + spectral * 0.26));
    }
  `;

  function createHorizonMaskTexture() {
    const svg = encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="sun-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="white" stop-opacity="1"/>
            <stop offset="100%" stop-color="white" stop-opacity="0.75"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="43" fill="url(#sun-gradient)"/>
        <rect x="14" y="47" width="72" height="4" fill="black" fill-opacity="0.25"/>
        <rect x="18" y="58" width="64" height="5" fill="black" fill-opacity="0.3"/>
        <rect x="23" y="70" width="54" height="5" fill="black" fill-opacity="0.36"/>
      </svg>
    `);
    return new TextureLoader().load(`data:image/svg+xml;charset=utf-8,${svg}`);
  }

  function createWaveMesh() {
    if (waveMesh) {
      waveGroup.remove(waveMesh);
      disposeGeometry(waveGeometry ?? undefined);
      disposeMaterial(waveMaterial);
    }

    const { widthSegments, heightSegments } = getWaveSegments();
    waveGeometry = new PlaneGeometry(180, 180, widthSegments, heightSegments);

    const primaryColor = new Color(palette.primary);
    const secondaryColor = new Color(palette.secondary);
    const accentColor = new Color(palette.accent);

    waveMaterial = new ShaderMaterial({
      vertexShader: waveVertexShader,
      fragmentShader: waveFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uHighs: { value: 0 },
        uBeat: { value: 0 },
        uColorPrimary: { value: primaryColor },
        uColorSecondary: { value: secondaryColor },
        uColorAccent: { value: accentColor },
      },
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });

    waveMesh = new Mesh(waveGeometry, waveMaterial);
    waveMesh.rotation.x = -Math.PI / 2.5;
    waveMesh.position.y = -20;
    waveGroup.add(waveMesh);
  }

  function createGrid() {
    // Clear existing
    gridLines.forEach((line) => {
      gridGroup.remove(line);
      disposeGeometry(line.geometry);
      disposeMaterial(line.material as Material);
    });
    gridLines.length = 0;

    const gridColor = new Color(palette.primary);
    const lineMaterial = new LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.4,
    });

    // Horizontal lines
    for (let i = -10; i <= 10; i++) {
      const points = [
        new Vector3(-100, -25, i * 10),
        new Vector3(100, -25, i * 10),
      ];
      const geometry = new BufferGeometry().setFromPoints(points);
      const line = new Line(geometry, lineMaterial.clone());
      gridGroup.add(line);
      gridLines.push(line);
    }

    // Vertical lines
    for (let i = -10; i <= 10; i++) {
      const points = [
        new Vector3(i * 10, -25, -100),
        new Vector3(i * 10, -25, 100),
      ];
      const geometry = new BufferGeometry().setFromPoints(points);
      const line = new Line(geometry, lineMaterial.clone());
      gridGroup.add(line);
      gridLines.push(line);
    }
  }

  function createParticles() {
    if (particles) {
      particleGroup.remove(particles);
      disposeGeometry(particleGeometry ?? undefined);
      disposeMaterial(particleMaterial);
    }

    const count = getParticleCount();
    particleGeometry = new BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    particleBaseColors = new Float32Array(count * 3);
    particleVelocities = new Float32Array(count);

    const primaryCol = new Color(palette.primary);
    const secondaryCol = new Color(palette.secondary);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 200;
      positions[i3 + 1] = Math.random() * 80 - 10;
      positions[i3 + 2] = (Math.random() - 0.5) * 200 - 50;
      particleVelocities[i] = 0.1 + Math.random() * 0.3;

      const mixColor = new Color().lerpColors(
        primaryCol,
        secondaryCol,
        Math.random(),
      );
      colors[i3] = mixColor.r;
      colors[i3 + 1] = mixColor.g;
      colors[i3 + 2] = mixColor.b;
      particleBaseColors[i3] = mixColor.r;
      particleBaseColors[i3 + 1] = mixColor.g;
      particleBaseColors[i3 + 2] = mixColor.b;
    }

    particleGeometry.setAttribute(
      'position',
      new BufferAttribute(positions, 3),
    );
    particleGeometry.setAttribute('color', new BufferAttribute(colors, 3));

    particleMaterial = new PointsMaterial({
      size: 2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    particles = new Points(particleGeometry, particleMaterial);
    particleGroup.add(particles);
  }

  function createHorizon() {
    if (horizonMesh) {
      horizonGroup.remove(horizonMesh);
      disposeGeometry(horizonMesh.geometry as BufferGeometry);
      disposeMaterial(horizonMesh.material as Material);
    }

    horizonMaskTexture ??= createHorizonMaskTexture();
    const geometry = new PlaneGeometry(56, 56, 1, 1);
    const material = new ShaderMaterial({
      vertexShader: horizonVertexShader,
      fragmentShader: horizonFragmentShader,
      uniforms: {
        uMask: { value: horizonMaskTexture },
        uAccent: { value: new Color(palette.accent) },
        uSecondary: { value: new Color(palette.secondary) },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uHighs: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    horizonMesh = new Mesh(geometry, material);
    horizonMesh.position.set(0, 10, -120);
    horizonGroup.add(horizonMesh);
  }

  function setupPostProcessing(toy: ToyRuntimeInstance['toy']) {
    toy.rendererReady.then((result) => {
      if (!result) return;

      const webglRenderer = resolveWebGLRenderer(
        result.backend,
        result.renderer,
      );
      if (!webglRenderer) return;

      postprocessing = createBloomComposer({
        renderer: webglRenderer,
        scene: toy.scene,
        camera: toy.camera,
        bloomStrength: getBloomStrength(),
        bloomRadius: 0.4,
        bloomThreshold: 0.85,
      });
    });
  }

  function getBloomStrength() {
    return glowProfile === 'soft'
      ? Math.max(0.55, palette.bloomStrength * 0.6)
      : palette.bloomStrength;
  }

  function applyGlowProfile(profile: 'vivid' | 'soft') {
    glowProfile = profile;
    if (postprocessing?.bloomPass) {
      postprocessing.bloomPass.strength = getBloomStrength();
    }
  }

  function applyTheme(theme: NeonTheme) {
    currentTheme = theme;
    palette = THEMES[theme];

    // Update wave colors
    if (waveMaterial) {
      waveMaterial.uniforms.uColorPrimary.value = new Color(palette.primary);
      waveMaterial.uniforms.uColorSecondary.value = new Color(
        palette.secondary,
      );
      waveMaterial.uniforms.uColorAccent.value = new Color(palette.accent);
    }

    // Update grid colors
    gridLines.forEach((line) => {
      (line.material as LineBasicMaterial).color.setHex(palette.primary);
    });

    // Update horizon
    if (horizonMesh) {
      const horizonMaterial = horizonMesh.material as ShaderMaterial;
      horizonMaterial.uniforms.uAccent.value = new Color(palette.accent);
      horizonMaterial.uniforms.uSecondary.value = new Color(palette.secondary);
    }

    // Update bloom
    if (postprocessing?.bloomPass) {
      postprocessing.bloomPass.strength = getBloomStrength();
    }

    // Update background
    const toy = runtimeRef?.toy;
    if (toy) {
      toy.rendererReady.then((result) => {
        if (result) {
          result.renderer.setClearColor(palette.background, 1);
        }
      });
    }
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    createWaveMesh();
    createParticles();
  }

  function setupSettingsPanel() {
    const themes: NeonTheme[] = ['synthwave', 'cyberpunk', 'arctic', 'sunset'];
    buildToySettingsPanelWithPerformance({
      title: 'Neon Wave',
      description: 'Retro-wave visualizer with bloom effects. Pick a theme!',
      panel: settingsPanel,
      quality,
      performance: {
        title: 'Performance',
        description: 'Balance visual fidelity and frame rate.',
      },
      sections: [
        {
          title: 'Theme',
          description: 'Pick a colorway for the glow.',
          controls: [
            {
              type: 'button-group',
              options: themes.map((theme) => ({
                id: theme,
                label: theme.charAt(0).toUpperCase() + theme.slice(1),
              })),
              getActiveId: () => currentTheme,
              onChange: (theme) => applyTheme(theme as NeonTheme),
              rowStyle:
                'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;',
              buttonStyle: [
                'padding: 6px 12px',
                'border: 1px solid currentColor',
                'background: transparent',
                'color: inherit',
                'border-radius: 4px',
                'cursor: pointer',
                'font-size: 12px',
                'transition: all 0.2s',
              ].join('; '),
              activeClassName: 'active',
              setAriaPressed: false,
              dataAttribute: 'data-neon-theme',
            },
          ],
        },
        {
          title: 'Glow profile',
          description: 'Use Soft glow for reduced bloom intensity.',
          controls: [
            {
              type: 'button-group',
              options: [
                { id: 'vivid', label: 'Vivid' },
                { id: 'soft', label: 'Soft glow' },
              ],
              getActiveId: () => glowProfile,
              onChange: (profile) =>
                applyGlowProfile(profile as 'vivid' | 'soft'),
              rowStyle:
                'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;',
              buttonStyle: [
                'padding: 6px 12px',
                'border: 1px solid currentColor',
                'background: transparent',
                'color: inherit',
                'border-radius: 4px',
                'cursor: pointer',
                'font-size: 12px',
              ].join('; '),
              activeClassName: 'active',
              setAriaPressed: false,
              dataAttribute: 'data-neon-glow',
            },
          ],
        },
      ],
    });
  }

  function animate(analyser: FrequencyAnalyser | null, time: number) {
    // const data = getContextFrequencyData(ctx);
    const scaledTime = time / 1000;

    // Multi-band frequency analysis using FrequencyAnalyser
    const energy = analyser
      ? analyser.getMultiBandEnergy()
      : { bass: 0, mid: 0, treble: 0 };

    const bass = energy.bass;
    const mids = energy.mid;
    const highs = energy.treble;

    const beatState = beatTracker.update(
      { bass, mid: mids, treble: highs },
      time,
    );
    smoothedBass = beatState.smoothedBands.bass;
    smoothedMids = beatState.smoothedBands.mid;
    smoothedHighs = beatState.smoothedBands.treble;
    beatIntensity = beatState.beatIntensity;

    // Update wave shader uniforms
    if (waveMaterial) {
      waveMaterial.uniforms.uTime.value = scaledTime;
      waveMaterial.uniforms.uBass.value = smoothedBass;
      waveMaterial.uniforms.uMids.value = smoothedMids;
      waveMaterial.uniforms.uHighs.value = smoothedHighs;
      waveMaterial.uniforms.uBeat.value = beatIntensity;
    }

    // Animate grid
    gridGroup.position.z = (scaledTime * 5) % 10;
    gridLines.forEach((line, i) => {
      const mat = line.material as LineBasicMaterial;
      mat.opacity =
        0.3 + smoothedBass * 0.3 + Math.sin(scaledTime + i * 0.2) * 0.1;
    });

    // Animate particles
    if (
      particles &&
      particleVelocities &&
      particleBaseColors &&
      particleGeometry &&
      particleMaterial
    ) {
      const positions = particleGeometry.attributes.position
        .array as Float32Array;
      const colors = particleGeometry.attributes.color.array as Float32Array;
      const count = particleVelocities.length;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Move forward
        positions[i3 + 2] += particleVelocities[i] * (1 + smoothedBass * 3);

        // Vertical wobble
        positions[i3 + 1] += Math.sin(scaledTime * 2 + i * 0.1) * 0.05;

        // Wrap around
        if (positions[i3 + 2] > 50) {
          positions[i3 + 2] = -150;
          positions[i3] = (Math.random() - 0.5) * 200;
          positions[i3 + 1] = Math.random() * 80 - 10;
        }

        // Color pulse
        const brightness = Math.min(1, 0.5 + smoothedHighs);
        colors[i3] = particleBaseColors[i3] * brightness;
        colors[i3 + 1] = particleBaseColors[i3 + 1] * brightness;
        colors[i3 + 2] = particleBaseColors[i3 + 2] * brightness;
      }

      particleGeometry.attributes.position.needsUpdate = true;
      particleGeometry.attributes.color.needsUpdate = true;
      particleMaterial.size = 1.5 + smoothedBass * 3;
    }

    // Animate horizon
    if (horizonMesh) {
      const scale = 1 + smoothedBass * 0.3 + beatIntensity * 0.2;
      horizonMesh.scale.setScalar(scale);

      // Subtle glow pulse
      const horizonMaterial = horizonMesh.material as ShaderMaterial;
      horizonMaterial.uniforms.uTime.value = scaledTime;
      horizonMaterial.uniforms.uBass.value = smoothedBass;
      horizonMaterial.uniforms.uMids.value = smoothedMids;
      horizonMaterial.uniforms.uHighs.value = smoothedHighs;
    }

    // Camera sway
    const toy = runtimeRef?.toy;
    if (!toy) return;
    toy.camera.position.x = Math.sin(scaledTime * 0.3) * 8;
    toy.camera.position.y =
      25 + Math.sin(scaledTime * 0.2) * 5 + smoothedBass * 10;
    toy.camera.lookAt(0, -10, -40);

    // Render with post-processing
    if (postprocessing) {
      postprocessing.updateSize();
      postprocessing.render();
    } else {
      toy.render();
    }
  }

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 30, z: 80 } },
      lightingOptions: { type: 'PointLight', intensity: 0.5 },
      ambientLightOptions: { intensity: 0.15 },
      rendererOptions: {
        maxPixelRatio: performanceSettings.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      },
    },
    audio: { fftSize: 512 },
    plugins: [
      {
        name: 'neon-wave',
        setup: (runtime) => {
          runtimeRef = runtime;
          const { toy } = runtime;
          toy.scene.add(waveGroup);
          toy.scene.add(gridGroup);
          toy.scene.add(particleGroup);
          toy.scene.add(horizonGroup);

          setupSettingsPanel();
          createWaveMesh();
          createGrid();
          createParticles();
          createHorizon();
          setupPostProcessing(toy);

          toy.rendererReady.then((result) => {
            if (result) {
              result.renderer.setClearColor(palette.background, 1);
            }
          });
          toy.scene.fog = new FogExp2(palette.background, 0.008);
        },
        update: ({ analyser, time }) => {
          animate(analyser, time);
        },
        dispose: () => {
          disposeGeometry(waveGeometry ?? undefined);
          disposeMaterial(waveMaterial);
          disposeGeometry(particleGeometry ?? undefined);
          disposeMaterial(particleMaterial);
          gridLines.forEach((line) => {
            disposeGeometry(line.geometry);
            disposeMaterial(line.material as Material);
          });
          if (horizonMesh) {
            disposeGeometry(horizonMesh.geometry as BufferGeometry);
            disposeMaterial(horizonMesh.material as Material);
          }
          horizonMaskTexture?.dispose();
          horizonMaskTexture = null;
          postprocessing?.dispose();
          settingsPanel.getElement().remove();
        },
      },
    ],
  });

  runtime = startRuntime({ container });
  runtimeRef = runtime;
  performanceSettingsHandler = createPerformanceSettingsHandler({
    applyRendererSettings: (settings) => {
      runtime.toy.updateRendererSettings({
        maxPixelRatio: settings.maxPixelRatio,
        renderScale: quality.activeQuality.renderScale,
      });
    },
    onChange: applyPerformanceSettings,
  });
  performanceSettings = performanceSettingsHandler.getSettings();

  return {
    ...runtime,
    dispose: () => {
      performanceSettingsHandler?.dispose();
      runtime.dispose();
    },
  };
}
