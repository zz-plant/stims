import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createBrandFunAdapter } from '../../brand/fun-adapter';
import { initFunControls } from '../../ui/fun-controls';
import { initHints } from '../../ui/hints';
import {
  type AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import WebToy from '../core/web-toy';
import { showError } from '../utils/error-display';
import { startToyAudio } from '../utils/start-audio';
import { ensureWebGL } from '../utils/webgl-check';

type BrandStartOptions = {
  canvas?: HTMLCanvasElement | null;
  errorElement?: HTMLElement | string | null;
  container?: HTMLElement | null;
};

export async function startBrandToy({
  canvas,
  errorElement,
  container,
}: BrandStartOptions = {}) {
  const errorTargetId =
    typeof errorElement === 'string'
      ? errorElement
      : (errorElement?.id ?? 'error-message');
  
  const hasRenderingSupport = ensureWebGL({
    title: 'WebGL/WebGPU required for the Star Guitar visualizer',
    description:
      'This scene uses GPU acceleration for its neon skyline. Enable hardware acceleration or try a modern browser to continue.',
    previewLabel: 'Static preview (audio-reactive motion paused)',
  });

  if (!hasRenderingSupport) {
    showError(
      errorTargetId,
      'This visualizer needs WebGL or WebGPU. Try switching browsers or enabling hardware acceleration.',
    );
    return null;
  }

  initHints({
    id: 'brand-visualizer',
    tips: [
      'Play music or tap to trigger sparkles.',
      'Switch to Party Mode for bigger motion.',
    ],
  });

  const toy = new WebToy({
    canvas: canvas ?? container?.querySelector('canvas'),
    cameraOptions: {
      fov: 75,
      position: { x: 0, y: 2, z: 5 },
    },
    rendererOptions: {
      antialias: true,
      exposure: 1.2,
      maxPixelRatio: 2,
    },
    ambientLightOptions: { color: 0xffffff, intensity: 0.5 },
    lightingOptions: {
      type: 'DirectionalLight',
      color: 0xffddaa,
      intensity: 0.8,
      position: { x: 0, y: 50, z: -50 },
    },
  });

  toy.scene.fog = new THREE.Fog(0x000000, 10, 200);
  toy.camera.rotation.x = -0.05;

  const skyGeo = new THREE.SphereGeometry(500, 32, 15);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: `
                varying vec2 vUV;
                void main() {
                    vUV = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                }
            `,
    fragmentShader: `
                varying vec2 vUV;
                void main() {
                    vec3 skyColor = mix(vec3(0.1, 0.2, 0.5), vec3(0.8, 0.9, 1.0), vUV.y);
                    gl_FragColor = vec4( skyColor, 1.0 );
                }
            `,
    side: THREE.BackSide,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  toy.scene.add(sky);

  const groundGeo = new THREE.PlaneGeometry(1000, 1000);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  toy.scene.add(ground);

  const elements: Array<{ type: string; x: number; z: number; scale: number }> =
    [];
  const types = ['building', 'tree', 'pole'] as const;
  for (let i = 0; i < 100; i++) {
    const z = -Math.random() * 300;
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (Math.random() * 10 + 5);
    const type = types[Math.floor(Math.random() * types.length)];
    elements.push({ type, x, z, scale: Math.random() * 1.5 + 2 });
  }

  const buildingData = elements.filter((e) => e.type === 'building');
  const treeData = elements.filter((e) => e.type === 'tree');
  const poleData = elements.filter((e) => e.type === 'pole');

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const buildingMesh = new THREE.InstancedMesh(
    buildingGeo,
    buildingMat,
    buildingData.length,
  );
  buildingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  buildingMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(buildingData.length * 3),
    3,
  );
  toy.scene.add(buildingMesh);

  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.1, 1);
  const leavesGeo = new THREE.ConeGeometry(0.5, 1.5, 8);
  leavesGeo.translate(0, 0.5, 0);
  const trunkColor = new THREE.Color(0x8b4513);
  const trunkColors = new Float32Array(trunkGeo.attributes.position.count * 3);
  for (let i = 0; i < trunkColors.length; i += 3) {
    trunkColors[i] = trunkColor.r;
    trunkColors[i + 1] = trunkColor.g;
    trunkColors[i + 2] = trunkColor.b;
  }
  trunkGeo.setAttribute('color', new THREE.BufferAttribute(trunkColors, 3));
  const leavesColor = new THREE.Color(0x228b22);
  const leavesColors = new Float32Array(
    leavesGeo.attributes.position.count * 3,
  );
  for (let i = 0; i < leavesColors.length; i += 3) {
    leavesColors[i] = leavesColor.r;
    leavesColors[i + 1] = leavesColor.g;
    leavesColors[i + 2] = leavesColor.b;
  }
  leavesGeo.setAttribute('color', new THREE.BufferAttribute(leavesColors, 3));
  const treeGeo = BufferGeometryUtils.mergeGeometries([trunkGeo, leavesGeo]);
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, treeData.length);
  treeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  toy.scene.add(treeMesh);

  const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, poleData.length);
  poleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  toy.scene.add(poleMesh);

  const adapter = createBrandFunAdapter({
    buildingMesh,
    treeMaterial: treeMat,
    poleMaterial: poleMat,
  });

  const funControls = initFunControls({
    paletteOptions: adapter.paletteOptions,
    onPaletteChange: (palette, colors) => {
      adapter.setPalette(palette, colors);
    },
    onMotionChange: (intensity, mode) => {
      adapter.setMotion(intensity, mode);
    },
    onAudioToggle: (enabled) => {
      adapter.setAudioReactive(enabled);
    },
  });

  const dummy = new THREE.Object3D();
  buildingData.forEach((d, i) => {
    dummy.position.set(d.x, 0, d.z);
    dummy.scale.set(1, d.scale, 1);
    dummy.updateMatrix();
    buildingMesh.setMatrixAt(i, dummy.matrix);
    const color = new THREE.Color(Math.random() * 0xffffff);
    buildingMesh.instanceColor?.setXYZ(i, color.r, color.g, color.b);
  });
  buildingMesh.instanceMatrix.needsUpdate = true;
  buildingMesh.instanceColor!.needsUpdate = true;

  treeData.forEach((d, i) => {
    dummy.position.set(d.x, 0, d.z);
    dummy.scale.setScalar(d.scale / 3);
    dummy.updateMatrix();
    treeMesh.setMatrixAt(i, dummy.matrix);
  });
  treeMesh.instanceMatrix.needsUpdate = true;

  poleData.forEach((d, i) => {
    dummy.position.set(d.x, 0, d.z);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
  });
  poleMesh.instanceMatrix.needsUpdate = true;

  const animate = (ctx: AnimationContext) => {
    const dataArray = getContextFrequencyData(ctx);
    const bassBand = dataArray.slice(
      0,
      Math.max(1, Math.min(10, dataArray.length)),
    );
    const bass = bassBand.length
      ? bassBand.reduce((a, b) => a + b, 0) / bassBand.length
      : 0;

    const speed = adapter.computeSpeed(bass);
    buildingData.forEach((d, i) => {
      d.z += speed;
      if (d.z > 5) {
        d.z -= 300;
        d.x = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 10 + 5);
      }
      dummy.position.set(d.x, 0, d.z);
      dummy.scale.set(1, d.scale, 1);
      dummy.updateMatrix();
      buildingMesh.setMatrixAt(i, dummy.matrix);
    });
    buildingMesh.instanceMatrix.needsUpdate = true;

    treeData.forEach((d, i) => {
      d.z += speed;
      if (d.z > 5) {
        d.z -= 300;
        d.x = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 10 + 5);
      }
      dummy.position.set(d.x, 0, d.z);
      dummy.scale.setScalar(d.scale / 3);
      dummy.updateMatrix();
      treeMesh.setMatrixAt(i, dummy.matrix);
    });
    treeMesh.instanceMatrix.needsUpdate = true;

    poleData.forEach((d, i) => {
      d.z += speed;
      if (d.z > 5) {
        d.z -= 300;
        d.x = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 10 + 5);
      }
      dummy.position.set(d.x, 0, d.z);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);
    });
    poleMesh.instanceMatrix.needsUpdate = true;

    ctx.toy.render();
  };

  async function startAudio(request: any = false) {
     return startToyAudio(toy, animate, {
      positional: true,
      object: toy.camera,
      fallbackToSynthetic: request === true,
      preferSynthetic: request === 'sample' || request === true
    }).catch((err) => {
      console.error('Audio input error: ', err);
      funControls.setAudioAvailable(false);
      showError(
        errorTargetId,
        'Microphone access is unavailable. Visuals will run without audio reactivity.',
      );
      const silentContext = { toy, analyser: null, time: 0 } as const;
      toy.renderer?.setAnimationLoop(() => animate(silentContext as any));
      return null;
    });
  }

  // Register globals for toy.html buttons
  const win = (container?.ownerDocument.defaultView ?? window) as any;
  win.startAudio = startAudio;
  win.startAudioFallback = () => startAudio(true);

  // If we have no auto-start, we wait for the UI.
  // But brand.ts used to auto-start.
  // To keep compatibility, we can try to start audio if allowed.
  startAudio().catch(() => {
    // Expected if no gesture
  });

  return {
    dispose: () => {
      toy.renderer?.setAnimationLoop(null);
      toy.dispose();
      win.startAudio = undefined;
      win.startAudioFallback = undefined;
    },
  };
}

export function start({ container }: { container?: HTMLElement | null } = {}) {
  return startBrandToy({
    container,
    canvas: container?.querySelector('canvas'),
    errorElement: container?.querySelector<HTMLElement>('#error-message')
  });
}

export function bootstrapBrandPage() {
  return startBrandToy();
}
