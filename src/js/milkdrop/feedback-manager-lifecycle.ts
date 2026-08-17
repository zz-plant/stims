import type { Texture } from 'three';
import type { FeedbackBackendProfile } from './backend-behavior';

/**
 * Render-target surface the shared lifecycle needs. Both the WebGL
 * (WebGLRenderTarget) and WebGPU (three/webgpu RenderTarget) feedback paths
 * satisfy it structurally.
 */
export type FeedbackLifecycleRenderTarget = {
  texture: Texture;
  width: number;
  height: number;
  setSize(width: number, height: number): void;
};

export type FeedbackLifecyclePresentMaterial = {
  uniforms: Record<string, { value: unknown }>;
};

/**
 * The adaptive-quality, transition-blend and target-pair lifecycle shared by
 * both feedback managers. The render/resize/dispose/save bodies differ per
 * backend (different materials, blur targets, teardown lists), so those stay
 * in the subclasses; only this byte-identical state and its accessors live
 * here.
 */
export abstract class MilkdropFeedbackManagerLifecycleBase<
  TTarget extends FeedbackLifecycleRenderTarget,
> {
  protected abstract targets: readonly TTarget[];
  protected abstract presentMaterial: FeedbackLifecyclePresentMaterial;
  protected abstract saveCurrentFrame(): void;
  abstract resize(width: number, height: number): void;

  protected index = 0;
  protected viewportWidth: number;
  protected viewportHeight: number;
  protected sceneResolutionScale: number;
  protected feedbackResolutionScale: number;
  protected currentFeedbackResolutionScale: number;
  protected adaptiveFeedbackResolutionMultiplier = 1;
  protected adaptiveResizeFrameId: number | null = null;

  constructor(width: number, height: number, profile: FeedbackBackendProfile) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.sceneResolutionScale = profile.sceneResolutionScale;
    this.feedbackResolutionScale = profile.feedbackResolutionScale;
    this.currentFeedbackResolutionScale = profile.feedbackResolutionScale;
  }

  get readTarget() {
    return this.targets[this.index];
  }

  get writeTarget() {
    return this.targets[(this.index + 1) % 2];
  }

  getShapeTexture() {
    return this.readTarget.texture;
  }

  setTransitionBlend(alpha: number): void {
    const prevAlpha =
      (this.presentMaterial.uniforms.transitionAlpha?.value as
        | number
        | undefined) ?? 0;
    if (alpha > 0.001 && prevAlpha <= 0.001) {
      this.saveCurrentFrame();
    }
    this.presentMaterial.uniforms.transitionAlpha.value = alpha;
  }

  setAdaptiveQuality({
    feedbackResolutionMultiplier,
  }: Partial<{
    feedbackResolutionMultiplier: number;
  }>) {
    const nextMultiplier = Math.min(
      1.5,
      Math.max(0.45, feedbackResolutionMultiplier ?? 1),
    );
    if (
      Math.abs(nextMultiplier - this.adaptiveFeedbackResolutionMultiplier) <
      0.0001
    ) {
      return;
    }
    const previousFeedbackResolutionScale = this.currentFeedbackResolutionScale;
    this.adaptiveFeedbackResolutionMultiplier = nextMultiplier;
    this.currentFeedbackResolutionScale =
      this.feedbackResolutionScale * this.adaptiveFeedbackResolutionMultiplier;
    if (this.currentFeedbackResolutionScale < previousFeedbackResolutionScale) {
      this.resize(this.viewportWidth, this.viewportHeight);
      return;
    }
    this.scheduleAdaptiveResize();
  }

  private scheduleAdaptiveResize() {
    if (this.adaptiveResizeFrameId !== null) {
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      this.resize(this.viewportWidth, this.viewportHeight);
      return;
    }
    this.adaptiveResizeFrameId = requestAnimationFrame(() => {
      this.adaptiveResizeFrameId = null;
      this.resize(this.viewportWidth, this.viewportHeight);
    });
  }
}
