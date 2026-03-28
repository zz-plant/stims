export function start({ container }) {
  const node = document.createElement('div');
  node.dataset.fakeGlobalAudioToy = 'true';
  container.appendChild(node);

  window.startAudio = async () => {
    document.body.dataset.audioActive = 'true';
  };
  window.startAudioFallback = async () => {
    document.body.dataset.audioActive = 'true';
  };

  return {
    dispose() {
      window.startAudio = undefined;
      window.startAudioFallback = undefined;
      node.remove();
    },
  };
}
