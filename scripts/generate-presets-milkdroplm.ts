/**
 * Generate candidate presets with a local MilkDropLM model via Ollama, gated
 * by the same strict compile check the corpus ingest uses. Generated presets
 * land in scratch/generated-presets/ for review — they are NOT auto-ingested;
 * run them through `bun run lab:flash-audit` before any catalog promotion
 * (the MilkDropLM model card carries an epilepsy warning).
 *
 * One-time model setup (~4.7GB download, not done by this script):
 *   huggingface-cli download Quant-Cartel/MilkDropLM-7b-v0.3-GGUF \
 *     MilkDropLM-7b-v0.3-Q4_K_M.gguf --local-dir ~/models/milkdroplm
 *   printf 'FROM ~/models/milkdroplm/MilkDropLM-7b-v0.3-Q4_K_M.gguf\nPARAMETER temperature 1.0\nPARAMETER num_ctx 16384\n' > /tmp/Modelfile.milkdroplm
 *   ollama create milkdroplm -f /tmp/Modelfile.milkdroplm
 *
 * Usage:
 *   bun run scripts/generate-presets-milkdroplm.ts --count=5 [--category=fractal] [--model=milkdroplm]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  countEquationLines,
  salvageCompileMilkdropPreset,
} from '../src/js/milkdrop/salvage-compile.ts';

const REPO_ROOT = path.join(import.meta.dir, '..');
const OUT_DIR = path.join(REPO_ROOT, 'scratch', 'generated-presets');
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

const CATEGORY_PROMPTS: Record<string, string> = {
  dancer: 'a dancing figure-like shape that moves with the beat',
  fractal: 'an evolving fractal structure with deep recursive zoom',
  geometric: 'crisp geometric shapes and grids pulsing with the music',
  hypnotic: 'a slow hypnotic tunnel with flowing motion',
  particles: 'swarms of glowing particles reacting to bass',
  reaction: 'organic reaction-diffusion liquid textures',
  sparkle: 'subtle glittering sparkles over a dark background',
  supernova: 'radial bursts of light that bloom on beats',
  waveform: 'the audio waveform itself as the central visual element',
};

async function generateOne(model: string, category: string): Promise<string> {
  const style = CATEGORY_PROMPTS[category] ?? category;
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `Give me a MilkDrop preset featuring ${style}. Respond with the complete preset file in a markdown code block.`,
      stream: false,
      options: { temperature: 1.0, num_ctx: 16384 },
    }),
  });
  if (!response.ok) {
    throw new Error(`ollama generate failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { response?: string };
  const text = data.response ?? '';
  // MilkDropLM wraps presets in markdown fences per its model card.
  const fenced = text.match(/```(?:milkdrop|ini|text)?\n([\s\S]*?)```/u);
  return (fenced ? fenced[1] : text).trim();
}

async function modelAvailable(model: string): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = (await response.json()) as {
      models?: Array<{ name: string }>;
    };
    return (data.models ?? []).some((m) => m.name.startsWith(model));
  } catch {
    return false;
  }
}

async function main() {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const model = arg('model') ?? 'milkdroplm';
  const count = Number.parseInt(arg('count') ?? '5', 10);
  const onlyCategory = arg('category');

  if (!(await modelAvailable(model))) {
    console.error(
      `[generate] Ollama model "${model}" not found. See the setup steps in this script's header comment.`,
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const categories = onlyCategory
    ? [onlyCategory]
    : Object.keys(CATEGORY_PROMPTS);
  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < count; i++) {
    const category = categories[i % categories.length];
    process.stdout.write(`[generate] ${i + 1}/${count} (${category})... `);
    let source: string;
    try {
      source = await generateOne(model, category);
    } catch (error) {
      console.log(`generation failed: ${error}`);
      rejected++;
      continue;
    }
    if (!source.includes('[preset00]') && !/per_frame_1\s*=/u.test(source)) {
      console.log('rejected: not preset-shaped');
      rejected++;
      continue;
    }

    const id = `gen-${category}-${String(Date.now()).slice(-6)}-${i}`;
    // Generated output gets the error-tolerant path: drop broken equation
    // lines like real MilkDrop would, but reject if nothing usable is left.
    try {
      const salvaged = salvageCompileMilkdropPreset(source, { id });
      if (!salvaged) {
        console.log('rejected: unsalvageable');
        rejected++;
        continue;
      }
      const { dropped } = salvaged;
      if (countEquationLines(source) - dropped.length < 3) {
        console.log(
          `rejected: ${dropped.length} dropped lines, too little survived`,
        );
        rejected++;
        continue;
      }
      const file = path.join(OUT_DIR, `${id}.milk`);
      fs.writeFileSync(file, source, 'utf8');
      console.log(
        `ok -> ${path.relative(REPO_ROOT, file)}${dropped.length ? ` (${dropped.length} lines salvaged)` : ''}`,
      );
      accepted++;
    } catch (error) {
      console.log(`rejected: ${String(error).slice(0, 80)}`);
      rejected++;
    }
  }

  console.log(
    `[generate] done: ${accepted} accepted, ${rejected} rejected -> ${OUT_DIR}`,
  );
  if (accepted > 0) {
    console.log(
      '[generate] next: bun run lab:flash-audit against these files, then ingest the survivors with scripts/ingest-corpus.ts --source=scratch/generated-presets --library=<target>',
    );
  }
}

if (import.meta.main) {
  void main();
}
