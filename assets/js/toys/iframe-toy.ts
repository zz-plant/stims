type StartOptions = {
  container?: HTMLElement | null;
  path: string;
  title?: string;
  allow?: string;
};

function resolveIframeSrc(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return new URL(path, window.location.origin).toString();
}

export function startIframeToy({ container, path, title, allow }: StartOptions) {
  const target = container ?? document.getElementById('active-toy-container');

  if (!target) {
    throw new Error('Active toy container is missing.');
  }

  const iframe = document.createElement('iframe');
  iframe.src = resolveIframeSrc(path);
  iframe.title = title ?? 'Web toy';
  iframe.allow = allow ?? 'microphone; camera; fullscreen';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  const activeToy = {
    dispose() {
      iframe.remove();
      if ((globalThis as Record<string, unknown>).__activeWebToy === activeToy) {
        delete (globalThis as Record<string, unknown>).__activeWebToy;
      }
    },
  };

  (globalThis as Record<string, unknown>).__activeWebToy = activeToy;
  target.appendChild(iframe);

  return activeToy;
}
