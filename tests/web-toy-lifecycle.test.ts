import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const modulePath = '../assets/js/core/web-toy.ts';
const freshImport = async () => import(`${modulePath}?t=${Date.now()}-${Math.random()}`);

class FakeObject3D {
  children: FakeObject3D[] = [];
  add = (child: FakeObject3D) => {
    this.children.push(child);
  };
  remove = (child: FakeObject3D) => {
    this.children = this.children.filter((c) => c !== child);
  };
  traverse = (callback: (obj: FakeObject3D) => void) => {
    callback(this);
    this.children.forEach((child) => child.traverse(callback));
  };
}

class FakeMesh extends FakeObject3D {
  geometry = { dispose: mock() };
  material = { dispose: mock() };
}

class FakeScene extends FakeObject3D {}

class FakeCamera {
  aspect = 1;
  position = { x: 0, y: 0, z: 0 };
  updateProjectionMatrix = mock();
  lookAt = mock();
}

class FakeRenderer {
  toneMappingExposure = 1;
  setPixelRatio = mock();
  setSize = mock();
  setAnimationLoop = mock();
  dispose = mock();
}

describe('WebToy lifecycle management', () => {
  beforeEach(() => {
    mock.restore();
    document.body.innerHTML = '<div id="active-toy-container"></div>';

    mock.module('../assets/js/utils/webgl-check.js', () => ({ ensureWebGL: () => true }));
    mock.module('../assets/js/core/scene-setup.ts', () => ({
      initScene: mock(() => new FakeScene()),
    }));
    mock.module('../assets/js/core/camera-setup.ts', () => ({
      initCamera: mock(() => new FakeCamera()),
    }));
    mock.module('../assets/js/core/renderer-setup.ts', () => ({
      initRenderer: mock(() =>
        Promise.resolve({
          renderer: new FakeRenderer(),
          backend: 'webgl',
          maxPixelRatio: 2,
          renderScale: 1,
          exposure: 1,
        })
      ),
    }));
    mock.module('../assets/js/lighting/lighting-setup', () => ({
      initAmbientLight: mock(),
      initLighting: mock(),
    }));
    mock.module('three', () => ({
      __esModule: true,
      Scene: FakeScene,
      Camera: FakeCamera,
      Mesh: FakeMesh,
      Object3D: FakeObject3D,
      AudioAnalyser: class {},
      AudioListener: class {},
      Audio: class {},
      PositionalAudio: class {},
    }));
  });

  afterEach(() => {
    mock.restore();
    document.body.innerHTML = '';
  });

  test('multiple instances use the shared host container without global state', async () => {
    const container = document.getElementById('active-toy-container');
    const { default: WebToy } = await freshImport();

    const first = new WebToy();
    const second = new WebToy();

    expect(container?.querySelectorAll('canvas').length).toBe(2);
    expect((globalThis as Record<string, unknown>).__activeWebToy).toBeUndefined();

    first.dispose();
    second.dispose();
  });
});
