import {
  AmbientLight,
  Color,
  CylinderGeometry,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  Vector2,
} from 'three';
import { createUnifiedInput, createWebGLRenderer, ensureWebGL } from '../utils';

type ClayStartOptions = {
  container?: HTMLElement | null;
};

export function startClayToy({ container }: ClayStartOptions = {}) {
  if (!ensureWebGL()) {
    throw new Error('WebGL support is required for the clay toy.');
  }

  const scene = new Scene();
  scene.background = new Color(0x222222);

  const camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 8, 10);
  camera.lookAt(0, 5, 0);

  const renderer = createWebGLRenderer({
    antialias: true,
    powerPreference: 'default', // Better battery life on mobile
    failIfMajorPerformanceCaveat: false, // Don't fail on mobile GPU limitations
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  (container ?? document.body).appendChild(renderer.domElement);

  const ambientLight = new AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const spotLight = new SpotLight(0xffffff, 1);
  spotLight.position.set(15, 40, 35);
  spotLight.angle = Math.PI / 4;
  spotLight.penumbra = 0.1;
  spotLight.decay = 2;
  spotLight.distance = 200;
  spotLight.castShadow = true;
  scene.add(spotLight);

  const wheelGeometry = new CylinderGeometry(6, 6, 1, 64);
  const wheelMaterial = new MeshStandardMaterial({
    color: 0x555555,
  });
  const wheelMesh = new Mesh(wheelGeometry, wheelMaterial);
  wheelMesh.position.y = 0.5;
  wheelMesh.receiveShadow = true;
  scene.add(wheelMesh);

  const groundGeometry = new PlaneGeometry(200, 200);
  const groundMaterial = new MeshStandardMaterial({
    color: 0x333333,
  });
  const groundMesh = new Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const maxRadius = 5;
  const minRadius = 0.5;
  const height = 12;
  const segments = 100;
  let potteryMesh!: Mesh<LatheGeometry, MeshStandardMaterial>;

  function createClay() {
    const profilePoints: Vector2[] = [];
    const step = height / segments;
    for (let i = 0; i <= segments; i++) {
      const y = i * step;
      const radius = maxRadius;
      profilePoints.push(new Vector2(radius, y));
    }

    const clayGeometry = new LatheGeometry(profilePoints, 200);
    clayGeometry.computeVertexNormals();

    const clayMaterial = new MeshStandardMaterial({
      color: 0xd2a679,
      roughness: 0.6,
      metalness: 0.3,
    });

    if (potteryMesh) {
      scene.remove(potteryMesh);
      potteryMesh.geometry.dispose();
      potteryMesh.material.dispose();
    }

    potteryMesh = new Mesh(clayGeometry, clayMaterial);
    potteryMesh.position.y = 0;
    potteryMesh.castShadow = true;
    potteryMesh.receiveShadow = true;
    scene.add(potteryMesh);
  }

  createClay();

  let isInteracting = false;
  let previousPointer: { clientY: number; normalizedY: number } | null = null;
  let currentTool: 'smooth' | 'carve' | 'pinch' = 'smooth';

  function deformClay(deltaY: number, normalizedY: number) {
    const pointerHeight = ((1 - normalizedY) / 2) * height;

    const influenceRadius = 1.5;
    const deformationStrength = deltaY * 0.05;

    const positions = potteryMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const distance = Math.abs(y - pointerHeight);
      if (distance < influenceRadius) {
        const factor = deformationStrength * (1 - distance / influenceRadius);
        let x = positions.getX(i);
        let z = positions.getZ(i);
        const radius = Math.sqrt(x * x + z * z);
        const angle = Math.atan2(z, x);
        let newRadius = radius + factor;

        switch (currentTool) {
          case 'smooth':
            newRadius = MathUtils.lerp(radius, newRadius, 0.5);
            break;
          case 'carve':
            newRadius = radius - Math.abs(factor);
            break;
          case 'pinch':
            newRadius = radius + factor;
            break;
        }

        newRadius = MathUtils.clamp(newRadius, minRadius, maxRadius);
        x = newRadius * Math.cos(angle);
        z = newRadius * Math.sin(angle);
        positions.setX(i, x);
        positions.setZ(i, z);
      }
    }

    positions.needsUpdate = true;
    potteryMesh.geometry.computeVertexNormals();
  }

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('resize', handleResize, false);
  const domElement = renderer.domElement;
  domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  const unifiedInput = createUnifiedInput({
    target: domElement,
    boundsElement: domElement,
    onInput: (state) => {
      if (state.justPressed && state.primary) {
        isInteracting = true;
        previousPointer = {
          clientY: state.primary.clientY,
          normalizedY: state.primary.normalizedY,
        };
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }

      if (state.justReleased) {
        isInteracting = false;
        previousPointer = null;
      }

      if (isInteracting && state.primary && previousPointer) {
        const deltaY = state.primary.clientY - previousPointer.clientY;
        deformClay(deltaY, state.primary.normalizedY);

        if (navigator.vibrate) {
          const intensity = Math.min(Math.abs(deltaY), 100);
          navigator.vibrate(intensity);
        }

        previousPointer = {
          clientY: state.primary.clientY,
          normalizedY: state.primary.normalizedY,
        };
      }

      if (state.pointerCount > 0) {
        resetUITimeout();
      }
    },
  });

  const uiElement = document.getElementById('ui');
  const resetButton = document.getElementById('resetButton');
  resetButton?.addEventListener('click', createClay);
  document.querySelectorAll('#toolPanel button').forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.getAttribute('data-tool');
      if (tool === 'smooth' || tool === 'carve' || tool === 'pinch') {
        currentTool = tool;
      }
    });
  });

  let uiTimeout: number | undefined;
  function resetUITimeout() {
    if (uiTimeout !== undefined) {
      window.clearTimeout(uiTimeout);
    }
    if (uiElement) {
      uiElement.style.opacity = '0.95';
    }
    uiTimeout = window.setTimeout(() => {
      if (uiElement) {
        uiElement.style.opacity = '0.2';
      }
    }, 3000);
  }
  resetUITimeout();
  const animate = () => {
    const rotationSpeed = 0.02;
    wheelMesh.rotation.y += rotationSpeed;
    potteryMesh.rotation.y += rotationSpeed;

    renderer.render(scene, camera);
  };

  renderer.setAnimationLoop(animate);

  return {
    dispose: () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', handleResize, false);
      unifiedInput.dispose();
      resetButton?.removeEventListener('click', createClay);
      renderer.dispose();
      scene.clear();
      renderer.domElement.remove();
    },
  };
}

export function start({ container }: ClayStartOptions = {}) {
  return startClayToy({ container });
}

export function bootstrapClayPage() {
  return startClayToy();
}
