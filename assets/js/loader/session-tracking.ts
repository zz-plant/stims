import type { ToyEntry } from '../data/toy-schema.ts';

type Toy = ToyEntry;

export function createSessionTracking({
  toys,
  now = () => Date.now(),
  windowRef = () => (typeof window !== 'undefined' ? window : null),
}: {
  toys: Toy[];
  now?: () => number;
  windowRef?: () => Window | null;
}) {
  const recentToySlugs: string[] = [];
  let interactionTrackingInitialized = false;
  let lastInteractionAt = now();

  const markInteraction = () => {
    lastInteractionAt = now();
  };

  const initInteractionTracking = () => {
    const win = windowRef();
    if (interactionTrackingInitialized || !win) return;
    interactionTrackingInitialized = true;
    const interactionEvents: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'touchstart',
    ];
    interactionEvents.forEach((eventName) => {
      win.addEventListener(eventName, markInteraction, { passive: true });
    });
  };

  const rememberToy = (slug: string) => {
    if (!slug) return;
    const existingIndex = recentToySlugs.indexOf(slug);
    if (existingIndex === 0) return;
    if (existingIndex > -1) {
      recentToySlugs.splice(existingIndex, 1);
    }
    recentToySlugs.unshift(slug);
    if (recentToySlugs.length > 4) {
      recentToySlugs.pop();
    }
  };

  const pickNextToySlug = (currentSlug?: string | null) => {
    const available = toys.filter((toy) => toy.type === 'module');
    if (!available.length) return null;

    const avoid = new Set(recentToySlugs);
    if (currentSlug) {
      avoid.add(currentSlug);
    }
    const fresh = available.filter((toy) => !avoid.has(toy.slug));
    const fallback = available.filter((toy) => toy.slug !== currentSlug);
    const pool = fresh.length ? fresh : fallback.length ? fallback : available;
    if (!pool.length) return null;

    const choice = pool[Math.floor(Math.random() * pool.length)];
    return choice?.slug ?? null;
  };

  return {
    initInteractionTracking,
    markInteraction,
    rememberToy,
    pickNextToySlug,
    getLastInteractionAt: () => lastInteractionAt,
  };
}
