import { useCallback, useState, useTransition } from 'react';
import styles from '../../css/SynthesizePanel.module.css';
import {
  type generatePreset,
  generatePresetFromImage,
  generatePresetTournament,
} from '../milkdrop/preset-generator.ts';
import { probePresetReactivity } from '../milkdrop/reactivity-probe.ts';
import { ParametricIdenticon } from './ParametricIdenticon.tsx';
import { useWorkspace } from './workspace-context.tsx';

function toFileList(milkSource: string) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([milkSource], 'generated-preset.milk'));
  return transfer.files;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

const PALETTES = [
  { value: 'auto' as const, label: 'Auto-detect' },
  { value: 'bioluminescent' as const, label: 'Bioluminescent' },
  { value: 'cyberpunk' as const, label: 'Cyberpunk' },
  { value: 'cosmic' as const, label: 'Cosmic' },
];

type Palette = (typeof PALETTES)[number]['value'];
type ProviderKind = 'hosted' | 'local';

const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
const DEFAULT_PROVIDER: ProviderKind = viteEnv?.DEV ? 'local' : 'hosted';
const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:11434/v1';
const DEFAULT_LOCAL_MODEL = 'gemma4:e4b-32k';

function providerStatus(provider: ProviderKind, offline: boolean) {
  if (provider === 'hosted' && offline) {
    return 'AI imports are paused while offline. Reconnect, or switch to local mode if Ollama is running on this device.';
  }
  return provider === 'local'
    ? 'Local mode sends this prompt directly to Ollama on your computer.'
    : 'Hosted mode uses the model service on the deployed Stims site.';
}

