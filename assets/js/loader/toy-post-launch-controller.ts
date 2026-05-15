import { setCurrentToy } from '../core/agent-api.ts';
import type { ToyLaunchResult } from '../core/toy-launch.ts';
import { recordToyOpen } from '../utils/growth-metrics.ts';

const DEFAULT_STARTER_TIPS = [
  'Try mic, then demo audio, and keep whichever feels better.',
];

export function applyToyPostLaunchEffects({
  toy,
  pushState,
  launchResult,
  preferDemoAudio,
  container,
  rememberToy,
  setActiveToySlug,
  showAudioPrompt,
  starterTips,
}: {
  toy: {
    slug: string;
  };
  pushState: boolean;
  launchResult: ToyLaunchResult;
  preferDemoAudio: boolean;
  container: HTMLElement;
  rememberToy: (slug: string) => void;
  setActiveToySlug: (slug: string) => void;
  showAudioPrompt: (args: {
    launchResult: ToyLaunchResult;
    preferDemoAudio: boolean;
    container: HTMLElement;
    starterTips: string[];
  }) => void;
  starterTips?: string[];
}) {
  setCurrentToy(toy.slug);
  setActiveToySlug(toy.slug);
  rememberToy(toy.slug);
  recordToyOpen(toy.slug, pushState ? 'library' : 'direct');
  showAudioPrompt({
    launchResult,
    preferDemoAudio,
    container,
    starterTips: starterTips ?? DEFAULT_STARTER_TIPS,
  });
}
