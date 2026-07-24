import { Color, Scene } from 'three';

export type SceneConfig = {
  backgroundColor?: number;
};

export function initScene(config: SceneConfig = { backgroundColor: 0x000000 }) {
  const scene = new Scene();
  const backgroundColor = config.backgroundColor ?? 0x000000;
  scene.background = new Color(backgroundColor);
  return scene;
}
