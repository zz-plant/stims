export interface RenderListToy extends Record<string, unknown> {
  slug?: string;
  title?: string;
}

export const LIBRARY_RENDER_BATCH_SIZE: number;
export const LIBRARY_INITIAL_RENDER_COUNT: number;
export function applyCardMotionVariant(card: HTMLElement, index: number): void;
export function createLibraryListRenderer(options: {
  document: Document;
  windowObject?: Window;
  targetId: string;
  getToyKey: (toy: RenderListToy, index?: number) => string;
  createCard: (toy: RenderListToy, queryTokens?: string[]) => HTMLElement;
  renderGrowthPanels: (listElement: DocumentFragment | HTMLElement) => void;
  createEmptyState: () => HTMLElement;
  onCardsRendered: (cards: HTMLElement[], toys: RenderListToy[]) => void;
}): {
  render(options: {
    listToRender: RenderListToy[];
    query: string;
    queryTokens: string[];
  }): void;
  cancelPendingBatch(): void;
};
