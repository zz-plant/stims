export function start({ container }) {
  const node = document.createElement('div');
  node.dataset.fakeToy = 'true';
  container.appendChild(node);

  return () => {
    node.remove();
  };
}
