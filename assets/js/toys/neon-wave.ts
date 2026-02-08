import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
} from '../core/performance-panel';
import {
  createBloomComposer,
  isWebGLRenderer,
  type PostprocessingPipeline,
} from '../core/postprocessing';
import { PersistentSettingsPanel } from '../core/settings-panel';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import type { FrequencyAnalyser } from '../utils';
import {
  buildToySettingsPanelWithPerformance,
  createBeatTracker,
  createPerformanceSettingsHandler,
  createToyQualityControls,
  createToyRuntimeStarter,
  disposeGeometry,
  disposeMaterial,
} from '../utils';

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

export function start({ container }: { container?: HTMLElement | null } = {}) {
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

  // Horizon sun/moon
  let horizonMesh: Mesh | null = null;

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
      
      // Pulsing glow
      float pulse = 0.8 + sin(uTime * 2.0) * 0.2 * uBass;
      
      gl_FragColor = vec4(color * pulse, edgeFade * 0.9);
    }
  `;

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

    const geometry = new CircleGeometry(25, 64);
    const material = new MeshBasicMaterial({
      color: palette.accent,
      transparent: true,
      opacity: 0.9,
    });

    horizonMesh = new Mesh(geometry, material);
    horizonMesh.position.set(0, 10, -120);
    horizonGroup.add(horizonMesh);
  }

  function setupPostProcessing(toy: ToyRuntimeInstance['toy']) {
    toy.rendererReady.then((result) => {
      if (!result) return;

      const { renderer } = result;
      // Only set up post-processing with WebGLRenderer (not WebGPURenderer)
      if (!isWebGLRenderer(renderer)) return;

      postprocessing = createBloomComposer({
        renderer,
        scene: toy.scene,
        camera: toy.camera,
        bloomStrength: palette.bloomStrength,
        bloomRadius: 0.4,
        bloomThreshold: 0.85,
      });
    });
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
      (horizonMesh.material as MeshBasicMaterial).color.setHex(palette.accent);
    }

    // Update bloom
    if (postprocessing?.bloomPass) {
      postprocessing.bloomPass.strength = palette.bloomStrength;
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
        colors[i3] *= brightness;
        colors[i3 + 1] *= brightness;
        colors[i3 + 2] *= brightness;
      }

      particleGeometry.attributes.position.needsUpdate = true;
      particleMaterial.size = 1.5 + smoothedBass * 3;
    }

    // Animate horizon
    if (horizonMesh) {
      const scale = 1 + smoothedBass * 0.3 + beatIntensity * 0.2;
      horizonMesh.scale.setScalar(scale);

      // Subtle glow pulse
      (horizonMesh.material as MeshBasicMaterial).opacity =
        0.7 + smoothedMids * 0.3;
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
