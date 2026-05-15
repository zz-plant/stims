export function createLibraryView(options: Record<string, unknown>): {
  setToys: (toys: unknown[]) => void;
  init: () => Promise<void>;
  dispose: () => void;
  setRendererStatus?: (status: unknown) => void;
  showImportError?: (toy: unknown, details?: unknown) => void;
};
