export function shouldUseCertificationCorpus() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    new URLSearchParams(window.location.search)
      .get('corpus')
      ?.trim()
      .toLowerCase() === 'certification'
  );
}
