export const BREAKPOINTS = {
  xs: 520,
  sm: 640,
  md: 720,
  lg: 768,
  xl: 900,
  xxl: 1024,
} as const;

export const MEDIA_QUERIES = {
  coarsePointer: '(pointer: coarse)',
};

export const maxWidthQuery = (px: number) => `(max-width: ${px}px)`;
export const minWidthQuery = (px: number) => `(min-width: ${px}px)`;

const supportsMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export const getMediaQueryList = (query: string) =>
  supportsMatchMedia() ? window.matchMedia(query) : null;

export const matchesMediaQuery = (query: string) =>
  supportsMatchMedia() ? window.matchMedia(query).matches : false;

export const isBelowBreakpoint = (px: number) => {
  if (supportsMatchMedia()) {
    return window.matchMedia(maxWidthQuery(px)).matches;
  }
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= px;
};
