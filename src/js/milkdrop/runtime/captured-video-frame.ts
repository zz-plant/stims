import type {
  MilkdropCapturedVideoReactiveState,
  MilkdropFrameState,
  MilkdropShaderTextureLayerControls,
  MilkdropShaderTextureWarpControls,
} from '../types.ts';

export function applyMilkdropCapturedVideoFrameState({
  frameState,
  capturedVideoReady,
  reactivity,
}: {
  frameState: MilkdropFrameState;
  capturedVideoReady: boolean;
  reactivity: MilkdropCapturedVideoReactiveState;
}): MilkdropFrameState {
  if (!capturedVideoReady) {
    return frameState;
  }

  const overlayAvailable =
    frameState.post.shaderControls.textureLayer.source === 'none';
  const warpAvailable =
    frameState.post.shaderControls.warpTexture.source === 'none';

  if (!overlayAvailable && !warpAvailable) {
    return frameState;
  }

  const nextTextureLayer: MilkdropShaderTextureLayerControls = overlayAvailable
    ? {
        ...frameState.post.shaderControls.textureLayer,
        source: 'video',
        mode: 'mix',
        sampleDimension: '2d',
        inverted: false,
        amount: reactivity.overlayAmount,
        scaleX: reactivity.textureScaleX,
        scaleY: reactivity.textureScaleY,
        offsetX: reactivity.textureOffsetX,
        offsetY: reactivity.textureOffsetY,
        volumeSliceZ: null,
      }
    : frameState.post.shaderControls.textureLayer;
  const nextWarpTexture: MilkdropShaderTextureWarpControls = warpAvailable
    ? {
        ...frameState.post.shaderControls.warpTexture,
        source: 'video',
        sampleDimension: '2d',
        amount: reactivity.warpAmount,
        scaleX: reactivity.warpScaleX,
        scaleY: reactivity.warpScaleY,
        offsetX: reactivity.warpOffsetX,
        offsetY: reactivity.warpOffsetY,
        volumeSliceZ: null,
      }
    : frameState.post.shaderControls.warpTexture;

  return {
    ...frameState,
    post: {
      ...frameState.post,
      shaderEnabled: true,
      shaderControls: {
        ...frameState.post.shaderControls,
        mixAlpha: Math.max(
          frameState.post.shaderControls.mixAlpha,
          reactivity.mixAlphaFloor,
        ),
        textureLayer: nextTextureLayer,
        warpTexture: nextWarpTexture,
      },
    },
  };
}
