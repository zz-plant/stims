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
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  type AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import {
  getActivePerformanceSettings,
  getPerformancePanel,
  type PerformanceSettings,
  subscribeToPerformanceSettings,
} from '../core/performance-panel';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  PersistentSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import { registerToyGlobals } from '../core/toy-globals';
import type { ToyConfig } from '../core/types';
import WebToy from '../core/web-toy';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import { startToyAudio } from '../utils/start-audio';

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
  let activeQuality: QualityPreset = getActiveQualityPreset();
  let performanceSettings: PerformanceSettings = getActivePerformanceSettings();
  let currentTheme: NeonTheme = 'synthwave';
  let palette = THEMES[currentTheme];

  const toy = new WebToy({
    cameraOptions: { position: { x: 0, y: 30, z: 80 } },
    lightingOptions: { type: 'PointLight', intensity: 0.5 },
    ambientLightOptions: { intensity: 0.15 },
    rendererOptions: {
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    },
    canvas: container?.querySelector('canvas'),
    container,
  } as ToyConfig);

  // Post-processing
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;

  // Scene elements
  const waveGroup = new Group();
  const gridGroup = new Group();
  const particleGroup = new Group();
  const horizonGroup = new Group();

  toy.scene.add(waveGroup);
  toy.scene.add(gridGroup);
  toy.scene.add(particleGroup);
  toy.scene.add(horizonGroup);

  // Audio smoothing
  let smoothedBass = 0;
  let smoothedMids = 0;
  let smoothedHighs = 0;
  let beatIntensity = 0;
  let lastBeatTime = 0;

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
      (activeQuality.particleScale ?? 1) * performanceSettings.particleBudget;
    return {
      widthSegments: Math.max(32, Math.round(96 * scale)),
      heightSegments: Math.max(32, Math.round(96 * scale)),
    };
  }

  function getParticleCount() {
    const scale =
      (activeQuality.particleScale ?? 1) * performanceSettings.particleBudget;
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
      waveGeometry?.dispose();
      waveMaterial?.dispose();
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
      line.geometry.dispose();
      (line.material as Material).dispose();
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
      particleGeometry?.dispose();
      particleMaterial?.dispose();
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
      (horizonMesh.geometry as BufferGeometry).dispose();
      (horizonMesh.material as Material).dispose();
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

  function setupPostProcessing() {
    toy.rendererReady.then((result) => {
      if (!result) return;

      const { renderer } = result;
      // Only set up post-processing with WebGLRenderer (not WebGPURenderer)
      if (!('capabilities' in renderer && 'extensions' in renderer)) return;

      const webglRenderer = renderer as WebGLRenderer;
      composer = new EffectComposer(webglRenderer);

      const renderPass = new RenderPass(toy.scene, toy.camera);
      composer.addPass(renderPass);

      const size = webglRenderer.getSize(new Vector2());
      bloomPass = new UnrealBloomPass(
        new Vector2(size.x, size.y),
        palette.bloomStrength,
        0.4,
        0.85,
      );
      composer.addPass(bloomPass);
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
    if (bloomPass) {
      bloomPass.strength = palette.bloomStrength;
    }

    // Update background
    toy.rendererReady.then((result) => {
      if (result) {
        result.renderer.setClearColor(palette.background, 1);
      }
    });

    updateThemeButtons();
  }

  function updateThemeButtons() {
    const buttons = container?.querySelectorAll('[data-neon-theme]');
    buttons?.forEach((btn) => {
      const theme = btn.getAttribute('data-neon-theme');
      btn.classList.toggle('active', theme === currentTheme);
    });
  }

  function detectBeat(bass: number, time: number): boolean {
    const threshold = 0.55;
    const minInterval = 150;
    if (bass > threshold && time - lastBeatTime > minInterval) {
      lastBeatTime = time;
      return true;
    }
    return false;
  }

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
      renderScale: preset.renderScale,
    });
    createWaveMesh();
    createParticles();
  }

  function applyPerformanceSettings(settings: PerformanceSettings) {
    performanceSettings = settings;
    toy.updateRendererSettings({
      maxPixelRatio: settings.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    });
    createWaveMesh();
    createParticles();
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: 'Neon Wave',
      description:
        'Premium retro-wave visualizer with bloom effects. Pick a theme!',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });

    // Add theme buttons
    const themeRow = document.createElement('div');
    themeRow.className = 'control-panel__row';
    themeRow.style.cssText =
      'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;';

    const themes: NeonTheme[] = ['synthwave', 'cyberpunk', 'arctic', 'sunset'];
    themes.forEach((theme) => {
      const btn = document.createElement('button');
      btn.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
      btn.setAttribute('data-neon-theme', theme);
      btn.className = theme === currentTheme ? 'active' : '';
      btn.style.cssText = `
        padding: 6px 12px;
        border: 1px solid currentColor;
        background: transparent;
        color: inherit;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      `;
      btn.addEventListener('click', () => applyTheme(theme));
      themeRow.appendChild(btn);
    });

    const panel = container?.querySelector('.control-panel');
    panel?.appendChild(themeRow);
  }

  function setupPerformancePanel() {
    getPerformancePanel({
      title: 'Performance',
      description: 'Balance visual fidelity and frame rate.',
    });
    return subscribeToPerformanceSettings(applyPerformanceSettings);
  }

  function animate(ctx: AnimationContext) {
    // const data = getContextFrequencyData(ctx);
    const time = ctx.time / 1000;

    // Multi-band frequency analysis using FrequencyAnalyser
    const energy = ctx.analyser
      ? ctx.analyser.getMultiBandEnergy()
      : { bass: 0, mid: 0, treble: 0 };

    const bass = energy.bass;
    const mids = energy.mid;
    const highs = energy.treble;

    smoothedBass = smoothedBass * 0.85 + bass * 0.15;
    smoothedMids = smoothedMids * 0.9 + mids * 0.1;
    smoothedHighs = smoothedHighs * 0.92 + highs * 0.08;

    // Beat detection
    if (detectBeat(smoothedBass, ctx.time)) {
      beatIntensity = 1;
    }
    beatIntensity *= 0.92;

    // Update wave shader uniforms
    if (waveMaterial) {
      waveMaterial.uniforms.uTime.value = time;
      waveMaterial.uniforms.uBass.value = smoothedBass;
      waveMaterial.uniforms.uMids.value = smoothedMids;
      waveMaterial.uniforms.uHighs.value = smoothedHighs;
      waveMaterial.uniforms.uBeat.value = beatIntensity;
    }

    // Animate grid
    gridGroup.position.z = (time * 5) % 10;
    gridLines.forEach((line, i) => {
      const mat = line.material as LineBasicMaterial;
      mat.opacity = 0.3 + smoothedBass * 0.3 + Math.sin(time + i * 0.2) * 0.1;
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
        positions[i3 + 1] += Math.sin(time * 2 + i * 0.1) * 0.05;

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
    toy.camera.position.x = Math.sin(time * 0.3) * 8;
    toy.camera.position.y = 25 + Math.sin(time * 0.2) * 5 + smoothedBass * 10;
    toy.camera.lookAt(0, -10, -40);

    // Render with post-processing
    if (composer) {
      composer.render();
    } else {
      ctx.toy.render();
    }
  }

  async function startAudio(request: ToyAudioRequest = false) {
    return startToyAudio(
      toy,
      animate,
      resolveToyAudioOptions(request, { fftSize: 512 }),
    );
  }

  // Initialize
  setupSettingsPanel();
  const perfUnsub = setupPerformancePanel();
  createWaveMesh();
  createGrid();
  createParticles();
  createHorizon();
  setupPostProcessing();

  // Set initial background
  toy.rendererReady.then((result) => {
    if (result) {
      result.renderer.setClearColor(palette.background, 1);
    }
  });

  // Fog for depth
  toy.scene.fog = new FogExp2(palette.background, 0.008);

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    dispose: () => {
      toy.dispose();
      waveGeometry?.dispose();
      waveMaterial?.dispose();
      particleGeometry?.dispose();
      particleMaterial?.dispose();
      gridLines.forEach((line) => {
        line.geometry.dispose();
        (line.material as Material).dispose();
      });
      if (horizonMesh) {
        (horizonMesh.geometry as BufferGeometry).dispose();
        (horizonMesh.material as Material).dispose();
      }
      composer?.dispose();
      perfUnsub();
      unregisterGlobals();
      settingsPanel.getElement().remove();
    },
  };
}
