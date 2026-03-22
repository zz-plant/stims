export interface LibraryState {
  query: string;
  filters: string[];
  sort: string;
}

export interface LibraryToy {
  slug?: string;
  title?: string;
  description?: string;
  tags?: string[];
  moods?: string[];
  featuredRank?: number;
  requiresWebGPU?: boolean;
  allowWebGLFallback?: boolean;
  capabilities?: {
    microphone?: boolean;
    demoAudio?: boolean;
    motion?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ToySearchMetadata {
  fields: {
    title: string;
    slug: string;
    description: string;
    tags: string[];
    moods: string[];
    flags: string[];
  };
  searchHaystacks: string[];
}

export const DEFAULT_LIBRARY_SORT: 'featured';
export function getQueryTokens(query: string): string[];
export function buildToySearchMetadata(toy: LibraryToy): ToySearchMetadata;
export function createToySearchMetadataMap(
  toys: LibraryToy[],
  getToyKey: (toy: LibraryToy, index?: number) => string,
): Map<string, ToySearchMetadata>;
export function normalizeLibraryState(
  state?: Partial<LibraryState>,
): LibraryState;
export function applyQuery(
  state: Partial<LibraryState>,
  query: string,
): LibraryState;
export function toggleFilter(
  state: Partial<LibraryState>,
  token: string,
): { state: LibraryState; isActive: boolean; token: string | null };
export function clearState(state?: Partial<LibraryState>): LibraryState;
export function setSort(
  state: Partial<LibraryState>,
  sort: string,
): LibraryState;
export function computeFilteredToys(options: {
  toys: LibraryToy[];
  state: Partial<LibraryState>;
  metadataByKey: Map<string, ToySearchMetadata>;
  getToyKey: (toy: LibraryToy, index?: number) => string;
  originalOrder: Map<string, number>;
}): LibraryToy[];
export function getMatchedFields(
  toy: LibraryToy,
  queryTokens: string[],
  metadataByKey: Map<string, ToySearchMetadata>,
  getToyKey: (toy: LibraryToy, index?: number) => string,
): string[];
export function createLibraryStateController(options: {
  storageKey: string;
  compatibilityModeKey?: string;
  windowObject?: Window;
}): {
  getState(): LibraryState;
  setState(nextState: Partial<LibraryState>): LibraryState;
  applyQuery(query: string): LibraryState;
  toggleFilter(token: string): {
    state: LibraryState;
    isActive: boolean;
    token: string | null;
  };
  clearState(): LibraryState;
  setSort(sort: string): LibraryState;
  commitState(options: { replace: boolean }): LibraryState;
  restoreInitialState(): LibraryState;
  readStateFromUrl(): LibraryState;
  readStateFromStorage(): LibraryState;
};
