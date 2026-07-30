import { useCallback, useState } from 'react';
import styles from '../../css/SynthesizePanel.module.css';
import {
  type PresetSynthesisOptions,
  synthesizeEELPreset,
} from '../milkdrop/ai-preset-synthesizer.ts';
import { ParametricIdenticon } from './ParametricIdenticon.tsx';
import { useWorkspace } from './workspace-context.tsx';

function toFileList(milkSource: string) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([milkSource], 'generated-preset.milk'));
  return transfer.files;
}

function buildMilkSource(synthesized: ReturnType<typeof synthesizeEELPreset>) {
  const lines: string[] = [];
  lines.push(`title=${synthesized.name}`);
  lines.push(`author=${synthesized.author}`);
  lines.push('');
  lines.push(`decay=${synthesized.decay}`);
  lines.push(`zoom=${synthesized.zoom}`);
  lines.push(`rot=${synthesized.rot}`);
  lines.push(`warp=${synthesized.warp}`);
  lines.push(`wave_r=${synthesized.wave_r}`);
  lines.push(`wave_g=${synthesized.wave_g}`);
  lines.push(`wave_b=${synthesized.wave_b}`);
  if (synthesized.per_frame) {
    lines.push('');
    const statements = synthesized.per_frame.split(';').filter(Boolean);
    statements.forEach((stmt, i) => {
      lines.push(`per_frame_${i + 1}=${stmt.trim()};`);
    });
  }
  if (synthesized.per_pixel) {
    lines.push('');
    const statements = synthesized.per_pixel.split(';').filter(Boolean);
    statements.forEach((stmt, i) => {
      lines.push(`per_pixel_${i + 1}=${stmt.trim()};`);
    });
  }
  if (synthesized.wavecode_0_per_point) {
    lines.push('');
    lines.push(`wavecode_0_per_point=${synthesized.wavecode_0_per_point}`);
  }
  return `${lines.join('\n')}\n`;
}

const PALETTES = [
  { value: 'auto' as const, label: 'Auto-detect' },
  { value: 'bioluminescent' as const, label: 'Bioluminescent' },
  { value: 'cyberpunk' as const, label: 'Cyberpunk' },
  { value: 'cosmic' as const, label: 'Cosmic' },
];

export function SynthesizePanel() {
  const { engine, ui } = useWorkspace();
  const [prompt, setPrompt] = useState('');
  const [palette, setPalette] =
    useState<PresetSynthesisOptions['colorPalette']>('auto');
  const [intensity, setIntensity] = useState(1.0);
  const [reactivity, setReactivity] = useState(1.0);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('Describe a visualizer to generate.');

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setStatus('Generating preset…');
    try {
      const synthesized = synthesizeEELPreset({
        prompt: prompt.trim(),
        intensity,
        beatReactivity: reactivity,
        colorPalette: palette === 'auto' ? undefined : palette,
      });
      const milkSource = buildMilkSource(synthesized);
      await engine.importPresetFiles(toFileList(milkSource));
      ui.updatePanel(null);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, intensity, reactivity, palette, engine, ui]);

  return (
    <section className={styles.panel} aria-labelledby="synth-heading">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <ParametricIdenticon
          seed={prompt.trim() || 'ai-synthesizer'}
          filterPreset="liquid-warp"
          size={36}
          audioPeak={generating ? 0.8 : 0.2}
          mood={palette === 'auto' ? 'psychedelic' : palette}
        />
        <div>
          <h3 id="synth-heading" className={styles.heading}>
            Generate visualizer
          </h3>
          <p className={styles.intro}>
            Describe a visual style and the preset will be generated and loaded
            immediately.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Description</span>
        <textarea
          className={styles.textarea}
          placeholder="e.g., deep ocean with glowing jellyfish, slow pulsing neon rings"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={generating}
        />
      </label>

      <fieldset className={styles.palettes} disabled={generating}>
        <legend className={styles.label}>Color palette</legend>
        <div className={styles.paletteRow}>
          {PALETTES.map((p) => (
            <label className={styles.palette} key={p.value}>
              <input
                type="radio"
                name="palette"
                value={p.value}
                checked={palette === p.value}
                onChange={() => setPalette(p.value)}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.label}>Intensity: {intensity.toFixed(1)}</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          disabled={generating}
          className={styles.slider}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          Beat reactivity: {reactivity.toFixed(1)}
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={reactivity}
          onChange={(e) => setReactivity(Number(e.target.value))}
          disabled={generating}
          className={styles.slider}
        />
      </label>

      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>

      <button
        type="button"
        className={styles.generateButton}
        disabled={generating || !prompt.trim()}
        onClick={() => void handleGenerate()}
      >
        {generating ? 'Generating…' : 'Generate and load'}
      </button>
    </section>
  );
}
