type StartOptions = {
  container: HTMLElement;
  audioContext: {
    createAnalyser: () => {
      frequencyBinCount?: number;
      getByteFrequencyData: (array: Uint8Array) => void;
    };
    close?: () => Promise<void> | void;
  };
};

export function start({ container, audioContext }: StartOptions) {
  const mount = document.createElement('section');
  mount.dataset.toyMount = 'demo-toy';
  container.appendChild(mount);

  const analyser = audioContext.createAnalyser();
  const frequencyData = new Uint8Array(analyser.frequencyBinCount ?? 8);
  analyser.getByteFrequencyData(frequencyData);
  mount.dataset.frequencySample = String(frequencyData[0] ?? 0);

  return async () => {
    mount.remove();
    if (typeof audioContext.close === 'function') {
      await audioContext.close();
    }
  };
}
