export async function start({ container, slug }) {
  await new Promise((resolve) => setTimeout(resolve, 25));

  const node = document.createElement('div');
  node.dataset.fakeToy = slug;
  container.appendChild(node);

  return () => {
    node.remove();
  };
}
