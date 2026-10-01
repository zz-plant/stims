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
  dispose(): void;
};

/** One target in a resize: its new size, and whether its picture must survive. */
export type FeedbackTargetResize<TTarget> = {
  target: TTarget | null;
  width: number;
  height: number;
  keepImage: boolean;
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
  abstract resize(width: number, height: number): void;
  /**
   * Draws `source` into `destination`, resampled to the destination's size.
   * False when there is no renderer yet, i.e. nothing has ever been drawn and
   * there is no picture to keep.
   */
  protected abstract copyTargetImage(
    source: TTarget,
    destination: TTarget,
  ): boolean;
  /** A target with `like`'s current size and texel format. */
  protected abstract createScratchTarget(like: TTarget): TTarget;

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

  /**
   * Sets how much of the saved frame the present pass dissolves over the live
   * one. It never takes the snapshot itself: the caller does, once, when the
   * switch begins (`saveCurrentFrame`). Snapshotting here on every 0 → >0
   * edge re-captured the frame at the wrong moment twice over — after a
   * quality-step resize had already emptied the targets (the "every preset
   * fades in from black" bug), and after a gated mid-blend frame had drawn
   * the incoming preset, replacing the outgoing picture with the new one.
   */
  setTransitionBlend(alpha: number): void {
    this.presentMaterial.uniforms.transitionAlpha.value = alpha;
    // Keeps the dissolve pattern's aspect correction in sync with the
    // viewport; set here (once per blend frame) rather than on resize so
    // both backends stay covered without touching their resize paths.
    const aspectUniform = this.presentMaterial.uniforms.patternAspect;
    if (aspectUniform) {
      aspectUniform.value =
        this.viewportWidth / Math.max(1, this.viewportHeight);
    }
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

  /**
   * Resizes render targets without losing their pictures.
   *
   * three.js discards a target's contents whenever its size changes, and
   * some of these targets are the visual's memory: the feedback history every
   * frame warps, the snapshot a crossfade dissolves out of, the blur levels
   * the next composite samples. Adaptive quality resizes them on a preset
   * switch and again when it earns the step back, so dropping their contents
   * made every switch fade in from black and blanked the picture mid-preset.
   *
   * A kept target's picture goes out to a scratch copy at the old size, the
   * target resizes, and the picture comes back resampled to the new size.
   * setSize keeps the Texture object, so nothing bound to it needs rebinding.
   * Targets every frame rewrites before reading are resized plainly.
   */
  protected resizeTargets(
    resizes: ReadonlyArray<FeedbackTargetResize<TTarget>>,
  ) {
    for (const { target, width, height, keepImage } of resizes) {
      if (!target) continue;
      if (target.width === width && target.height === height) continue;
      if (!keepImage) {
        target.setSize(width, height);
        continue;
      }
      const scratch = this.createScratchTarget(target);
      const saved = this.copyTargetImage(target, scratch);
      target.setSize(width, height);
      if (saved) {
        this.copyTargetImage(scratch, target);
      }
      scratch.dispose();
    }
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
