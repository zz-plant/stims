import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler';
import { createMilkdropVM } from '../assets/js/milkdrop/vm';

const PARITY_CORPUS_DIR = join(process.cwd(), 'assets', 'data', 'milkdrop-parity', 'corpus');
const VISUAL_BASELINES_PATH = join(process.cwd(), 'assets', 'data', 'milkdrop-parity', 'visual-baselines.json');

function makeSignals(overrides: Partial<{ frame: number; time: number; beatPulse: number; bass: number; mid: number; treb: number; bassAtt: number; midAtt: number; trebleAtt: number }>) {
  return {
    time: 0,
    deltaMs: 16.67,
    frame: 0,
    fps: 60,
    bass: 0, mid: 0, mids: 0, treb: 0, treble: 0,
    bassAtt: 0, midAtt: 0, midsAtt: 0, trebleAtt: 0, trebleAtt: 0,
    bass_att: 0, mid_att: 0, mids_att: 0, treb_att: 0, treble_att: 0,
    beatPulse: 0, beatPulseLast: 0, beatPulseDecay: 0,
    energy: 0, energyFull: 0,
    frequencyData: new Uint8Array(64),
    waveformData: new Uint8Array(64).fill(128),
    waveformLeftData: new Uint8Array(64).fill(128),
    waveformRightData: new Uint8Array(64).fill(128),
    frequencyLeftData: new Uint8Array(64),
    frequencyRightData: new Uint8Array(64),
    ...overrides,
  };
}

function buildFrameSummary(frameState: any) {
  return {
    mainWaveCount: frameState.mainWave.positions.length,
    waveformCount: frameState.waveform.positions.length,
    customWaveCount: frameState.customWaves.length,
    shapeCount: frameState.shapes.length,
    borderCount: frameState.borders.length,
    motionVectorCount: frameState.motionVectors.length,
    post: {
      gammaAdj: frameState.post.gammaAdj,
      videoEchoAlpha: frameState.post.videoEchoAlpha,
      videoEchoZoom: frameState.post.videoEchoZoom,
      shaderMixAlpha: frameState.post.shaderControls.mixAlpha,
    },
  };
}

const baselines = JSON.parse(readFileSync(VISUAL_BASELINES_PATH, 'utf8'));

for (const baselinePreset of baselines.presets) {
  const raw = readFileSync(join(PARITY_CORPUS_DIR, baselinePreset.file), 'utf8');
  const compiled = compileMilkdropPresetSource(raw, {
    id: baselinePreset.id,
    title: baselinePreset.id,
    fileName: baselinePreset.file,
    origin: 'user',
  });
  const vm = createMilkdropVM(compiled);

  for (const baselineFrame of baselinePreset.frames) {
    const frameState = vm.step(makeSignals({ frame: baselineFrame.frame }));
    const summary = buildFrameSummary(frameState);
    baselineFrame.mainWave.count = summary.mainWaveCount;
    baselineFrame.waveform.count = summary.waveformCount;
    baselineFrame.customWaves.count = summary.customWaveCount;
    baselineFrame.shapes.count = summary.shapeCount;
    baselineFrame.borders.count = summary.borderCount;
    baselineFrame.motionVectors.count = summary.motionVectorCount;
    baselineFrame.post.gammaAdj = summary.post.gammaAdj;
    baselineFrame.post.videoEchoAlpha = summary.post.videoEchoAlpha;
    baselineFrame.post.videoEchoZoom = summary.post.videoEchoZoom;
    baselineFrame.post.shaderMixAlpha = summary.post.shaderMixAlpha;
  }
}

writeFileSync(VISUAL_BASELINES_PATH, JSON.stringify(baselines, null, 2) + '\n');
console.log('Baselines updated');