export function SynthesizePanel({ offline = false }: { offline?: boolean }) {
  const { engine, ui } = useWorkspace();
  const [prompt, setPrompt] = useState('');
  const [palette, setPalette] = useState<Palette>('auto');
  const [intensity, setIntensity] = useState(1.0);
  const [reactivity, setReactivity] = useState(1.0);
  const [provider, setProvider] = useState<ProviderKind>(DEFAULT_PROVIDER);
  const [localEndpoint, setLocalEndpoint] = useState(DEFAULT_LOCAL_ENDPOINT);
  const [localModel, setLocalModel] = useState(DEFAULT_LOCAL_MODEL);
  const [generating, setGenerating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isGenerating = generating || isPending;
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState(() =>
    providerStatus(DEFAULT_PROVIDER, offline),
  );

  const handleProviderChange = useCallback(
    (next: ProviderKind) => {
      setProvider(next);
      // The image route only exists on the hosted deployment; drop a pending
      // image rather than silently ignoring it in local mode.
      if (next === 'local') {
        setImageFile(null);
      }
      setStatus(providerStatus(next, offline));
    },
    [offline],
  );

  const handleImageChange = useCallback((file: File | null) => {
    if (file && file.size > MAX_IMAGE_BYTES) {
      setImageFile(null);
      setStatus('Images must be 4 MB or smaller.');
      return;
    }
    setImageFile(file);
    if (file) {
      setStatus(
        'The hosted vision model will describe this image and generate a matching preset.',
      );
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    const useImage = provider === 'hosted' && imageFile !== null;
    if (!useImage && !prompt.trim()) return;
    if (provider === 'hosted' && offline) {
      setStatus(providerStatus(provider, offline));
      return;
    }
    setGenerating(true);
    setStatus(
      useImage
        ? 'Describing the image and generating with the hosted model…'
        : provider === 'local'
          ? `Generating with ${localModel.trim() || 'the local model'}…`
          : 'Generating with the hosted model…',
    );
    try {
      // The prompt and control sliders steer both paths: as the generation
      // description for text mode, and as guidance layered onto the vision
      // model's description in image mode — attaching an image must not turn
      // the other inputs into no-ops.
      const description = [
        prompt.trim(),
        `Color palette: ${palette === 'auto' ? 'choose from the description' : palette}.`,
        `Visual intensity: ${intensity.toFixed(1)} on a 0 to 2 scale.`,
        `Beat reactivity: ${reactivity.toFixed(1)} on a 0 to 2 scale.`,
      ].join('\n');
      let compiled: Awaited<ReturnType<typeof generatePreset>>;
      if (useImage && imageFile) {
        compiled = await generatePresetFromImage(
          await fileToBase64(imageFile),
          { guidance: description },
        );
      } else {
        // Tournament, not single-shot: several candidates are generated,
        // broken ones are salvaged or eliminated, and the most
        // audio-reactive survivor loads. One malformed model response no
        // longer surfaces as an error.
        const outcome = await generatePresetTournament(description, {
          provider:
            provider === 'local'
              ? {
                  kind: 'openai-compatible',
                  endpoint: localEndpoint.trim(),
                  model: localModel.trim(),
                }
              : { kind: 'hosted' },
        });
        compiled = outcome.winner;
      }
      // Quality gate: a generated preset that compiles but whose equations
      // ignore audio still loads, but with a visible label so the user can
      // regenerate instead of wondering why nothing moves to the beat.
      const probeResult = probePresetReactivity(compiled);
      await engine.importPresetFiles(toFileList(compiled.source.raw));
      startTransition(() => {
        if (probeResult.verdict === 'static') {
          setStatus(
            'Loaded, but this preset barely reacts to sound. Try generating again with wording like “strong beat reaction”.',
          );
        } else {
          ui.updatePanel(null);
        }
      });
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [
    prompt,
    imageFile,
    intensity,
    reactivity,
    palette,
    provider,
    localEndpoint,
    localModel,
    engine,
    offline,
    ui,
  ]);

  return (
    <section className={styles.panel} aria-labelledby="synth-heading">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <ParametricIdenticon
          seed={prompt.trim() || 'model-generator'}
          filterPreset="liquid-warp"
          size={36}
          audioPeak={isGenerating ? 0.8 : 0.2}
          mood={palette === 'auto' ? 'psychedelic' : palette}
        />
        <div>
          <h3 id="synth-heading" className={styles.heading}>
            Generate a preset
          </h3>
          <p className={styles.intro}>
            Describe what you want to see. AI writes a new preset for you, and
            Stims checks that it works before it plays.
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
          disabled={isGenerating}
        />
      </label>

      {provider === 'hosted' ? (
        <label className={styles.field}>
          <span className={styles.label}>
            Reference image (optional{imageFile ? `: ${imageFile.name}` : ''})
          </span>
          <input
            className={styles.input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
            disabled={isGenerating}
          />
        </label>
      ) : null}

      <details
        className="stims-shell__settings-advanced"
        open={provider === 'local' || undefined}
      >
        <summary className="stims-shell__settings-summary">
          <span>Advanced</span>
          <span className="stims-shell__meta-copy">
            Run generation on your own machine
          </span>
        </summary>
        <div className="stims-shell__settings-advanced-body">
          <fieldset className={styles.palettes} disabled={isGenerating}>
            <legend className={styles.label}>Model provider</legend>
            <div className={styles.paletteRow}>
              <label className={styles.palette}>
                <input
                  type="radio"
                  name="model-provider"
                  value="hosted"
                  checked={provider === 'hosted'}
                  onChange={() => handleProviderChange('hosted')}
                />
                <span>Hosted model</span>
              </label>
              <label className={styles.palette}>
                <input
                  type="radio"
                  name="model-provider"
                  value="local"
                  checked={provider === 'local'}
                  onChange={() => handleProviderChange('local')}
                />
                <span>Local Ollama</span>
              </label>
            </div>
            <p className={styles.providerNote}>
              {provider === 'local'
                ? 'No API key is used. Direct requests are limited to loopback addresses; Ollama must allow this browser origin.'
                : 'Available on deployments configured with the Cloudflare AI binding. Stims does not substitute a template if the model is unavailable.'}
            </p>
          </fieldset>

          {provider === 'local' ? (
            <div className={styles.localSettings}>
              <label className={styles.field}>
                <span className={styles.label}>Local endpoint</span>
                <input
                  className={styles.input}
                  type="url"
                  value={localEndpoint}
                  onChange={(event) => setLocalEndpoint(event.target.value)}
                  disabled={isGenerating}
                  spellCheck={false}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Model</span>
                <input
                  className={styles.input}
                  type="text"
                  value={localModel}
                  onChange={(event) => setLocalModel(event.target.value)}
                  disabled={isGenerating}
                  spellCheck={false}
                />
              </label>
            </div>
          ) : null}
        </div>
      </details>

      <fieldset className={styles.palettes} disabled={isGenerating}>
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
          disabled={isGenerating}
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
          disabled={isGenerating}
          className={styles.slider}
        />
      </label>

      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>

      <button
        type="button"
        className={styles.generateButton}
        disabled={
          isGenerating ||
          (!prompt.trim() && !(provider === 'hosted' && imageFile)) ||
          (provider === 'hosted' && offline) ||
          (provider === 'local' &&
            (!localEndpoint.trim() || !localModel.trim()))
        }
        onClick={() => void handleGenerate()}
      >
        {isGenerating ? 'Generating…' : 'Generate with model'}
      </button>
    </section>
  );
}
