import * as THREE from 'three';

export interface FeedbackOptions {
  renderer: THREE.WebGLRenderer;
  width?: number;
  height?: number;
  format?: THREE.PixelFormat;
  type?: THREE.TextureDataType;
  minFilter?: THREE.MinificationTextureFilter;
  magFilter?: THREE.MagnificationTextureFilter;
}

/**
 * Manages dual render targets for feedback loop effects (ping-pong rendering).
 */
export class FeedbackManager {
  private renderer: THREE.WebGLRenderer;
  private readBuffer: THREE.WebGLRenderTarget;
  private writeBuffer: THREE.WebGLRenderTarget;
  private width: number;
  private height: number;

  constructor(options: FeedbackOptions) {
    this.renderer = options.renderer;
    this.width = options.width || window.innerWidth;
    this.height = options.height || window.innerHeight;

    const rtOptions: THREE.RenderTargetOptions = {
      format: options.format ?? THREE.RGBAFormat,
      type: options.type ?? THREE.UnsignedByteType,
      minFilter: options.minFilter ?? THREE.LinearFilter,
      magFilter: options.magFilter ?? THREE.LinearFilter,
      stencilBuffer: false,
      depthBuffer: true,
    };

    this.readBuffer = new THREE.WebGLRenderTarget(
      this.width,
      this.height,
      rtOptions,
    );
    this.writeBuffer = new THREE.WebGLRenderTarget(
      this.width,
      this.height,
      rtOptions,
    );
  }

  /**
   * Swap the buffers. The previous write buffer becomes the current read buffer.
   */
  swap() {
    const temp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = temp;
  }

  /**
   * Gets the texture of the current read buffer (the result of the previous frame).
   */
  get texture(): THREE.Texture {
    return this.readBuffer.texture;
  }

  /**
   * Gets the current write buffer.
   */
  get writeTarget(): THREE.WebGLRenderTarget {
    return this.writeBuffer;
  }

  /**
   * Resizes the render targets.
   */
  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.readBuffer.setSize(width, height);
    this.writeBuffer.setSize(width, height);
  }

  /**
   * Performs the render pass into the WRITE buffer.
   */
  render(scene: THREE.Scene, camera: THREE.Camera) {
    const originalTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.writeBuffer);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(originalTarget);
    this.swap();
  }

  dispose() {
    this.readBuffer.dispose();
    this.writeBuffer.dispose();
  }
}

export default FeedbackManager;
