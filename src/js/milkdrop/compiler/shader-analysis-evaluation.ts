import { evaluateMilkdropExpression } from '../expression';
import type {
  MilkdropExpressionNode,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
} from '../types';

type ShaderControlAnalysis = {
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
};

export function evaluateMilkdropShaderControlExpressions({
  controls,
  expressions,
  env,
}: {
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  env: Record<string, number>;
}) {
  const next: MilkdropShaderControls = structuredClone(controls);
  const evaluateScalar = (
    expression: MilkdropExpressionNode | null,
    fallback: number,
  ) => {
    if (!expression) {
      return fallback;
    }
    return evaluateMilkdropExpression(expression, env);
  };

  next.warpScale = evaluateScalar(expressions.warpScale, next.warpScale);
  next.offsetX = evaluateScalar(expressions.offsetX, next.offsetX);
  next.offsetY = evaluateScalar(expressions.offsetY, next.offsetY);
  next.rotation = evaluateScalar(expressions.rotation, next.rotation);
  next.zoom = evaluateScalar(expressions.zoom, next.zoom);
  next.saturation = evaluateScalar(expressions.saturation, next.saturation);
  next.contrast = evaluateScalar(expressions.contrast, next.contrast);
  next.colorScale.r = evaluateScalar(
    expressions.colorScale.r,
    next.colorScale.r,
  );
  next.colorScale.g = evaluateScalar(
    expressions.colorScale.g,
    next.colorScale.g,
  );
  next.colorScale.b = evaluateScalar(
    expressions.colorScale.b,
    next.colorScale.b,
  );
  next.hueShift = evaluateScalar(expressions.hueShift, next.hueShift);
  next.mixAlpha = evaluateScalar(expressions.mixAlpha, next.mixAlpha);
  next.brightenBoost = evaluateScalar(
    expressions.brightenBoost,
    next.brightenBoost,
  );
  next.invertBoost = evaluateScalar(expressions.invertBoost, next.invertBoost);
  next.solarizeBoost = evaluateScalar(
    expressions.solarizeBoost,
    next.solarizeBoost,
  );
  next.tint.r = evaluateScalar(expressions.tint.r, next.tint.r);
  next.tint.g = evaluateScalar(expressions.tint.g, next.tint.g);
  next.tint.b = evaluateScalar(expressions.tint.b, next.tint.b);
  next.textureLayer.amount = evaluateScalar(
    expressions.textureLayer.amount,
    next.textureLayer.amount,
  );
  next.textureLayer.scaleX = evaluateScalar(
    expressions.textureLayer.scaleX,
    next.textureLayer.scaleX,
  );
  next.textureLayer.scaleY = evaluateScalar(
    expressions.textureLayer.scaleY,
    next.textureLayer.scaleY,
  );
  next.textureLayer.offsetX = evaluateScalar(
    expressions.textureLayer.offsetX,
    next.textureLayer.offsetX,
  );
  next.textureLayer.offsetY = evaluateScalar(
    expressions.textureLayer.offsetY,
    next.textureLayer.offsetY,
  );
  next.textureLayer.volumeSliceZ = expressions.textureLayer.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.textureLayer.volumeSliceZ, env)
    : next.textureLayer.volumeSliceZ;
  next.warpTexture.amount = evaluateScalar(
    expressions.warpTexture.amount,
    next.warpTexture.amount,
  );
  next.warpTexture.scaleX = evaluateScalar(
    expressions.warpTexture.scaleX,
    next.warpTexture.scaleX,
  );
  next.warpTexture.scaleY = evaluateScalar(
    expressions.warpTexture.scaleY,
    next.warpTexture.scaleY,
  );
  next.warpTexture.offsetX = evaluateScalar(
    expressions.warpTexture.offsetX,
    next.warpTexture.offsetX,
  );
  next.warpTexture.offsetY = evaluateScalar(
    expressions.warpTexture.offsetY,
    next.warpTexture.offsetY,
  );
  next.warpTexture.volumeSliceZ = expressions.warpTexture.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.warpTexture.volumeSliceZ, env)
    : next.warpTexture.volumeSliceZ;
  return next;
}

function pickShaderScalar(
  primaryValue: number,
  primaryExpression: MilkdropExpressionNode | null,
  secondaryValue: number,
  secondaryExpression: MilkdropExpressionNode | null,
  defaultValue: number,
) {
  if (primaryExpression || primaryValue !== defaultValue) {
    return { value: primaryValue, expression: primaryExpression };
  }
  return { value: secondaryValue, expression: secondaryExpression };
}

