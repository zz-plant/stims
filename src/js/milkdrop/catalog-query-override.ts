import { getRequestedCorpus } from '../core/url-params.ts';

export function shouldUseCertificationCorpus() {
  if (typeof window === 'undefined') {
    return false;
  }

  return getRequestedCorpus()?.toLowerCase() === 'certification';
}
