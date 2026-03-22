import { Color, type ShaderMaterial } from 'three';
import type {
  MilkdropGpuFieldSignalInputs,
  MilkdropGpuInteractionTransform,
  MilkdropProceduralFieldTransformVisual,
} from '../types';

export type ProceduralFieldUniformState = {
  zoom: { value: number };
  zoomExponent: { value: number };
  rotation: { value: number };
  warp: { value: number };
  warpAnimSpeed: { value: number };
  centerX: { value: number };
  centerY: { value: number };
  scaleX: { value: number };
  scaleY: { value: number };
  translateX: { value: number };
  translateY: { value: number };
  time: { value: number };
  trebleAtt: { value: number };
  tint: { value: Color };
  alpha: { value: number };
  signalTime: { value: number };
  signalFrame: { value: number };
  signalFps: { value: number };
  signalBass: { value: number };
  signalMid: { value: number };
  signalMids: { value: number };
  signalTreble: { value: number };
  signalBassAtt: { value: number };
  signalMidAtt: { value: number };
  signalMidsAtt: { value: number };
  signalTrebleAtt: { value: number };
  signalBeat: { value: number };
  signalBeatPulse: { value: number };
  signalRms: { value: number };
  signalVol: { value: number };
  signalMusic: { value: number };
  signalWeightedEnergy: { value: number };
};

export type ProceduralFieldVisualWithSignals =
  MilkdropProceduralFieldTransformVisual & {
    signals: MilkdropGpuFieldSignalInputs;
  };

export type ProceduralInteractionUniformState = {
  interactionOffsetX: { value: number };
  interactionOffsetY: { value: number };
  interactionRotation: { value: number };
  interactionScale: { value: number };
  interactionAlpha: { value: number };
};

export function createProceduralFieldUniformState() {
  return {
    zoom: { value: 1 },
    zoomExponent: { value: 1 },
    rotation: { value: 0 },
    warp: { value: 0 },
    warpAnimSpeed: { value: 1 },
    centerX: { value: 0 },
    centerY: { value: 0 },
    scaleX: { value: 1 },
    scaleY: { value: 1 },
    translateX: { value: 0 },
    translateY: { value: 0 },
    time: { value: 0 },
    trebleAtt: { value: 0 },
    tint: { value: new Color(1, 1, 1) },
    alpha: { value: 1 },
    signalTime: { value: 0 },
    signalFrame: { value: 0 },
    signalFps: { value: 60 },
    signalBass: { value: 0 },
    signalMid: { value: 0 },
    signalMids: { value: 0 },
    signalTreble: { value: 0 },
    signalBassAtt: { value: 0 },
    signalMidAtt: { value: 0 },
    signalMidsAtt: { value: 0 },
    signalTrebleAtt: { value: 0 },
    signalBeat: { value: 0 },
    signalBeatPulse: { value: 0 },
    signalRms: { value: 0 },
    signalVol: { value: 0 },
    signalMusic: { value: 0 },
    signalWeightedEnergy: { value: 0 },
  } satisfies ProceduralFieldUniformState;
}

export function createProceduralInteractionUniformState() {
  return {
    interactionOffsetX: { value: 0 },
    interactionOffsetY: { value: 0 },
    interactionRotation: { value: 0 },
    interactionScale: { value: 1 },
    interactionAlpha: { value: 1 },
  } satisfies ProceduralInteractionUniformState;
}

