export function createLoaderLibraryResetController({
  removeEscapeHandler,
  disposeActiveToy,
  showLibraryView,
  goToLibrary,
  updateRendererStatus,
  resetAudioPool,
  clearSessionOnBack,
  setActiveToySlug,
}: {
  removeEscapeHandler: () => void;
  disposeActiveToy: () => void;
  showLibraryView: () => void;
  goToLibrary: () => void;
  updateRendererStatus: (status: null) => void;
  resetAudioPool: (options: { stopStreams: boolean }) => Promise<void> | void;
  clearSessionOnBack: () => void;
  setActiveToySlug: (slug: string | null) => void;
}) {
  const backToLibrary = ({ updateRoute = true } = {}) => {
    removeEscapeHandler();
    disposeActiveToy();
    showLibraryView();
    if (updateRoute) {
      goToLibrary();
    }
    updateRendererStatus(null);
    void resetAudioPool({ stopStreams: true });
    setActiveToySlug(null);
    clearSessionOnBack();
  };

  return {
    backToLibrary,
  };
}
