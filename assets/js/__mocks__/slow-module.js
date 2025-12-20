export function start() {
  const placeholder = document.createElement('div');
  placeholder.setAttribute('data-fake-toy', 'true');
  document.body.appendChild(placeholder);

  return {
    dispose: () => placeholder.remove(),
  };
}
