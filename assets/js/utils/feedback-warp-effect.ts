import * as THREE from 'three';
import FeedbackManager from './feedback-manager';
import WarpShader from './warp-shader';

export function createFeedbackWarpEffect(renderer: THREE.WebGLRenderer) {
  const feedback = new FeedbackManager({ renderer });
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const warpMaterial = new THREE.ShaderMaterial({
    ...WarpShader,
    uniforms: THREE.UniformsUtils.clone(WarpShader.uniforms),
  });
  warpMaterial.uniforms.tDiffuse.value = feedback.texture;
  warpMaterial.uniforms.uResolution.value.set(
    window.innerWidth,
    window.innerHeight,
  );

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMaterial);
  overlayScene.add(quad);

  const render = ({
    scene,
    camera,
    time,
    intensity,
  }: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    time: number;
    intensity: number;
  }) => {
    warpMaterial.uniforms.uTime.value = time;
    warpMaterial.uniforms.uAudioIntensity.value = intensity;
    warpMaterial.uniforms.uZoom.value = 1.0 + Math.sin(time * 0.5) * 0.02;
    warpMaterial.uniforms.uRotation.value = Math.sin(time * 0.2) * 0.01;

    renderer.setRenderTarget(feedback.writeTarget);
    renderer.clear();
    renderer.render(overlayScene, overlayCamera);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;

    renderer.setRenderTarget(null);
    renderer.render(overlayScene, overlayCamera);

    feedback.swap();
    warpMaterial.uniforms.tDiffuse.value = feedback.texture;
  };

  const resize = (width: number, height: number) => {
    feedback.setSize(width, height);
    warpMaterial.uniforms.uResolution.value.set(width, height);
  };

  const dispose = () => {
    feedback.dispose();
    warpMaterial.dispose();
    quad.geometry.dispose();
  };

  return { render, resize, dispose };
}
