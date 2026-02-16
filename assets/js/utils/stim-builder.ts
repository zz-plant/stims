import toyManifest from '../data/toy-manifest.ts';
import type { ToyEntry, ToyManifest } from '../data/toy-schema.ts';

type BuilderMood = 'calming' | 'energetic' | 'dreamy' | 'playful';
type BuilderEnergy = 'soft' | 'balanced' | 'intense';
type BuilderInteraction = 'touch' | 'motion' | 'ambient';
type BuilderAudio = 'microphone' | 'demoAudio' | 'none';
type BuilderRenderer = 'any' | 'webgpu' | 'webgl';

export type StimRecipe = {
  mood: BuilderMood;
  energy: BuilderEnergy;
  interaction: BuilderInteraction;
  audio: BuilderAudio;
  renderer: BuilderRenderer;
};

type ScoredToy = { toy: ToyEntry; score: number; reasons: string[] };

const DEFAULT_RECIPE: StimRecipe = {
  mood: 'calming',
  energy: 'balanced',
  interaction: 'touch',
  audio: 'demoAudio',
  renderer: 'any',
};

const includesAny = (values: string[] | undefined, tokens: string[]) => {
  if (!values?.length) return false;
  const normalized = values.map((value) => value.toLowerCase());
  return tokens.some((token) => normalized.includes(token));
};

const scoreToyForRecipe = (toy: ToyEntry, recipe: StimRecipe): ScoredToy => {
  let score = 0;
  const reasons: string[] = [];

  if (includesAny(toy.moods, [recipe.mood])) {
    score += 4;
    reasons.push(`Matches ${recipe.mood} mood`);
  }

  if (recipe.energy === 'soft') {
    if (includesAny(toy.moods, ['calming', 'serene', 'minimal'])) {
      score += 2;
      reasons.push('Lower-energy profile');
    }
  } else if (recipe.energy === 'intense') {
    if (includesAny(toy.moods, ['energetic', 'immersive', 'fiery'])) {
      score += 2;
      reasons.push('High-energy profile');
    }
  } else if (includesAny(toy.moods, ['playful', 'uplifting', 'grounded'])) {
    score += 1;
  }

  if (recipe.interaction === 'motion') {
    if (toy.capabilities.motion) {
      score += 3;
      reasons.push('Supports motion controls');
    } else {
      score -= 1;
    }
  } else if (recipe.interaction === 'touch') {
    if (includesAny(toy.tags, ['touch', 'gestural', 'sculpting', 'pottery'])) {
      score += 2;
      reasons.push('Designed for touch and gesture');
    }
  } else if (!toy.capabilities.motion) {
    score += 1;
  }

  if (recipe.audio === 'microphone') {
    if (toy.capabilities.microphone) {
      score += 3;
      reasons.push('Works with microphone input');
    } else {
      score -= 2;
    }
  } else if (recipe.audio === 'demoAudio') {
    if (toy.capabilities.demoAudio) {
      score += 2;
      reasons.push('Works with built-in demo audio');
    }
  } else {
    score += 1;
  }

  if (recipe.renderer === 'webgpu') {
    if (toy.requiresWebGPU) {
      score += 3;
      reasons.push('Optimized for WebGPU visuals');
    } else {
      score -= 2;
    }
  } else if (recipe.renderer === 'webgl') {
    if (!toy.requiresWebGPU || toy.allowWebGLFallback) {
      score += 2;
      reasons.push('Friendly for broad device support');
    }
  }

  return { toy, score, reasons };
};

export const getStimBuilderRecommendations = (
  toys: ToyManifest,
  recipe: StimRecipe,
) =>
  [...toys]
    .map((toy) => scoreToyForRecipe(toy, recipe))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const rankA = a.toy.featuredRank ?? Number.POSITIVE_INFINITY;
      const rankB = b.toy.featuredRank ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return a.toy.title.localeCompare(b.toy.title);
    })
    .slice(0, 3);

const recipeLabels: Record<keyof StimRecipe, Record<string, string>> = {
  mood: {
    calming: 'calm',
    energetic: 'energetic',
    dreamy: 'dreamy',
    playful: 'playful',
  },
  energy: {
    soft: 'soft energy',
    balanced: 'balanced energy',
    intense: 'intense energy',
  },
  interaction: { touch: 'touch-led', motion: 'motion-led', ambient: 'ambient' },
  audio: {
    microphone: 'microphone reactive',
    demoAudio: 'demo audio ready',
    none: 'quiet-friendly',
  },
  renderer: {
    any: 'any renderer',
    webgpu: 'WebGPU-first',
    webgl: 'WebGL-compatible',
  },
};

const getRecipeFromForm = (form: HTMLFormElement): StimRecipe => {
  const data = new FormData(form);
  return {
    mood: (data.get('mood') as BuilderMood) ?? DEFAULT_RECIPE.mood,
    energy: (data.get('energy') as BuilderEnergy) ?? DEFAULT_RECIPE.energy,
    interaction:
      (data.get('interaction') as BuilderInteraction) ??
      DEFAULT_RECIPE.interaction,
    audio: (data.get('audio') as BuilderAudio) ?? DEFAULT_RECIPE.audio,
    renderer:
      (data.get('renderer') as BuilderRenderer) ?? DEFAULT_RECIPE.renderer,
  };
};

const renderRecipeSummary = (container: HTMLElement, recipe: StimRecipe) => {
  container.innerHTML = '';
  (Object.keys(recipe) as (keyof StimRecipe)[]).forEach((key) => {
    const chip = document.createElement('span');
    chip.className = 'builder-chip';
    chip.textContent = recipeLabels[key][recipe[key]];
    container.appendChild(chip);
  });
};

const renderRecommendations = (
  list: HTMLElement,
  cta: HTMLAnchorElement,
  recipe: StimRecipe,
) => {
  const recommendations = getStimBuilderRecommendations(
    toyManifest as ToyManifest,
    recipe,
  );

  list.innerHTML = '';
  for (const { toy, reasons } of recommendations) {
    const item = document.createElement('li');
    item.className = 'builder-result';
    item.innerHTML = `
      <div class="builder-result__body">
        <p class="builder-result__title">${toy.title}</p>
        <p class="builder-result__description">${toy.description}</p>
        <p class="builder-result__reason">${reasons.slice(0, 2).join(' · ') || 'Great all-around starter.'}</p>
      </div>
      <a class="builder-result__link" href="toy.html?toy=${toy.slug}">Open</a>
    `;
    list.appendChild(item);
  }

  const lead = recommendations[0]?.toy;
  if (lead) {
    cta.href = `toy.html?toy=${lead.slug}`;
    cta.textContent = `Launch ${lead.title}`;
    cta.removeAttribute('aria-disabled');
  } else {
    cta.href = '#stim-builder';
    cta.textContent = 'Launch a suggested stim';
    cta.setAttribute('aria-disabled', 'true');
  }
};

export const initStimBuilder = () => {
  const builder = document.querySelector<HTMLElement>('[data-stim-builder]');
  const form = builder?.querySelector<HTMLFormElement>('[data-builder-form]');
  const summary = builder?.querySelector<HTMLElement>('[data-builder-summary]');
  const results = builder?.querySelector<HTMLElement>('[data-builder-results]');
  const cta = builder?.querySelector<HTMLAnchorElement>('[data-builder-cta]');

  if (!builder || !form || !summary || !results || !cta) return;

  const sync = () => {
    const recipe = getRecipeFromForm(form);
    renderRecipeSummary(summary, recipe);
    renderRecommendations(results, cta, recipe);
  };

  form.addEventListener('change', sync);
  form.addEventListener('input', sync);
  sync();
};