export function syncProceduralFieldUniforms(
  material: ShaderMaterial,
  {
    zoom,
    zoomExponent,
    rotation,
    warp,
    warpAnimSpeed,
    centerX,
    centerY,
    scaleX,
    scaleY,
    translateX,
    translateY,
    time,
    trebleAtt,
    signals,
    tint,
    alpha,
  }: ProceduralFieldVisualWithSignals & {
    time: number;
    trebleAtt: number;
    tint: { r: number; g: number; b: number };
    alpha: number;
  },
) {
  material.uniforms.zoom.value = zoom;
  material.uniforms.zoomExponent.value = zoomExponent;
  material.uniforms.rotation.value = rotation;
  material.uniforms.warp.value = warp;
  material.uniforms.warpAnimSpeed.value = warpAnimSpeed;
  material.uniforms.centerX.value = centerX;
  material.uniforms.centerY.value = centerY;
  material.uniforms.scaleX.value = scaleX;
  material.uniforms.scaleY.value = scaleY;
  material.uniforms.translateX.value = translateX;
  material.uniforms.translateY.value = translateY;
  material.uniforms.time.value = time;
  material.uniforms.trebleAtt.value = trebleAtt;
  material.uniforms.tint.value.setRGB(tint.r, tint.g, tint.b);
  material.uniforms.alpha.value = alpha;
  material.uniforms.signalTime.value = signals.time;
  material.uniforms.signalFrame.value = signals.frame;
  material.uniforms.signalFps.value = signals.fps;
  material.uniforms.signalBass.value = signals.bass;
  material.uniforms.signalMid.value = signals.mid;
  material.uniforms.signalMids.value = signals.mids;
  material.uniforms.signalTreble.value = signals.treble;
  material.uniforms.signalBassAtt.value = signals.bassAtt;
  material.uniforms.signalMidAtt.value = signals.midAtt;
  material.uniforms.signalMidsAtt.value = signals.midsAtt;
  material.uniforms.signalTrebleAtt.value = signals.trebleAtt;
  material.uniforms.signalBeat.value = signals.beat;
  material.uniforms.signalBeatPulse.value = signals.beatPulse;
  material.uniforms.signalRms.value = signals.rms;
  material.uniforms.signalVol.value = signals.vol;
  material.uniforms.signalMusic.value = signals.music;
  material.uniforms.signalWeightedEnergy.value = signals.weightedEnergy;
}

export function syncProceduralInteractionUniforms(
  material: ShaderMaterial,
  transform: MilkdropGpuInteractionTransform | null | undefined,
) {
  material.uniforms.interactionOffsetX.value = transform?.offsetX ?? 0;
  material.uniforms.interactionOffsetY.value = transform?.offsetY ?? 0;
  material.uniforms.interactionRotation.value = transform?.rotation ?? 0;
  material.uniforms.interactionScale.value = transform?.scale ?? 1;
  material.uniforms.interactionAlpha.value = transform?.alphaMultiplier ?? 1;
}

export function syncPreviousProceduralFieldUniforms(
  material: ShaderMaterial,
  field: ProceduralFieldVisualWithSignals,
) {
  material.uniforms.previousZoom.value = field.zoom;
  material.uniforms.previousZoomExponent.value = field.zoomExponent;
  material.uniforms.previousRotation.value = field.rotation;
  material.uniforms.previousWarp.value = field.warp;
  material.uniforms.previousWarpAnimSpeed.value = field.warpAnimSpeed;
  material.uniforms.previousCenterX.value = field.centerX;
  material.uniforms.previousCenterY.value = field.centerY;
  material.uniforms.previousScaleX.value = field.scaleX;
  material.uniforms.previousScaleY.value = field.scaleY;
  material.uniforms.previousTranslateX.value = field.translateX;
  material.uniforms.previousTranslateY.value = field.translateY;
  material.uniforms.previousSignalTime.value = field.signals.time;
  material.uniforms.previousSignalFrame.value = field.signals.frame;
  material.uniforms.previousSignalFps.value = field.signals.fps;
  material.uniforms.previousSignalBass.value = field.signals.bass;
  material.uniforms.previousSignalMid.value = field.signals.mid;
  material.uniforms.previousSignalMids.value = field.signals.mids;
  material.uniforms.previousSignalTreble.value = field.signals.treble;
  material.uniforms.previousSignalBassAtt.value = field.signals.bassAtt;
  material.uniforms.previousSignalMidAtt.value = field.signals.midAtt;
  material.uniforms.previousSignalMidsAtt.value = field.signals.midsAtt;
  material.uniforms.previousSignalTrebleAtt.value = field.signals.trebleAtt;
  material.uniforms.previousSignalBeat.value = field.signals.beat;
  material.uniforms.previousSignalBeatPulse.value = field.signals.beatPulse;
  material.uniforms.previousSignalRms.value = field.signals.rms;
  material.uniforms.previousSignalVol.value = field.signals.vol;
  material.uniforms.previousSignalMusic.value = field.signals.music;
  material.uniforms.previousSignalWeightedEnergy.value =
    field.signals.weightedEnergy;
}
