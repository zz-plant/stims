const EXIT_FALLBACK_MS = 300;

/**
 * Crossfades the static startup screen after React has painted the shell.
 * The fallback covers browsers that suppress transition events mid-navigation.
 */
export function dismissLoadingScreen() {
  const loading = document.getElementById('stims-loading');
  if (!loading) return;

  loading.setAttribute('aria-hidden', 'true');
  loading.classList.add('stims-loading--leaving');

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    loading.remove();
    return;
  }

  let fallback: number;
  const finish = () => {
    window.clearTimeout(fallback);
    loading.removeEventListener('transitionend', onTransitionEnd);
    loading.remove();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === loading && event.propertyName === 'opacity') finish();
  };

  loading.addEventListener('transitionend', onTransitionEnd);
  fallback = window.setTimeout(finish, EXIT_FALLBACK_MS);
}
