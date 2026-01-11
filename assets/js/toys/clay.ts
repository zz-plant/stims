import * as THREE from 'three';
import { ensureWebGL } from '../utils/webgl-check';

type ClayStartOptions = {
  container?: HTMLElement | null;
};

export function startClayToy({ container }: ClayStartOptions = {}) {
  if (!ensureWebGL()) {
    throw new Error('WebGL support is required for the clay toy.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 8, 10);
  camera.lookAt(0, 5, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  (container ?? document.body).appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const spotLight = new THREE.SpotLight(0xffffff, 1);
  spotLight.position.set(15, 40, 35);
  spotLight.angle = Math.PI / 4;
  spotLight.penumbra = 0.1;
  spotLight.decay = 2;
  spotLight.distance = 200;
  spotLight.castShadow = true;
  scene.add(spotLight);

  const wheelGeometry = new THREE.CylinderGeometry(6, 6, 1, 64);
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x555555,
  });
  const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
  wheelMesh.position.y = 0.5;
  wheelMesh.receiveShadow = true;
  scene.add(wheelMesh);

  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const maxRadius = 5;
  const minRadius = 0.5;
  const height = 12;
  const segments = 100;
  let potteryMesh!: THREE.Mesh<THREE.LatheGeometry, THREE.MeshStandardMaterial>;

  function createClay() {
    const profilePoints: THREE.Vector2[] = [];
    const step = height / segments;
    for (let i = 0; i <= segments; i++) {
      const y = i * step;
      const radius = maxRadius;
      profilePoints.push(new THREE.Vector2(radius, y));
    }

    const clayGeometry = new THREE.LatheGeometry(profilePoints, 200);
    clayGeometry.computeVertexNormals();

    const clayMaterial = new THREE.MeshStandardMaterial({
      color: 0xd2a679,
      roughness: 0.6,
      metalness: 0.3,
    });

    if (potteryMesh) {
      scene.remove(potteryMesh);
      potteryMesh.geometry.dispose();
      potteryMesh.material.dispose();
    }

    potteryMesh = new THREE.Mesh(clayGeometry, clayMaterial);
    potteryMesh.position.y = 0;
    potteryMesh.castShadow = true;
    potteryMesh.receiveShadow = true;
    scene.add(potteryMesh);
  }

  createClay();

  let isInteracting = false;
  let previousTouches: Array<{ x: number; y: number }> = [];
  let currentTool: 'smooth' | 'carve' | 'pinch' = 'smooth';

  function getTouchPosition(event: PointerEvent) {
    return { x: event.clientX, y: event.clientY };
  }

  function deformClay(deltaY: number, pointerY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    const normalizedY = ((pointerY - rect.top) / rect.height) * height;

    const influenceRadius = 1.5;
    const deformationStrength = deltaY * 0.05;

    const positions = potteryMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const distance = Math.abs(y - normalizedY);
      if (distance < influenceRadius) {
        const factor = deformationStrength * (1 - distance / influenceRadius);
        let x = positions.getX(i);
        let z = positions.getZ(i);
        const radius = Math.sqrt(x * x + z * z);
        const angle = Math.atan2(z, x);
        let newRadius = radius + factor;

        switch (currentTool) {
          case 'smooth':
            newRadius = THREE.MathUtils.lerp(radius, newRadius, 0.5);
            break;
          case 'carve':
            newRadius = radius - Math.abs(factor);
            break;
          case 'pinch':
            newRadius = radius + factor;
            break;
        }

        newRadius = THREE.MathUtils.clamp(newRadius, minRadius, maxRadius);
        x = newRadius * Math.cos(angle);
        z = newRadius * Math.sin(angle);
        positions.setX(i, x);
        positions.setZ(i, z);
      }
    }

    positions.needsUpdate = true;
    potteryMesh.geometry.computeVertexNormals();
  }

  const handlePointerDown = (event: PointerEvent) => {
    isInteracting = true;
    previousTouches = [getTouchPosition(event)];
    if (event.target instanceof HTMLElement) {
      event.target.setPointerCapture(event.pointerId);
    }

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    isInteracting = false;
    previousTouches = [];
    if (event.target instanceof HTMLElement) {
      event.target.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (isInteracting) {
      const currentTouches = [getTouchPosition(event)];
      if (previousTouches.length === currentTouches.length) {
        if (currentTouches.length === 1) {
          const deltaY = currentTouches[0].y - previousTouches[0].y;
          deformClay(deltaY, currentTouches[0].y);
        }

        if (navigator.vibrate) {
          const intensity = Math.min(
            Math.abs(currentTouches[0].y - previousTouches[0].y),
            100,
          );
          navigator.vibrate(intensity);
        }
      }

      previousTouches = currentTouches;
    }
  };

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('resize', handleResize, false);
  const domElement = renderer.domElement;
  domElement.addEventListener('pointerdown', handlePointerDown, false);
  domElement.addEventListener('pointerup', handlePointerUp, false);
  domElement.addEventListener('pointermove', handlePointerMove, false);
  domElement.addEventListener('contextmenu', (event) => event.preventDefault());

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
      uiElement.style.opacity = '1';
    }
    uiTimeout = window.setTimeout(() => {
      if (uiElement) {
        uiElement.style.opacity = '0';
      }
    }, 3000);
  }
  resetUITimeout();
  document.addEventListener('pointermove', resetUITimeout);
  document.addEventListener('pointerdown', resetUITimeout);

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
      domElement.removeEventListener('pointerdown', handlePointerDown, false);
      domElement.removeEventListener('pointerup', handlePointerUp, false);
      domElement.removeEventListener('pointermove', handlePointerMove, false);
      document.removeEventListener('pointermove', resetUITimeout);
      document.removeEventListener('pointerdown', resetUITimeout);
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