export function mergeShaderControlAnalysis(
  warpAnalysis: ShaderControlAnalysis,
  compAnalysis: ShaderControlAnalysis,
) {
  const warpScale = pickShaderScalar(
    warpAnalysis.controls.warpScale,
    warpAnalysis.expressions.warpScale,
    compAnalysis.controls.warpScale,
    compAnalysis.expressions.warpScale,
    0,
  );
  const offsetX = pickShaderScalar(
    warpAnalysis.controls.offsetX,
    warpAnalysis.expressions.offsetX,
    compAnalysis.controls.offsetX,
    compAnalysis.expressions.offsetX,
    0,
  );
  const offsetY = pickShaderScalar(
    warpAnalysis.controls.offsetY,
    warpAnalysis.expressions.offsetY,
    compAnalysis.controls.offsetY,
    compAnalysis.expressions.offsetY,
    0,
  );
  const rotation = pickShaderScalar(
    warpAnalysis.controls.rotation,
    warpAnalysis.expressions.rotation,
    compAnalysis.controls.rotation,
    compAnalysis.expressions.rotation,
    0,
  );
  const zoom = pickShaderScalar(
    warpAnalysis.controls.zoom,
    warpAnalysis.expressions.zoom,
    compAnalysis.controls.zoom,
    compAnalysis.expressions.zoom,
    1,
  );
  const saturation = pickShaderScalar(
    compAnalysis.controls.saturation,
    compAnalysis.expressions.saturation,
    warpAnalysis.controls.saturation,
    warpAnalysis.expressions.saturation,
    1,
  );
  const contrast = pickShaderScalar(
    compAnalysis.controls.contrast,
    compAnalysis.expressions.contrast,
    warpAnalysis.controls.contrast,
    warpAnalysis.expressions.contrast,
    1,
  );
  const hueShift = pickShaderScalar(
    compAnalysis.controls.hueShift,
    compAnalysis.expressions.hueShift,
    warpAnalysis.controls.hueShift,
    warpAnalysis.expressions.hueShift,
    0,
  );
  const mixAlpha = pickShaderScalar(
    compAnalysis.controls.mixAlpha,
    compAnalysis.expressions.mixAlpha,
    warpAnalysis.controls.mixAlpha,
    warpAnalysis.expressions.mixAlpha,
    0,
  );
  const brightenBoost = pickShaderScalar(
    compAnalysis.controls.brightenBoost,
    compAnalysis.expressions.brightenBoost,
    warpAnalysis.controls.brightenBoost,
    warpAnalysis.expressions.brightenBoost,
    0,
  );
  const invertBoost = pickShaderScalar(
    compAnalysis.controls.invertBoost,
    compAnalysis.expressions.invertBoost,
    warpAnalysis.controls.invertBoost,
    warpAnalysis.expressions.invertBoost,
    0,
  );
  const solarizeBoost = pickShaderScalar(
    compAnalysis.controls.solarizeBoost,
    compAnalysis.expressions.solarizeBoost,
    warpAnalysis.controls.solarizeBoost,
    warpAnalysis.expressions.solarizeBoost,
    0,
  );
  const colorScale = {
    r: pickShaderScalar(
      compAnalysis.controls.colorScale.r,
      compAnalysis.expressions.colorScale.r,
      warpAnalysis.controls.colorScale.r,
      warpAnalysis.expressions.colorScale.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.colorScale.g,
      compAnalysis.expressions.colorScale.g,
      warpAnalysis.controls.colorScale.g,
      warpAnalysis.expressions.colorScale.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.colorScale.b,
      compAnalysis.expressions.colorScale.b,
      warpAnalysis.controls.colorScale.b,
      warpAnalysis.expressions.colorScale.b,
      1,
    ),
  };
  const tint = {
    r: pickShaderScalar(
      compAnalysis.controls.tint.r,
      compAnalysis.expressions.tint.r,
      warpAnalysis.controls.tint.r,
      warpAnalysis.expressions.tint.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.tint.g,
      compAnalysis.expressions.tint.g,
      warpAnalysis.controls.tint.g,
      warpAnalysis.expressions.tint.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.tint.b,
      compAnalysis.expressions.tint.b,
      warpAnalysis.controls.tint.b,
      warpAnalysis.expressions.tint.b,
      1,
    ),
  };
  const textureLayerAmount = pickShaderScalar(
    compAnalysis.controls.textureLayer.amount,
    compAnalysis.expressions.textureLayer.amount,
    warpAnalysis.controls.textureLayer.amount,
    warpAnalysis.expressions.textureLayer.amount,
    0,
  );
  const textureLayerScaleX = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleX,
    compAnalysis.expressions.textureLayer.scaleX,
    warpAnalysis.controls.textureLayer.scaleX,
    warpAnalysis.expressions.textureLayer.scaleX,
    1,
  );
  const textureLayerScaleY = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleY,
    compAnalysis.expressions.textureLayer.scaleY,
    warpAnalysis.controls.textureLayer.scaleY,
    warpAnalysis.expressions.textureLayer.scaleY,
    1,
  );
  const textureLayerOffsetX = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetX,
    compAnalysis.expressions.textureLayer.offsetX,
    warpAnalysis.controls.textureLayer.offsetX,
    warpAnalysis.expressions.textureLayer.offsetX,
    0,
  );
  const textureLayerOffsetY = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetY,
    compAnalysis.expressions.textureLayer.offsetY,
    warpAnalysis.controls.textureLayer.offsetY,
    warpAnalysis.expressions.textureLayer.offsetY,
    0,
  );
  const textureLayerSample =
    compAnalysis.controls.textureLayer.mode !== 'none'
      ? compAnalysis
      : warpAnalysis;
  const warpTextureAmount = pickShaderScalar(
    warpAnalysis.controls.warpTexture.amount,
    warpAnalysis.expressions.warpTexture.amount,
    compAnalysis.controls.warpTexture.amount,
    compAnalysis.expressions.warpTexture.amount,
    0,
  );
  const warpTextureScaleX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleX,
    warpAnalysis.expressions.warpTexture.scaleX,
    compAnalysis.controls.warpTexture.scaleX,
    compAnalysis.expressions.warpTexture.scaleX,
    1,
  );
  const warpTextureScaleY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleY,
    warpAnalysis.expressions.warpTexture.scaleY,
    compAnalysis.controls.warpTexture.scaleY,
    compAnalysis.expressions.warpTexture.scaleY,
    1,
  );
  const warpTextureOffsetX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetX,
    warpAnalysis.expressions.warpTexture.offsetX,
    compAnalysis.controls.warpTexture.offsetX,
    compAnalysis.expressions.warpTexture.offsetX,
    0,
  );
  const warpTextureOffsetY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetY,
    warpAnalysis.expressions.warpTexture.offsetY,
    compAnalysis.controls.warpTexture.offsetY,
    compAnalysis.expressions.warpTexture.offsetY,
    0,
  );
  const warpTextureSample =
    warpAnalysis.controls.warpTexture.source !== 'none'
      ? warpAnalysis
      : compAnalysis;

  return {
    controls: {
      warpScale: warpScale.value,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      rotation: rotation.value,
      zoom: zoom.value,
      saturation: saturation.value,
      contrast: contrast.value,
      colorScale: {
        r: colorScale.r.value,
        g: colorScale.g.value,
        b: colorScale.b.value,
      },
      hueShift: hueShift.value,
      mixAlpha: mixAlpha.value,
      brightenBoost: brightenBoost.value,
      invertBoost: invertBoost.value,
      solarizeBoost: solarizeBoost.value,
      tint: {
        r: tint.r.value,
        g: tint.g.value,
        b: tint.b.value,
      },
      textureLayer: {
        source:
          compAnalysis.controls.textureLayer.source !== 'none'
            ? compAnalysis.controls.textureLayer.source
            : warpAnalysis.controls.textureLayer.source,
        mode:
          compAnalysis.controls.textureLayer.mode !== 'none'
            ? compAnalysis.controls.textureLayer.mode
            : warpAnalysis.controls.textureLayer.mode,
        sampleDimension:
          textureLayerSample.controls.textureLayer.sampleDimension,
        inverted: textureLayerSample.controls.textureLayer.inverted,
        amount: textureLayerAmount.value,
        scaleX: textureLayerScaleX.value,
        scaleY: textureLayerScaleY.value,
        offsetX: textureLayerOffsetX.value,
        offsetY: textureLayerOffsetY.value,
        volumeSliceZ: textureLayerSample.controls.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        source:
          warpAnalysis.controls.warpTexture.source !== 'none'
            ? warpAnalysis.controls.warpTexture.source
            : compAnalysis.controls.warpTexture.source,
        sampleDimension: warpTextureSample.controls.warpTexture.sampleDimension,
        amount: warpTextureAmount.value,
        scaleX: warpTextureScaleX.value,
        scaleY: warpTextureScaleY.value,
        offsetX: warpTextureOffsetX.value,
        offsetY: warpTextureOffsetY.value,
        volumeSliceZ: warpTextureSample.controls.warpTexture.volumeSliceZ,
      },
    },
    expressions: {
      warpScale: warpScale.expression,
      offsetX: offsetX.expression,
      offsetY: offsetY.expression,
      rotation: rotation.expression,
      zoom: zoom.expression,
      saturation: saturation.expression,
      contrast: contrast.expression,
      colorScale: {
        r: colorScale.r.expression,
        g: colorScale.g.expression,
        b: colorScale.b.expression,
      },
      hueShift: hueShift.expression,
      mixAlpha: mixAlpha.expression,
      brightenBoost: brightenBoost.expression,
      invertBoost: invertBoost.expression,
      solarizeBoost: solarizeBoost.expression,
      tint: {
        r: tint.r.expression,
        g: tint.g.expression,
        b: tint.b.expression,
      },
      textureLayer: {
        sampleDimension:
          textureLayerSample.expressions.textureLayer.sampleDimension,
        amount: textureLayerAmount.expression,
        scaleX: textureLayerScaleX.expression,
        scaleY: textureLayerScaleY.expression,
        offsetX: textureLayerOffsetX.expression,
        offsetY: textureLayerOffsetY.expression,
        volumeSliceZ: textureLayerSample.expressions.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        sampleDimension:
          warpTextureSample.expressions.warpTexture.sampleDimension,
        amount: warpTextureAmount.expression,
        scaleX: warpTextureScaleX.expression,
        scaleY: warpTextureScaleY.expression,
        offsetX: warpTextureOffsetX.expression,
        offsetY: warpTextureOffsetY.expression,
        volumeSliceZ: warpTextureSample.expressions.warpTexture.volumeSliceZ,
      },
    },
  };
}
