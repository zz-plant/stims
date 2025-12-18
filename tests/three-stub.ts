export class Vector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class BaseLight {
  position = new Vector3();
  set castShadow(_value: boolean) {}
}

export class DirectionalLight extends BaseLight {}
export class SpotLight extends BaseLight {}
export class HemisphereLight extends BaseLight {}
export class PointLight extends BaseLight {}
export class AmbientLight extends BaseLight {}
export class Light extends BaseLight {}

export class Scene {
  children: unknown[] = [];

  add(light: unknown) {
    this.children.push(light);
  }
}
