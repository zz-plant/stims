import { useCallback, useEffect, useState } from 'react';
import styles from '../../css/OnboardingFlow.module.css';

type OnboardingStep = {
  icon: string;
  title: string;
  description: string;
  cta: string;
};

const STEPS: OnboardingStep[] = [
  {
    icon: '\uD83C\uDFB5',
    title: 'This is a music visualizer',
    description:
      'Stims turns sound into motion. Press play to see it work with built-in demo audio.',
    cta: 'See it in action',
  },
  {
    icon: '\uD83C\uDFA8',
    title: 'Pick your vibe',
    description:
      'Choose from dozens of hand-picked presets. Each one moves differently. Browse to find your favorite look.',
    cta: 'Browse presets',
  },
  {
    icon: '\uD83D\uDD0A',
    title: 'Make it yours',
    description:
      'Switch to your own music anytime — microphone, browser tab, or YouTube. The visuals react to your sound.',
    cta: 'Start exploring',
  },
];

const STORAGE_KEY = 'stims:onboarding-complete';
const ONBOARDING_PARAM = 'onboarding';

export function useOnboarding(): {
  showOnboarding: boolean;
  dismissOnboarding: () => void;
} {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has(ONBOARDING_PARAM)) return false;
      return localStorage.getItem(STORAGE_KEY) !== 'true';
    } catch {
      return false;
    }
  });

  const dismissOnboarding = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* storage unavailable */
    }
    setShowOnboarding(false);
  }, []);

  return { showOnboarding, dismissOnboarding };
}

type OnboardingFlowProps = {
  onDismiss: () => void;
  onStartDemo: () => void;
};

export function OnboardingFlow({
  onDismiss,
  onStartDemo,
}: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  const current = STEPS[step];

  const handleDismiss = useCallback(() => {
    setExiting(true);
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(onDismiss, prefersReducedMotion ? 0 : 250);
  }, [onDismiss]);

  const handleStartDemo = useCallback(() => {
    handleDismiss();
    onStartDemo();
  }, [handleDismiss, onStartDemo]);

  const handleNext = useCallback(() => {
    if (step === 0) {
      handleStartDemo();
      return;
    }

    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleDismiss();
    }
  }, [step, handleDismiss, handleStartDemo]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleDismiss]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Stims"
    >
      <div className={styles.card} data-exiting={String(exiting)}>
        <div className={styles.iconCircle}>{current.icon}</div>

        <div className={styles.copy}>
          <h2 className={styles.title}>{current.title}</h2>
          <p className={styles.description}>{current.description}</p>
        </div>

        <button type="button" className={styles.cta} onClick={handleNext}>
          {current.cta}
        </button>

        <div className={styles.dots}>
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={styles.dot}
              data-active={String(i === step)}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          ))}
        </div>

        <button type="button" className={styles.skip} onClick={handleDismiss}>
          Skip
        </button>
      </div>
    </div>
  );
}
